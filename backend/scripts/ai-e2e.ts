import { createAiRuntime } from '../src/ai/runtime.js';
import { buildDashboard } from '../src/modules/dashboard/service.js';
import { parseAnswerKey } from '../src/modules/attempts/grading.js';
import {
  getAttemptResult,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from '../src/modules/attempts/service.js';
import { completeOnboarding } from '../src/modules/onboarding/service.js';
import { QueueWorker } from '../src/queue/worker.js';
import { createSqlClient, DEFAULT_WORKER_STATEMENT_TIMEOUT_MS, type Sql } from '../src/db/sql.js';
import { EnvValidationError, getEnv, loadDotEnv } from '../src/env.js';
import type { FastifyBaseLogger } from 'fastify';

import type { AnswerPayload } from '../src/contracts/dto/attempts.js';
import type { AuthUser } from '../src/types/fastify.js';


const TEST_EMAIL_PREFIX = 'tlek-e2e-';

const FREE_TEXT_ANSWERS: Readonly<Record<string, string>> = {
  'math.free.derivative_sign':
    'Производная показывает, насколько быстро меняется функция в точке, и равна наклону ' +
    'касательной к графику. Если производная положительна, функция возрастает, если ' +
    'отрицательна — убывает.',
  'math.free.quadratic_minimum':
    'Наименьшее значение равно 4, оно достигается при x = 4. Я выделил полный квадрат: ' +
    'x² − 8x + 20 = (x − 4)² + 4.',
  'phys.free.thrown_ball_energy':
    'Кинетическая энергия уменьшается, потенциальная растёт. Наверху мяч на секунду ' +
    'останавливается. Про полную энергию точно не помню.',
  'kzh.free.zheltoksan_1986':
    'Это было в декабре 1986 года в Алма-Ате, вышла молодёжь. Точно не помню почему.',
  'read.free.evaluate_source':
    'Доверять не стоит: автор не указан и нет ссылок на исследования. Надо проверить ' +
    'по другим источникам.',
  'mlit.free.compound_interest':
    'Сложный процент выгоднее, потому что во второй год проценты считаются уже от большей суммы.',
};

const FALLBACK_FREE_TEXT = 'Не знаю, мы это не проходили.';

interface QuestionRow {
  id: string;
  kind: string;
  answer_key: unknown;
  position: number;
  content_code: string | null;
}

function asAuth(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-E2E00000' };
}

async function createStudent(sql: Sql): Promise<AuthUser> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `${TEST_EMAIL_PREFIX}${suffix}@example.test`;

  const [authUser] = await sql<{ id: string }[]>`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
    ) values (
      gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', ${email}, '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb
    )
    returning id
  `;

  if (authUser === undefined) {
    throw new Error('не удалось создать пользователя');
  }

  await sql`
    insert into public.profiles (id, role, public_id, display_name, grade)
    values (${authUser.id}, 'student', app.generate_public_id(), 'Сквозной прогон', 11)
  `;

  return asAuth(authUser.id);
}

function answerFor(question: QuestionRow): AnswerPayload | null {
  if (question.kind === 'free_text') {
    const code = question.content_code ?? '';
    return { text: FREE_TEXT_ANSWERS[code] ?? FALLBACK_FREE_TEXT };
  }

  const key = parseAnswerKey(question.answer_key);
  if (key === null) {
    return null;
  }

  const deliberatelyWrong = question.position % 3 === 0;

  if ('correct' in key) {
    return deliberatelyWrong ? { selected: ['zzz'] } : { selected: [...key.correct] };
  }
  if ('value' in key) {
    return { value: deliberatelyWrong ? key.value + 137 : key.value };
  }
  return null;
}

function silentLogger(): FastifyBaseLogger {
  const noop = (): void => undefined;
  const logger: FastifyBaseLogger = {
    level: 'silent',
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    child: () => logger,
  };
  return logger;
}

function heading(text: string): void {
  console.log(`\n${text}\n${'─'.repeat(text.length)}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const env = getEnv();

  const ai = createAiRuntime(env);
  if (ai === null) {
    console.error('AI_API_KEY не задан или AI_ENABLED=false — прогон бессмысленен.');
    process.exitCode = 78;
    return;
  }

  const sql = createSqlClient(env, {
    statementTimeoutMs: DEFAULT_WORKER_STATEMENT_TIMEOUT_MS,
    maxConnections: 3,
  });

  let user: AuthUser | null = null;

  try {
    console.log(`Модель: ${env.AI_MODEL}, формат: ${env.AI_RESPONSE_FORMAT}`);

    user = await createStudent(sql);
    console.log(`Ученик: ${user.id}`);

    const onboarding = await completeOnboarding(
      sql,
      user,
      {
        goal: 'ent',
        exam_code: 'ent',
        grade: 11,
        target_date: null,
        subject_codes: ['math', 'physics'],
        answers: null,
      },
      'ai-e2e',
    );

    const assessmentId = onboarding.diagnostic?.assessment_id;
    if (assessmentId === undefined) {
      throw new Error('диагностика не собралась — выполните npm run content');
    }

    heading('Диагностика собрана');
    console.log(`вопросов: ${onboarding.diagnostic?.question_count ?? 0}`);
    console.log(`из них свободных: ${onboarding.diagnostic?.free_text_count ?? 0}`);
    for (const subject of onboarding.diagnostic?.subjects ?? []) {
      console.log(`  ${subject.name}: ${subject.question_count}`);
    }

    const view = await startAttempt(
      sql,
      user,
      { assessment_id: assessmentId, client_attempt_id: null },
      'ai-e2e',
    );

    const questions = await sql<QuestionRow[]>`
      select q.id, q.kind::text as kind, q.answer_key, q.content_code, aq.position
        from public.assessment_questions aq
        join public.questions q on q.id = aq.question_id
       where aq.assessment_id = ${assessmentId}
       order by aq.position
    `;

    const answers = questions.flatMap((question) => {
      const answer = answerFor(question);
      return answer === null ? [] : [{ question_id: question.id, answer, time_spent_sec: 45 }];
    });

    await saveAnswers(sql, user, view.attempt.id, { answers });
    const submitted = await submitAttempt(sql, user, view.attempt.id, { requestId: 'ai-e2e' });

    heading('Отправлено');
    console.log(
      `детерминированно: ${submitted.attempt.deterministic.raw_score} из ` +
        `${submitted.attempt.deterministic.max_score} ` +
        `(проверено вопросов: ${submitted.attempt.deterministic.graded_questions})`,
    );
    console.log(`ждут модель: ${submitted.attempt.pending_ai_questions}`);

    heading('Разбор очередью с обращением к модели');
    const worker = new QueueWorker({
      sql,
      log: silentLogger(),
      workerId: 'worker-e2e',
      maintenance: false,
      ai,
      aiRetryBudget: env.AI_RETRY_BUDGET,
    });

    const startedAt = Date.now();
    for (let round = 0; round < 6; round += 1) {
      const claimed = await worker.tick();
      if (claimed === 0) {
        break;
      }
      console.log(`  заход ${round + 1}: работ выполнено ${claimed}`);
    }
    console.log(`  всего: ${Math.round((Date.now() - startedAt) / 100) / 10} с`);

    const result = await getAttemptResult(sql, user, view.attempt.id);

    heading('Результат');
    console.log(`статус: ${result.attempt.status}`);
    console.log(
      `балл: ${result.attempt.raw_score ?? 0} из ${result.attempt.max_score ?? 0} ` +
        `(${result.attempt.score_pct ?? 0} %)`,
    );
    console.log(`ждут проверки: ${result.attempt.pending_questions}`);
    console.log(`источник разбора: ${result.analysis?.source ?? 'нет'}`);
    console.log(`\n${result.analysis?.summary_md ?? '(разбора нет)'}`);

    heading('Сильные стороны');
    for (const item of result.strengths) {
      console.log(`  ${item.title} (${item.pct} %) — ${item.note ?? 'без пояснения'}`);
    }

    heading('Требуют внимания');
    for (const item of result.focus) {
      console.log(`  ${item.title} (${item.pct} %) — ${item.note ?? 'без пояснения'}`);
    }

    heading('Оценки свободных ответов');
    for (const answer of result.answers.filter((item) => item.kind === 'free_text')) {
      console.log(
        `  вопрос ${answer.position}: ${answer.points_awarded ?? 0} из ${answer.points} ` +
          `(${answer.grader})`,
      );
      console.log(`    ${answer.ai_feedback_md ?? '(без обратной связи)'}`);
    }

    heading('Мастерство по темам');
    for (const topic of [...result.topics].sort((left, right) => left.pct - right.pct)) {
      console.log(
        `  ${topic.title.padEnd(46)} наблюдалось ${String(topic.pct).padStart(6)} % → ` +
          `мастерство ${String(topic.mastery_pct ?? 0).padStart(6)} %` +
          ` (дельта ${String(topic.delta_pct ?? 0)})`,
      );
    }

    const dashboard = await buildDashboard(sql, user);

    heading('Экран панели');
    console.log(
      `цель: ${dashboard.goal.title}` +
        (dashboard.goal.days_left === null ? '' : `, дней осталось ${dashboard.goal.days_left}`),
    );

    const score = dashboard.predicted_score;
    if (score === null) {
      console.log('прогноз: нет');
    } else {
      console.log(
        `прогноз: ${score.value} из ${score.max}` +
          ` (расчёт ${score.baseline_value}, источник ${score.source},` +
          ` уверенность ${score.confidence})`,
      );
    }

    console.log(`\nфокус дня:`);
    for (const topic of dashboard.today_focus) {
      console.log(`  ${topic.title} — ${topic.mastery_pct} % (приоритет ${topic.priority})`);
    }

    if (dashboard.analytics.critical_topic !== null) {
      console.log(
        `\nкритическая тема: ${dashboard.analytics.critical_topic.title}` +
          ` (${dashboard.analytics.critical_topic.mastery_pct} %)`,
      );
    }

    console.log(
      `\nотвечено вопросов: ${dashboard.analytics.questions_answered},` +
        ` часов за обучением: ${dashboard.analytics.study_hours},` +
        ` работ в очереди: ${dashboard.pending_ai.jobs}`,
    );

    const [rationale] = await sql<{ result: { rationale?: string | null } | null }[]>`
      select result from public.ai_jobs
       where student_id = ${user.id} and op_type = 'predicted_score'
         and status = 'succeeded'
       order by finished_at desc limit 1
    `;
    if (typeof rationale?.result?.rationale === 'string') {
      console.log(`\nобоснование прогноза:\n${rationale.result.rationale}`);
    }

    const logs = await sql<
      { op_type: string; ok: boolean; input: number | null; output: number | null; cache: number | null }[]
    >`
      select l.op_type::text as op_type, l.ok, l.tokens_input as input,
             l.tokens_output as output, l.tokens_cache_read as cache
        from public.ai_call_logs l
        join public.ai_jobs j on j.id = l.job_id
       where j.student_id = ${user.id}
       order by l.created_at
    `;

    heading('Обращения к модели');
    let total = 0;
    for (const log of logs) {
      total += (log.input ?? 0) + (log.output ?? 0);
      console.log(
        `  ${log.op_type.padEnd(22)} ok=${String(log.ok)} ` +
          `вход ${log.input ?? 0}, выход ${log.output ?? 0}, из кэша ${log.cache ?? 0}`,
      );
    }
    console.log(`  всего токенов: ${total}`);
  } finally {
    if (user !== null && !process.argv.includes('--keep')) {
      await sql`delete from auth.users where id = ${user.id}`;
      console.log('\nВременный ученик удалён.');
    }
    await sql.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(78);
  }
  console.error(error);
  process.exit(1);
});
