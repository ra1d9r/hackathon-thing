import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnswerPayload } from '../../src/contracts/dto/attempts.js';
import type { Sql } from '../../src/db/sql.js';
import { COMPLETE_CHECK_PCT, MATERIAL_WEIGHT_PCT } from '../../src/domain/roadmap.js';
import { parseAnswerKey } from '../../src/modules/attempts/grading.js';
import { saveAnswers, startAttempt, submitAttempt } from '../../src/modules/attempts/service.js';
import { getLesson, markMaterialRead, openKnowledgeCheck } from '../../src/modules/lessons/service.js';
import { completeOnboarding } from '../../src/modules/onboarding/service.js';
import { buildRoadmap } from '../../src/modules/roadmap/build.js';
import {
  getRoadmap,
  getRoadmapNode,
  regenerateRoadmap,
  updateNodeOutline,
} from '../../src/modules/roadmap/service.js';
import { applyKnowledgeCheckResult } from '../../src/modules/roadmap/triggers.js';
import { QueueWorker } from '../../src/queue/worker.js';
import type { AuthUser } from '../../src/types/fastify.js';
import { buildTestApp } from '../helpers/app.js';
import { cleanupTestUsers, createTestSql, createTestUser, hasDatabase } from '../helpers/db.js';
import { drainJobs } from '../helpers/queue.js';

let sql: Sql;
let app: FastifyInstance;
const createdIds: string[] = [];

function asAuth(id: string): AuthUser {
  return { id, role: 'student', publicId: 'TLK-TEST0000' };
}

async function drainQueue(studentId: string): Promise<void> {
  const worker = new QueueWorker({
    sql,
    log: app.log,
    workerId: `worker-roadmap-${Math.random().toString(36).slice(2, 8)}`,
    maintenance: false,
  });

  await drainJobs(sql, worker, studentId);
}

interface QuestionRow {
  id: string;
  kind: string;
  answer_key: unknown;
  position: number;
}

async function answerAttempt(
  user: AuthUser,
  assessmentId: string,
  attemptId: string,
  correctness: number,
): Promise<void> {
  const questions = await sql<QuestionRow[]>`
    select q.id, q.kind::text as kind, q.answer_key, aq.position
      from public.assessment_questions aq
      join public.questions q on q.id = aq.question_id
     where aq.assessment_id = ${assessmentId}
     order by aq.position
  `;

  const answers: { question_id: string; answer: AnswerPayload; time_spent_sec: number }[] = [];

  for (const question of questions) {
    if (question.kind === 'free_text') {
      answers.push({
        question_id: question.id,
        answer: { text: 'Развёрнутый ответ ученика.' },
        time_spent_sec: 20,
      });
      continue;
    }

    const key = parseAnswerKey(question.answer_key);
    if (key === null) {
      continue;
    }

    const correct = question.position <= Math.round(questions.length * correctness);

    if ('correct' in key) {
      answers.push({
        question_id: question.id,
        answer: correct ? { selected: [...key.correct] } : { selected: ['zzz'] },
        time_spent_sec: 20,
      });
    } else if ('value' in key) {
      answers.push({
        question_id: question.id,
        answer: { value: correct ? key.value : key.value + 999 },
        time_spent_sec: 20,
      });
    }
  }

  await saveAnswers(sql, user, attemptId, { answers });
  await submitAttempt(sql, user, attemptId, {});
}

async function onboardedStudent(subjects = ['math', 'physics']): Promise<{
  user: AuthUser;
  assessmentId: string;
}> {
  const created = await createTestUser(sql, 'student', { grade: 11 });
  createdIds.push(created.id);
  const user = asAuth(created.id);

  const onboarding = await completeOnboarding(
    sql,
    user,
    {
      goal: 'ent',
      exam_code: 'ent',
      grade: 11,
      target_date: '2027-06-15',
      subject_codes: subjects,
      answers: null,
    },
    'roadmap-test',
  );

  const assessmentId = onboarding.diagnostic?.assessment_id;
  if (assessmentId === undefined) {
    throw new Error('диагностика не собралась — выполните npm run content');
  }

  return { user, assessmentId };
}

async function studentWithRoadmap(): Promise<AuthUser> {
  const { user, assessmentId } = await onboardedStudent();

  const [attempt] = await sql<{ id: string }[]>`
    insert into public.attempts (student_id, assessment_id, status, submitted_at, graded_at)
    values (${user.id}, ${assessmentId}, 'graded', now(), now())
    returning id
  `;

  await sql`
    update public.student_profiles
       set diagnostic_attempt_id = ${attempt?.id ?? null},
           passed_diagnostics = true
     where student_id = ${user.id}
  `;

  const subjectId = await firstSubjectId(user.id);
  await buildRoadmap(
    sql,
    { studentId: user.id, subjectId, aiJobId: null, replanReason: null, proposal: null },
    { gradeMin: 7, gradeMax: 11 },
  );

  return user;
}

async function studentWithDiagnostic(): Promise<AuthUser> {
  const { user, assessmentId } = await onboardedStudent();

  const view = await startAttempt(
    sql,
    user,
    { assessment_id: assessmentId, client_attempt_id: null },
    'roadmap-test',
  );

  await answerAttempt(user, assessmentId, view.attempt.id, 0.5);
  await drainQueue(user.id);

  return user;
}

async function firstSubjectId(studentId: string): Promise<string> {
  const [row] = await sql<{ subject_id: string }[]>`
    select ss.subject_id
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${studentId} and ss.removed_at is null
     order by s.sort_order, s.code
     limit 1
  `;

  if (row === undefined) {
    throw new Error('у ученика нет предметов');
  }
  return row.subject_id;
}

async function fakeCheckAttempt(studentId: string, lessonId: string): Promise<string> {
  const [assessment] = await sql<{ id: string }[]>`
    insert into public.assessments (kind, title, student_id, lesson_id, total_points, is_active)
    values ('knowledge_check', 'Проверка (тест)', ${studentId}, ${lessonId}, 5, false)
    returning id
  `;

  const [attempt] = await sql<{ id: string }[]>`
    insert into public.attempts (student_id, assessment_id, status, submitted_at, graded_at)
    values (${studentId}, ${assessment?.id ?? null}, 'graded', now(), now())
    returning id
  `;

  if (attempt === undefined) {
    throw new Error('не удалось создать попытку проверки знаний');
  }
  return attempt.id;
}

async function checkFromBank(studentId: string, lessonId: string): Promise<string | null> {
  const questions = await sql<{ id: string; points: string }[]>`
    select q.id, q.points
      from public.lessons l
      join public.questions q on q.topic_id = l.topic_id
     where l.id = ${lessonId} and q.is_active and q.origin = 'bank'
     order by q.difficulty, q.id
     limit 5
  `;

  if (questions.length === 0) {
    return null;
  }

  const total = questions.reduce((sum, question) => sum + Number(question.points), 0);

  const [assessment] = await sql<{ id: string }[]>`
    insert into public.assessments (
      kind, title, student_id, lesson_id, total_points, outline, is_active
    )
    select 'knowledge_check', 'Проверка знаний (тест)', ${studentId}, ${lessonId},
           ${total}, '[]'::jsonb, true
    returning id
  `;

  if (assessment === undefined) {
    return null;
  }

  let position = 1;
  for (const question of questions) {
    await sql`
      insert into public.assessment_questions (assessment_id, question_id, position)
      values (${assessment.id}, ${question.id}, ${position})
    `;
    position += 1;
  }

  return assessment.id;
}

describe.skipIf(!hasDatabase())('дорожная карта и уроки', () => {
  beforeAll(async () => {
    sql = createTestSql();
    app = await buildTestApp({ DATABASE_URL: process.env['DATABASE_URL'] ?? '' });
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestUsers(sql, createdIds);
    await sql.end();
  });

  describe('построение', () => {
    it('строит карту после диагностики без участия модели', async () => {
      const user = await studentWithDiagnostic();
      const roadmap = await getRoadmap(sql, user, undefined);

      expect(roadmap.roadmap).not.toBeNull();
      expect(roadmap.roadmap?.source).toBe('fallback');
      expect(roadmap.nodes.length).toBeGreaterThan(0);
      expect(roadmap.empty_reason).toBeNull();
    }, 120_000);

    it('открывает первый узел и запирает остальные до его прохождения', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);

      const [first] = roadmap.nodes;
      expect(first?.status).toBe('available');
      expect(first?.position).toBe(1);

      expect(roadmap.roadmap?.overall_progress_pct).toBe(0);
    });

    it('нумерует узлы подряд и не повторяет темы', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);

      const positions = roadmap.nodes.map((node) => node.position);
      expect(positions).toEqual(positions.map((_, index) => index + 1));

      const topics = new Set(roadmap.nodes.map((node) => node.topic.id));
      expect(topics.size).toBe(roadmap.nodes.length);
    });

    it('строит карту по каждому выбранному предмету', async () => {
      const user = await studentWithDiagnostic();

      const [subjects] = await sql<{ count: string }[]>`
        select count(*) as count from public.student_subjects
         where student_id = ${user.id} and removed_at is null
      `;

      const [roadmaps] = await sql<{ count: string }[]>`
        select count(*) as count from public.roadmaps
         where student_id = ${user.id} and is_active
      `;

      expect(Number(roadmaps?.count)).toBe(Number(subjects?.count));
      expect(Number(roadmaps?.count)).toBeGreaterThanOrEqual(2);
    }, 120_000);

    it('новая версия карты заменяет прежнюю, а не добавляется к ней', async () => {
      const user = await studentWithRoadmap();
      const subjectId = await firstSubjectId(user.id);

      const before = await getRoadmap(sql, user, subjectId);
      await buildRoadmap(
        sql,
        { studentId: user.id, subjectId, aiJobId: null, replanReason: 'проверка', proposal: null },
        { gradeMin: 7, gradeMax: 11 },
      );
      const after = await getRoadmap(sql, user, subjectId);

      expect(after.roadmap?.version).toBe((before.roadmap?.version ?? 0) + 1);

      const [active] = await sql<{ count: string }[]>`
        select count(*) as count from public.roadmaps
         where student_id = ${user.id} and subject_id = ${subjectId} and is_active
      `;
      expect(Number(active?.count)).toBe(1);
    });
  });

  describe('урок и прогресс', () => {
    it('отдаёт материал вместе с разобранным деревом и хэшем', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const lessonId = roadmap.nodes.find((node) => node.lesson_id !== null)?.lesson_id;

      if (lessonId == null) {
        throw new Error('ни один узел не получил урока');
      }

      const lesson = await getLesson(sql, user, lessonId);

      expect(lesson.material).not.toBeNull();
      expect(lesson.material?.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(lesson.material?.body_blocks.length).toBeGreaterThan(0);

      expect(lesson.offline.material_available).toBe(true);
      expect(lesson.offline.knowledge_check_requires_network).toBe(true);
    });

    it('в разметке материала не остаётся HTML', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const lessonId = roadmap.nodes.find((node) => node.lesson_id !== null)?.lesson_id;

      if (lessonId == null) {
        throw new Error('ни один узел не получил урока');
      }

      const lesson = await getLesson(sql, user, lessonId);

      expect(lesson.material?.body_md ?? '').not.toMatch(/<[a-z/]/iu);
    });

    it('отметка о прочтении даёт 30 % и двигает узел', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const node = roadmap.nodes.find((candidate) => candidate.lesson_id !== null);

      if (node?.lesson_id == null) {
        throw new Error('ни один узел не получил урока');
      }

      const result = await markMaterialRead(sql, user, node.lesson_id);

      expect(result.progress.progress_pct).toBe(MATERIAL_WEIGHT_PCT);
      expect(result.progress.material_read).toBe(true);
      expect(result.node?.status).toBe('in_progress');
    });

    it('повторная отметка ничего не меняет', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const lessonId = roadmap.nodes.find((node) => node.lesson_id !== null)?.lesson_id;

      if (lessonId == null) {
        throw new Error('ни один узел не получил урока');
      }

      const first = await markMaterialRead(sql, user, lessonId);
      const second = await markMaterialRead(sql, user, lessonId);

      expect(second.progress.material_read_at).toBe(first.progress.material_read_at);
      expect(second.progress.progress_pct).toBe(first.progress.progress_pct);
    });

    it('результат проверки знаний засчитывается лучшим, а не последним', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const lessonId = roadmap.nodes.find((node) => node.lesson_id !== null)?.lesson_id;

      if (lessonId == null) {
        throw new Error('ни один узел не получил урока');
      }

      await markMaterialRead(sql, user, lessonId);

      const good = await fakeCheckAttempt(user.id, lessonId);
      const bad = await fakeCheckAttempt(user.id, lessonId);

      await applyKnowledgeCheckResult(sql, { id: good, studentId: user.id, scorePct: 90 });
      await applyKnowledgeCheckResult(sql, { id: bad, studentId: user.id, scorePct: 40 });

      const [row] = await sql<{ best_check_pct: string; check_attempt_id: string }[]>`
        select best_check_pct, check_attempt_id from public.lesson_progress
         where student_id = ${user.id} and lesson_id = ${lessonId}
      `;

      expect(Number(row?.best_check_pct)).toBe(90);
      expect(row?.check_attempt_id).toBe(good);
    });

    it('завершает узел при прочитанном материале и проверке от порога', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const node = roadmap.nodes.find((candidate) => candidate.lesson_id !== null);

      if (node?.lesson_id == null) {
        throw new Error('ни один узел не получил урока');
      }

      await markMaterialRead(sql, user, node.lesson_id);
      await sql`
        update public.lesson_progress
           set best_check_pct = ${COMPLETE_CHECK_PCT}
         where student_id = ${user.id} and lesson_id = ${node.lesson_id}
      `;

      const after = await getRoadmapNode(sql, user, node.id);

      expect(after.node.status).toBe('completed');
      expect(after.node.completed_at).not.toBeNull();
    });
  });

  describe('план урока', () => {
    it('правка сохраняется и помечает узел изменённым', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const node = roadmap.nodes[0];

      if (node === undefined) {
        throw new Error('карта пуста');
      }

      const updated = await updateNodeOutline(sql, user, node.id, {
        outline: [
          { step: 1, kind: 'theory', title: 'Сначала теория' },
          { step: 2, kind: 'practice', title: 'Потом практика' },
        ],
      });

      expect(updated.node.outline.map((step) => step.title)).toEqual([
        'Сначала теория',
        'Потом практика',
      ]);
      expect(updated.node.outline_edited).toBe(true);
    });

    it('перепланирование не затирает правку человека', async () => {
      const user = await studentWithRoadmap();
      const subjectId = await firstSubjectId(user.id);
      const before = await getRoadmap(sql, user, subjectId);
      const node = before.nodes[0];

      if (node === undefined) {
        throw new Error('карта пуста');
      }

      await updateNodeOutline(sql, user, node.id, {
        outline: [{ step: 1, kind: 'intro', title: 'Мой шаг' }],
      });

      await buildRoadmap(
        sql,
        { studentId: user.id, subjectId, aiJobId: null, replanReason: 'проверка', proposal: null },
        { gradeMin: 7, gradeMax: 11 },
      );

      const after = await getRoadmap(sql, user, subjectId);
      const sameTopic = after.nodes.find((candidate) => candidate.topic.id === node.topic.id);

      expect(sameTopic?.outline.map((step) => step.title)).toEqual(['Мой шаг']);
      expect(sameTopic?.outline_edited).toBe(true);
    });

    it('перенумеровывает шаги подряд', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const node = roadmap.nodes[0];

      if (node === undefined) {
        throw new Error('карта пуста');
      }

      const updated = await updateNodeOutline(sql, user, node.id, {
        outline: [
          { step: 7, kind: 'summary', title: 'Итог' },
          { step: 3, kind: 'intro', title: 'Начало' },
        ],
      });

      expect(updated.node.outline.map((step) => step.step)).toEqual([1, 2]);
      expect(updated.node.outline[0]?.title).toBe('Начало');
    });
  });

  describe('доступ', () => {
    it('чужой узел неотличим от несуществующего', async () => {
      const owner = await studentWithRoadmap();
      const stranger = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, owner, undefined);
      const node = roadmap.nodes[0];

      if (node === undefined) {
        throw new Error('карта пуста');
      }

      await expect(getRoadmapNode(sql, stranger, node.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('урок по невыбранному предмету недоступен', async () => {
      const user = await studentWithRoadmap();

      const [foreign] = await sql<{ id: string }[]>`
        select l.id
          from public.lessons l
          join public.subjects s on s.id = l.subject_id
         where l.is_active and s.code = 'biology'
         limit 1
      `;

      if (foreign === undefined) {
        throw new Error('в наполнении нет урока по биологии');
      }

      await expect(getLesson(sql, user, foreign.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('карта требует пройденной диагностики', async () => {
      const { user } = await onboardedStudent();

      await expect(getRoadmap(sql, user, undefined)).rejects.toMatchObject({
        code: 'DIAGNOSTIC_REQUIRED',
      });
    });
  });

  describe('перепланирование', () => {
    it('повтор внутри окна возвращает ту же работу', async () => {
      const user = await studentWithRoadmap();
      const subjectId = await firstSubjectId(user.id);

      const first = await regenerateRoadmap(sql, user, { subject_id: subjectId });
      const second = await regenerateRoadmap(sql, user, { subject_id: subjectId });

      expect(second.job_id).toBe(first.job_id);
      expect(second.created).toBe(false);
    });

    it('чужой предмет даёт 404', async () => {
      const user = await studentWithRoadmap();

      const [foreign] = await sql<{ id: string }[]>`
        select id from public.subjects where code = 'biology' limit 1
      `;

      if (foreign === undefined) {
        throw new Error('в наполнении нет предмета biology');
      }

      await expect(
        regenerateRoadmap(sql, user, { subject_id: foreign.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('проверка знаний', () => {
    it('без модели набирается из банка вопросов', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const lessonId = roadmap.nodes.find((node) => node.lesson_id !== null)?.lesson_id;

      if (lessonId == null) {
        throw new Error('ни один узел не получил урока');
      }

      const opened = await openKnowledgeCheck(sql, user, lessonId);
      expect(opened.job).not.toBeNull();
      expect(opened.assessment).toBeNull();

      await drainQueue(user.id);

      const ready = await openKnowledgeCheck(sql, user, lessonId);

      if (ready.assessment !== null) {
        expect(ready.assessment.source).toBe('bank');
        expect(ready.assessment.question_count).toBeGreaterThan(0);
        expect(ready.job).toBeNull();
      }
    });

    it('результат проверки через попытку двигает узел карты', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const node = roadmap.nodes.find((candidate) => candidate.lesson_id !== null);

      if (node?.lesson_id == null) {
        throw new Error('ни один узел не получил урока');
      }

      const assessmentId = await checkFromBank(user.id, node.lesson_id);
      if (assessmentId === null) {
        throw new Error('в банке нет вопросов ни по одной теме карты');
      }

      const view = await startAttempt(
        sql,
        user,
        { assessment_id: assessmentId, client_attempt_id: null },
        'roadmap-test',
      );

      await markMaterialRead(sql, user, node.lesson_id);
      await answerAttempt(user, assessmentId, view.attempt.id, 1);
      await drainQueue(user.id);

      const after = await getRoadmapNode(sql, user, node.id);

      expect(after.node.progress_pct).toBe(100);
      expect(after.node.status).toBe('completed');
      expect(after.node.completed_at).not.toBeNull();
    }, 120_000);

    it('повторное открытие даёт ту же проверку', async () => {
      const user = await studentWithRoadmap();
      const roadmap = await getRoadmap(sql, user, undefined);
      const lessonId = roadmap.nodes.find((node) => node.lesson_id !== null)?.lesson_id;

      if (lessonId == null) {
        throw new Error('ни один узел не получил урока');
      }

      await openKnowledgeCheck(sql, user, lessonId);
      await drainQueue(user.id);

      const first = await openKnowledgeCheck(sql, user, lessonId);
      const second = await openKnowledgeCheck(sql, user, lessonId);

      expect(second.assessment?.id).toBe(first.assessment?.id);
    });
  });
});
