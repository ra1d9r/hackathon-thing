import { randomUUID } from 'node:crypto';

import { createModelCaller } from '../src/ai/client.js';
import { withLimits } from '../src/ai/limits.js';
import { gradeFreeText, type GradingCandidate } from '../src/ai/ops/grading.js';
import { proposeMasteryChanges, type AnalysisTopicInput } from '../src/ai/ops/analysis.js';
import { createSqlClient, DEFAULT_WORKER_STATEMENT_TIMEOUT_MS } from '../src/db/sql.js';
import { EnvValidationError, getEnv, loadDotEnv, type Env } from '../src/env.js';
import { GRADING_CASES, type GradingCase } from '../evals/grading-cases.js';
import type { ModelCaller } from '../src/ai/types.js';

const CYRILLIC = /[а-яё]/iu;

interface Verdict {
  readonly id: string;
  readonly title: string;
  readonly checks: string;
  readonly ok: boolean;
  readonly detail: string;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function toCandidate(item: GradingCase, questionId: string): GradingCandidate {
  return {
    questionId,
    promptMd: item.question.promptMd,
    rubricMd: item.question.rubricMd,
    points: item.question.points,
    expectedPoints: item.question.expectedPoints,
    answerText: item.answer,
  };
}

function judge(
  item: GradingCase,
  graded: { pointsAwarded: number; isCorrect: boolean; feedbackMd: string; lowTrust: boolean } | undefined,
): Verdict {
  const base = { id: item.id, title: item.title, checks: item.checks };

  if (graded === undefined) {
    return { ...base, ok: false, detail: 'модель не вернула оценку для этого вопроса' };
  }

  const ratio = graded.pointsAwarded / item.question.points;
  const problems: string[] = [];

  if (ratio < item.expect.minRatio - 1e-9 || ratio > item.expect.maxRatio + 1e-9) {
    problems.push(
      `доля ${ratio.toFixed(2)} вне [${item.expect.minRatio}; ${item.expect.maxRatio}]`,
    );
  }
  if (item.expect.isCorrect !== undefined && graded.isCorrect !== item.expect.isCorrect) {
    problems.push(`is_correct=${String(graded.isCorrect)}, ожидалось ${String(item.expect.isCorrect)}`);
  }
  if (item.expect.lowTrust === true && !graded.lowTrust) {
    problems.push('ожидалась пометка пониженного доверия');
  }
  if (graded.feedbackMd.trim() === '') {
    problems.push('пустая обратная связь');
  }
  if (item.expect.feedbackInRussian === true && !CYRILLIC.test(graded.feedbackMd)) {
    problems.push('обратная связь не на русском');
  }

  const summary =
    `доля ${ratio.toFixed(2)}` +
    `, верно=${String(graded.isCorrect)}` +
    (graded.lowTrust ? ', доверие снижено' : '');

  return {
    ...base,
    ok: problems.length === 0,
    detail: problems.length === 0 ? summary : `${summary} — ${problems.join('; ')}`,
  };
}

async function runGrading(caller: ModelCaller, batchSize: number): Promise<Verdict[]> {
  const only = option('only');
  const cases = only === undefined ? GRADING_CASES : GRADING_CASES.filter((item) => item.id === only);

  if (cases.length === 0) {
    console.error(`Кейс «${only ?? ''}» не найден.`);
    return [];
  }

  const verdicts: Verdict[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const [index, batch] of chunk(cases, batchSize).entries()) {
    const ids = new Map(batch.map((item) => [item.id, randomUUID()]));
    const candidates = batch.map((item) => toCandidate(item, ids.get(item.id) ?? ''));

    process.stdout.write(`  пачка ${index + 1}: ${batch.length} ответ(ов)… `);
    const outcome = await gradeFreeText(caller, candidates);

    for (const call of outcome.calls) {
      inputTokens += call.usage?.input ?? 0;
      outputTokens += call.usage?.output ?? 0;
    }

    if (outcome.answers === null) {
      console.log(`не удалось: ${outcome.failure ?? ''} — ${outcome.reason ?? ''}`);
      for (const item of batch) {
        verdicts.push({
          id: item.id,
          title: item.title,
          checks: item.checks,
          ok: false,
          detail: `оценка не получена: ${outcome.reason ?? ''}`,
        });
      }
      continue;
    }

    console.log(
      `${outcome.calls.length} вызов(ов)` +
        (outcome.repairedBecause === null ? '' : `  переспрос: ${outcome.repairedBecause}`),
    );

    for (const item of batch) {
      const graded = outcome.answers.find((answer) => answer.questionId === ids.get(item.id));
      verdicts.push(judge(item, graded));
    }
  }

  console.log(`\n  токенов: вход ${inputTokens}, выход ${outputTokens}`);
  return verdicts;
}

interface TopicRow {
  id: string;
  subject_id: string;
  title_ru: string;
}

async function runAnalysis(env: Env, caller: ModelCaller): Promise<Verdict[]> {
  const sql = createSqlClient(env, {
    statementTimeoutMs: DEFAULT_WORKER_STATEMENT_TIMEOUT_MS,
    maxConnections: 1,
  });

  try {
    const topics = await sql<TopicRow[]>`
      select t.id, t.subject_id, t.title_ru
        from public.topics t
        join public.subjects s on s.id = t.subject_id
       where s.code in ('math', 'physics') and t.is_active
       order by t.code
       limit 6
    `;

    if (topics.length === 0) {
      return [
        {
          id: 'analysis-setup',
          title: 'Разбор попытки',
          checks: 'наличие тем в базе',
          ok: false,
          detail: 'в базе нет тем — выполните npm run content',
        },
      ];
    }

    const inputs: AnalysisTopicInput[] = topics.map((topic, index) => {
      const strong = index % 2 === 0;
      return {
        topicId: topic.id,
        subjectId: topic.subject_id,
        title: topic.title_ru,
        pointsEarned: strong ? 4 : 1,
        pointsPossible: 4,
        observedPct: strong ? 100 : 25,
        currentMasteryPct: null,
        deterministicDeltaPct: 0,
      };
    });

    const known = new Set(topics.map((topic) => topic.id));
    const verdicts: Verdict[] = [];

    for (const isDiagnostic of [true, false]) {
      const label = isDiagnostic ? 'диагностика' : 'обычная попытка';
      process.stdout.write(`  разбор (${label})… `);

      const outcome = await proposeMasteryChanges(sql, caller, inputs, {
        isDiagnostic,
        opType: isDiagnostic ? 'diagnostic_analysis' : 'attempt_analysis',
      });

      const tokens = outcome.calls.reduce(
        (sum, call) => sum + (call.usage?.input ?? 0) + (call.usage?.output ?? 0),
        0,
      );
      console.log(
        `${outcome.calls.length} вызов(ов), ${tokens} токенов` +
          (outcome.repairedBecause === null ? '' : `  переспрос: ${outcome.repairedBecause}`),
      );

      if (outcome.proposals === null) {
        verdicts.push({
          id: `analysis-${isDiagnostic ? 'diagnostic' : 'attempt'}`,
          title: `Разбор: ${label}`,
          checks: 'модель возвращает разбор нужной формы',
          ok: false,
          detail: `${outcome.failure ?? ''} — ${outcome.reason ?? ''}`,
        });
        continue;
      }

      const problems: string[] = [];
      const foreign = outcome.proposals.filter((proposal) => !known.has(proposal.topicId));

      if (foreign.length > 0) {
        problems.push(`${foreign.length} тем не из этой попытки`);
      }
      if (outcome.proposals.length < inputs.length) {
        problems.push(`покрыто ${outcome.proposals.length} тем из ${inputs.length}`);
      }
      if ((outcome.summaryMd ?? '').trim() === '') {
        problems.push('пустой разбор');
      } else if (!CYRILLIC.test(outcome.summaryMd ?? '')) {
        problems.push('разбор не на русском');
      }
      if (outcome.proposals.some((proposal) => proposal.reason.trim() === '')) {
        problems.push('есть тема без объяснения');
      }

      verdicts.push({
        id: `analysis-${isDiagnostic ? 'diagnostic' : 'attempt'}`,
        title: `Разбор: ${label}`,
        checks: 'темы только свои, все покрыты, объяснение на русском',
        ok: problems.length === 0,
        detail:
          problems.length === 0
            ? `${outcome.proposals.length} тем, прижато к коридору: ${outcome.clampedCount}`
            : problems.join('; '),
      });
    }

    return verdicts;
  } finally {
    await sql.end();
  }
}

function report(verdicts: readonly Verdict[]): number {
  console.log(`\n${'─'.repeat(78)}`);

  let failed = 0;

  for (const verdict of verdicts) {
    if (!verdict.ok) {
      failed += 1;
    }
    console.log(`${verdict.ok ? '✓' : '✗'} ${verdict.id.padEnd(32)} ${verdict.detail}`);
    if (!verdict.ok) {
      console.log(`  ${verdict.title} — проверяет: ${verdict.checks}`);
    }
  }

  console.log('─'.repeat(78));
  console.log(`Пройдено ${verdicts.length - failed} из ${verdicts.length}`);

  return failed;
}

async function main(): Promise<void> {
  loadDotEnv();
  const env = getEnv();

  if (env.AI_API_KEY === undefined) {
    console.error('AI_API_KEY не задан — проверять нечего.');
    process.exitCode = 78;
    return;
  }

  const caller = withLimits(createModelCaller(env), env);
  const batchSize = Number(option('batch') ?? 4);
  const gradingOnly = process.argv.includes('--grading');

  console.log(`Модель: ${env.AI_MODEL}, формат: ${env.AI_RESPONSE_FORMAT}\n`);
  console.log('Оценивание свободных ответов:');

  const verdicts = await runGrading(caller, batchSize);

  if (!gradingOnly && option('only') === undefined) {
    console.log('\nРазбор попытки:');
    verdicts.push(...(await runAnalysis(env, caller)));
  }

  if (report(verdicts) > 0) {
    process.exitCode = 1;
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
