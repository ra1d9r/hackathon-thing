import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { z } from 'zod';

import { MARKDOWN_LIMITS, normalizeMarkdown, sanitizeMarkdown } from '../contracts/markdown.js';
import { isJsonObject } from '../contracts/json.js';
import type { SqlExecutor } from '../db/sql.js';
import {
  diagnosticFileSchema,
  examsFileSchema,
  type ExamsFile,
  goalsFileSchema,
  lessonsFileSchema,
  type LessonsFile,
  mockFileSchema,
  mockPoolFileSchema,
  subjectsFileSchema,
  topicsFileSchema,
  type ContentQuestion,
} from './schema.js';

export const CONTENT_DIR = fileURLToPath(new URL('../../../supabase/content/', import.meta.url));

export interface LoadReport {
  readonly subjects: number;
  readonly topics: number;
  readonly prerequisites: number;
  readonly goals: number;
  readonly exams: number;
  readonly lessons: number;
  readonly questions: number;
  readonly mocks: number;
  readonly retired: number;
  readonly placeholders: Placeholder[];
}

export class ContentValidationError extends Error {
  constructor(file: string, issues: readonly string[]) {
    super(`Файл ${file} не прошёл проверку:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ContentValidationError';
  }
}

function readJsonRaw(file: string): unknown {
  return JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));
}

function readJson<T>(file: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(join(CONTENT_DIR, file), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new ContentValidationError(
      file,
      result.error.issues.map((issue) => {
        const path = issue.path.map((segment) => String(segment)).join('.');
        return `${path === '' ? '(корень)' : path}: ${issue.message}`;
      }),
    );
  }

  return result.data;
}

function listJson(subdir: string): string[] {
  const dir = join(CONTENT_DIR, subdir);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((name) => `${subdir}/${name}`);
}

function contentHash(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

async function subjectIdByCode(sql: SqlExecutor, file: string, code: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from public.subjects where code = ${code}`;
  if (row === undefined) {
    throw new ContentValidationError(file, [`предмет "${code}" не найден — проверьте subjects.json`]);
  }
  return row.id;
}

async function topicByCode(
  sql: SqlExecutor,
  file: string,
  code: string,
): Promise<{ id: string; subjectId: string }> {
  const [row] = await sql<{ id: string; subject_id: string }[]>`
    select id, subject_id from public.topics where code = ${code}
  `;
  if (row === undefined) {
    throw new ContentValidationError(file, [`тема "${code}" не найдена — проверьте topics/`]);
  }
  return { id: row.id, subjectId: row.subject_id };
}

async function loadSubjects(sql: SqlExecutor): Promise<number> {
  const { subjects } = readJson('subjects.json', subjectsFileSchema);

  for (const subject of subjects) {
    await sql`
      insert into public.subjects (code, name_ru, name_kk, name_en, is_ent_mandatory, sort_order, is_active)
      values (
        ${subject.code}, ${subject.name_ru}, ${subject.name_kk}, ${subject.name_en},
        ${subject.is_ent_mandatory}, ${subject.sort_order}, ${subject.is_active}
      )
      on conflict (code) do update set
        name_ru = excluded.name_ru, name_kk = excluded.name_kk, name_en = excluded.name_en,
        is_ent_mandatory = excluded.is_ent_mandatory, sort_order = excluded.sort_order,
        is_active = excluded.is_active
    `;
  }

  return subjects.length;
}

export interface Placeholder {
  readonly file: string;
  readonly note: string;
}

const DEFAULT_PLACEHOLDER_NOTE = 'файл помечен заготовкой, пояснение не заполнено';

function notePlaceholder(
  file: string,
  parsed: { placeholder: boolean; _ЗАГОТОВКА?: string | undefined },
  placeholders: Placeholder[],
): void {
  if (parsed.placeholder) {
    placeholders.push({ file, note: parsed._ЗАГОТОВКА ?? DEFAULT_PLACEHOLDER_NOTE });
  }
}

async function loadTopics(
  sql: SqlExecutor,
  placeholders: Placeholder[],
): Promise<{ topics: number; prerequisites: number; retired: number }> {
  let topicCount = 0;
  const seenCodes: string[] = [];
  const links: { topic: string; prerequisite: string; file: string }[] = []; 

  for (const file of listJson('topics')) {
    const parsed = readJson(file, topicsFileSchema);
    notePlaceholder(file, parsed, placeholders);

    const subjectId = await subjectIdByCode(sql, file, parsed.subject_code);

    for (const topic of parsed.topics) {
      if (topic.grade_min > topic.grade_max) {
        throw new ContentValidationError(file, [`${topic.code}: grade_min больше grade_max`]);
      }

      await sql`
        insert into public.topics (
          subject_id, code, title_ru, title_kk, grade_min, grade_max, exam_weight, sort_order, is_active
        ) values (
          ${subjectId}, ${topic.code}, ${topic.title_ru}, ${topic.title_kk},
          ${topic.grade_min}, ${topic.grade_max}, ${topic.exam_weight}, ${topic.sort_order}, true
        )
        on conflict (subject_id, code) do update set
          title_ru = excluded.title_ru, title_kk = excluded.title_kk,
          grade_min = excluded.grade_min, grade_max = excluded.grade_max,
          exam_weight = excluded.exam_weight, sort_order = excluded.sort_order, is_active = true
      `;

      topicCount += 1;
      seenCodes.push(topic.code);
      for (const prerequisite of topic.prerequisites) {
        links.push({ topic: topic.code, prerequisite, file });
      }
    }
  }

  for (const link of links) {
    const topic = await topicByCode(sql, link.file, link.topic);
    const prerequisite = await topicByCode(sql, link.file, link.prerequisite);
    await sql`
      insert into public.topic_prerequisites (topic_id, prerequisite_id)
      values (${topic.id}, ${prerequisite.id})
      on conflict do nothing
    `;
  }
  const retired = await sql<{ code: string }[]>`
    update public.topics
       set is_active = false
     where is_active
       and code <> all(${[...seenCodes]}::text[])
    returning code
  `;

  return { topics: topicCount, prerequisites: links.length, retired: retired.length };
}

async function loadGoals(sql: SqlExecutor): Promise<number> {
  const { goals } = readJson('goals.json', goalsFileSchema);

  for (const goal of goals) {
    await sql`
      insert into public.learning_goals (goal, title_ru, description_ru, sort_order, is_active)
      values (
        ${goal.goal}::public.learning_goal, ${goal.title_ru}, ${goal.description_ru},
        ${goal.sort_order}, ${goal.is_active}
      )
      on conflict (goal) do update set
        title_ru = excluded.title_ru, description_ru = excluded.description_ru,
        sort_order = excluded.sort_order, is_active = excluded.is_active
    `;
  }

  return goals.length;
}

type ExamInput = ExamsFile['exams'][number];

export function assertBlueprintMatchesSubjects(file: string, exam: ExamInput): void {
  const errors: string[] = [];

  const profileSections = exam.sections.filter((section) => section.slot_kind === 'profile');
  if (exam.sections.length > 0 && profileSections.length !== exam.profile_slot_count) {
    errors.push(
      `${exam.code}: profile_slot_count = ${exam.profile_slot_count}, ` +
        `а профильных секций ${profileSections.length}`,
    );
  }

  for (const section of profileSections) {
    if (section.subject_code !== null) {
      errors.push(
        `${exam.code}: профильная секция ${section.slot_index} задаёт предмет ` +
          `"${section.subject_code}", хотя его выбирает ученик`,
      );
    }
  }

  const declared = new Set(
    exam.subject_options.map((option) => `${option.slot_kind}:${option.subject_code}`),
  );
  for (const section of exam.sections) {
    if (section.subject_code === null) {
      continue;
    }
    if (!declared.has(`${section.slot_kind}:${section.subject_code}`)) {
      errors.push(
        `${exam.code}: предмет "${section.subject_code}" из секции ${section.slot_kind} ` +
          `${section.slot_index} не заявлен в subject_options`,
      );
    }
  }

  const slots = new Set<string>();
  for (const section of exam.sections) {
    const slot = `${section.slot_kind}:${section.slot_index}`;
    if (slots.has(slot)) {
      errors.push(`${exam.code}: секция ${slot} объявлена дважды`);
    }
    slots.add(slot);
  }

  if (errors.length > 0) {
    throw new ContentValidationError(file, errors);
  }
}

async function loadExams(sql: SqlExecutor): Promise<number> {
  const file = 'exams.json';
  const { exams } = readJson(file, examsFileSchema);

  for (const exam of exams) {
    const sectionsTotal = exam.sections.reduce((sum, section) => sum + section.max_points, 0);
    if (exam.sections.length > 0 && Math.abs(sectionsTotal - exam.max_score) > 0.01) {
      throw new ContentValidationError(file, [
        `${exam.code}: сумма секций ${sectionsTotal} не совпадает с max_score ${exam.max_score}`,
      ]);
    }

    if (
      exam.grade_min !== null &&
      exam.grade_max !== null &&
      exam.grade_min > exam.grade_max
    ) {
      throw new ContentValidationError(file, [`${exam.code}: grade_min больше grade_max`]);
    }

    assertBlueprintMatchesSubjects(file, exam);

    const [examRow] = await sql<{ id: string }[]>`
      insert into public.exam_profiles (
        code, title_ru, goal, scale_kind, max_score, profile_slot_count,
        grade_min, grade_max, time_limit_sec, is_active
      ) values (
        ${exam.code}, ${exam.title_ru}, ${exam.goal}::public.learning_goal,
        ${exam.scale_kind}, ${exam.max_score}, ${exam.profile_slot_count},
        ${exam.grade_min}, ${exam.grade_max}, ${exam.time_limit_sec}, ${exam.is_active}
      )
      on conflict (code) do update set
        title_ru = excluded.title_ru, goal = excluded.goal, scale_kind = excluded.scale_kind,
        max_score = excluded.max_score, profile_slot_count = excluded.profile_slot_count,
        grade_min = excluded.grade_min, grade_max = excluded.grade_max,
        time_limit_sec = excluded.time_limit_sec, is_active = excluded.is_active
      returning id
    `;
    if (examRow === undefined) {
      throw new ContentValidationError(file, [`${exam.code}: не удалось сохранить экзамен`]);
    }

    await sql`delete from public.exam_sections where exam_profile_id = ${examRow.id}`;
    for (const section of exam.sections) {
      const subjectId =
        section.subject_code === null ? null : await subjectIdByCode(sql, file, section.subject_code);

      await sql`
        insert into public.exam_sections (
          exam_profile_id, subject_id, slot_kind, slot_index, max_points, question_count, guess_floor
        ) values (
          ${examRow.id}, ${subjectId}, ${section.slot_kind}, ${section.slot_index},
          ${section.max_points}, ${section.question_count}, ${section.guess_floor}
        )
      `;
    }

    await sql`delete from public.exam_subject_options where exam_profile_id = ${examRow.id}`;
    for (const option of exam.subject_options) {
      const subjectId = await subjectIdByCode(sql, file, option.subject_code);
      await sql`
        insert into public.exam_subject_options (exam_profile_id, subject_id, slot_kind, sort_order)
        values (${examRow.id}, ${subjectId}, ${option.slot_kind}, ${option.sort_order})
      `;
    }

    await sql`delete from public.exam_profile_pairs where exam_profile_id = ${examRow.id}`;
    for (const pair of exam.profile_pairs) {
      const [first, second] = pair.subjects;
      if (first === second) {
        throw new ContentValidationError(file, [`${exam.code}: пара из одного предмета "${first}"`]);
      }

      const allowed = new Set(
        exam.subject_options
          .filter((option) => option.slot_kind === 'profile')
          .map((option) => option.subject_code),
      );
      for (const subjectCode of pair.subjects) {
        if (!allowed.has(subjectCode)) {
          throw new ContentValidationError(file, [
            `${exam.code}: предмет "${subjectCode}" в паре не заявлен профильным в subject_options`,
          ]);
        }
      }

      const ids = await Promise.all(
        pair.subjects.map(async (subjectCode) => subjectIdByCode(sql, file, subjectCode)),
      );
      const [subjectA, subjectB] = [...ids].sort();

      await sql`
        insert into public.exam_profile_pairs (
          exam_profile_id, subject_a_id, subject_b_id, sort_order, is_active
        ) values (${examRow.id}, ${subjectA ?? ''}, ${subjectB ?? ''}, ${pair.sort_order}, true)
      `;
    }
  }

  return exams.length;
}

async function upsertQuestion(
  sql: SqlExecutor,
  file: string,
  question: ContentQuestion,
  pool: 'diagnostic' | 'exam_mock',
): Promise<string> {
  const topic = await topicByCode(sql, file, question.topic_code);

  const [row] = await sql<{ id: string }[]>`
    insert into public.questions (
      content_code, origin, bank_pool, kind, subject_id, topic_id, grade, difficulty,
      prompt_md, options, answer_key, rubric_md, explanation_md, points, is_active
    ) values (
      ${question.code}, 'bank', ${pool}, ${question.kind}::public.question_kind,
      ${topic.subjectId}, ${topic.id}, ${question.grade}, ${question.difficulty},
      ${question.prompt_md},
      ${question.options === null ? null : sql.json(question.options)},
      ${sql.json(question.answer_key)},
      ${question.rubric_md}, ${question.explanation_md}, ${question.points}, true
    )
    on conflict (content_code) where content_code is not null do update set
      bank_pool = excluded.bank_pool, kind = excluded.kind, subject_id = excluded.subject_id,
      topic_id = excluded.topic_id, grade = excluded.grade, difficulty = excluded.difficulty,
      prompt_md = excluded.prompt_md, options = excluded.options, answer_key = excluded.answer_key,
      rubric_md = excluded.rubric_md, explanation_md = excluded.explanation_md,
      points = excluded.points, is_active = true
    returning id
  `;

  if (row === undefined) {
    throw new ContentValidationError(file, [`${question.code}: не удалось сохранить вопрос`]);
  }
  return row.id;
}

async function retirePool(
  sql: SqlExecutor,
  pool: 'diagnostic' | 'exam_mock',
  keepCodes: readonly string[],
): Promise<number> {
  const retired = await sql<{ content_code: string }[]>`
    update public.questions
       set is_active = false
     where bank_pool = ${pool}
       and origin = 'bank'
       and is_active
       and content_code is not null
       and content_code <> all(${[...keepCodes]}::text[])
    returning content_code
  `;

  return retired.length;
}

async function loadDiagnostic(
  sql: SqlExecutor,
  placeholders: Placeholder[],
): Promise<{ questions: number; retired: number }> {
  const file = 'questions/diagnostic.json';
  const parsed = readJson(file, diagnosticFileSchema);
  notePlaceholder(file, parsed, placeholders);

  for (const question of parsed.questions) {
    await upsertQuestion(sql, file, question, 'diagnostic');
  }

  const retired = await retirePool(
    sql,
    'diagnostic',
    parsed.questions.map((question) => question.code),
  );

  return { questions: parsed.questions.length, retired };
}

interface ExamShape {
  readonly id: string;
  readonly gradeMin: number | null;
  readonly gradeMax: number | null;
  readonly subjectCodes: ReadonlySet<string>;
}

async function examShape(sql: SqlExecutor, file: string, examCode: string): Promise<ExamShape> {
  const [exam] = await sql<
    { id: string; grade_min: number | null; grade_max: number | null }[]
  >`
    select id, grade_min, grade_max from public.exam_profiles where code = ${examCode}
  `;

  if (exam === undefined) {
    throw new ContentValidationError(file, [`экзамен "${examCode}" не найден в exams.json`]);
  }

  const subjects = await sql<{ code: string }[]>`
    select distinct s.code
      from public.subjects s
     where s.id in (
       select sec.subject_id from public.exam_sections sec
        where sec.exam_profile_id = ${exam.id} and sec.subject_id is not null
       union
       select opt.subject_id from public.exam_subject_options opt
        where opt.exam_profile_id = ${exam.id}
     )
  `;

  return {
    id: exam.id,
    gradeMin: exam.grade_min,
    gradeMax: exam.grade_max,
    subjectCodes: new Set(subjects.map((row) => row.code)),
  };
}

async function assertQuestionFitsExam(
  sql: SqlExecutor,
  file: string,
  question: ContentQuestion,
  exam: ExamShape,
): Promise<void> {
  const [row] = await sql<
    { subject_code: string; grade_min: number; grade_max: number }[]
  >`
    select s.code as subject_code, t.grade_min, t.grade_max
      from public.topics t
      join public.subjects s on s.id = t.subject_id
     where t.code = ${question.topic_code}
  `;

  if (row === undefined) {
    return;
  }

  const errors: string[] = [];

  if (!exam.subjectCodes.has(row.subject_code)) {
    errors.push(
      `${question.code}: предмет "${row.subject_code}" не входит в чертёж экзамена`,
    );
  }

  if (
    exam.gradeMin !== null &&
    exam.gradeMax !== null &&
    (row.grade_min > exam.gradeMax || row.grade_max < exam.gradeMin)
  ) {
    errors.push(
      `${question.code}: тема за ${row.grade_min}-${row.grade_max} классы вне ` +
        `программы экзамена (${exam.gradeMin}-${exam.gradeMax})`,
    );
  }

  if (errors.length > 0) {
    throw new ContentValidationError(file, errors);
  }
}

async function loadMocks(
  sql: SqlExecutor,
  placeholders: Placeholder[],
): Promise<{ mocks: number; questions: number; retired: number }> {
  let mockCount = 0;
  let questionCount = 0;
  const keepCodes: string[] = [];

  for (const file of listJson('questions').filter((name) => name.includes('mock'))) {
    const raw = readJsonRaw(file);
    const isPool = !isJsonObject(raw) || !('mock' in raw);

    if (isPool) {
      const pool = readJson(file, mockPoolFileSchema);
      notePlaceholder(file, pool, placeholders);

      const exam = await examShape(sql, file, pool.exam_code);
      for (const question of pool.questions) {
        await assertQuestionFitsExam(sql, file, question, exam);
        await upsertQuestion(sql, file, question, 'exam_mock');
        keepCodes.push(question.code);
      }
      questionCount += pool.questions.length;
      continue;
    }

    const parsed = readJson(file, mockFileSchema);
    notePlaceholder(file, parsed, placeholders);

    const shape = await examShape(sql, file, parsed.exam_code);
    const questionIds: string[] = [];
    for (const question of parsed.questions) {
      await assertQuestionFitsExam(sql, file, question, shape);
      questionIds.push(await upsertQuestion(sql, file, question, 'exam_mock'));
      keepCodes.push(question.code);
    }
    questionCount += parsed.questions.length;

    const [exam] = await sql<{ id: string }[]>`
      select id from public.exam_profiles where code = ${parsed.exam_code}
    `;
    if (exam === undefined) {
      throw new ContentValidationError(file, [`экзамен "${parsed.exam_code}" не найден в exams.json`]);
    }

    const totalPoints = parsed.questions.reduce((sum, question) => sum + question.points, 0);

    const [mock] = await sql<{ id: string }[]>`
      insert into public.assessments (
        content_code, kind, title, exam_profile_id, student_id, grade,
        time_limit_sec, total_points, outline, is_active
      ) values (
        ${parsed.mock.code}, 'exam_mock', ${parsed.mock.title}, ${exam.id}, null,
        ${parsed.mock.grade}, ${parsed.mock.time_limit_sec}, ${totalPoints},
        ${sql.json(parsed.mock.outline)}, true
      )
      on conflict (content_code) where content_code is not null do update set
        title = excluded.title, exam_profile_id = excluded.exam_profile_id,
        grade = excluded.grade, time_limit_sec = excluded.time_limit_sec,
        total_points = excluded.total_points, outline = excluded.outline, is_active = true
      returning id
    `;
    if (mock === undefined) {
      throw new ContentValidationError(file, [`${parsed.mock.code}: не удалось сохранить пробник`]);
    }

    await sql`delete from public.assessment_questions where assessment_id = ${mock.id}`;
    let position = 1;
    for (const questionId of questionIds) {
      await sql`
        insert into public.assessment_questions (assessment_id, question_id, position)
        values (${mock.id}, ${questionId}, ${position})
      `;
      position += 1;
    }

    mockCount += 1;
  }

  return {
    mocks: mockCount,
    questions: questionCount,
    retired: await retirePool(sql, 'exam_mock', keepCodes),
  };
}

async function loadLessons(
  sql: SqlExecutor,
  placeholders: Placeholder[],
): Promise<{ lessons: number; retired: number }> {
  const files = [...listJson('lessons')];
  if (existsSync(join(CONTENT_DIR, 'lessons.json'))) {
    files.push('lessons.json');
  }

  let count = 0;
  const seenCodes: string[] = [];

  for (const file of files) {
    const parsed = readJson(file, lessonsFileSchema);
    notePlaceholder(file, parsed, placeholders);
    count += parsed.lessons.length;

    await loadLessonBatch(sql, file, parsed.lessons, seenCodes);
  }

  const retired = await sql<{ content_code: string }[]>`
    update public.lessons
       set is_active = false
     where is_active
       and origin = 'curated'
       and content_code is not null
       and content_code <> all(${[...seenCodes]}::text[])
    returning content_code
  `;

  return { lessons: count, retired: retired.length };
}

type LessonInput = LessonsFile['lessons'][number];

export function sanitizeLessonMaterial(
  file: string,
  lesson: LessonInput,
): { title: string; summary: string | null; bodyMd: string; aiText: string | null } {
  const { bodyMd, blocks } = sanitizeMarkdown(lesson.material.body_md);

  if (bodyMd === '') {
    throw new ContentValidationError(file, [
      `${lesson.code}: после санитизации от материала ничего не осталось`,
    ]);
  }

  const uncapped = normalizeMarkdown(lesson.material.body_md, {
    maxLength: Number.MAX_SAFE_INTEGER,
  });
  if (uncapped !== bodyMd) {
    throw new ContentValidationError(file, [
      `${lesson.code}: материал длиннее ${MARKDOWN_LIMITS.material} символов и был бы обрезан`,
    ]);
  }

  if (blocks.length >= MARKDOWN_LIMITS.maxBlocks) {
    throw new ContentValidationError(file, [
      `${lesson.code}: в материале больше ${MARKDOWN_LIMITS.maxBlocks} блоков`,
    ]);
  }

  const summary =
    lesson.material.summary === null ? null : normalizeMarkdown(lesson.material.summary) || null;
  const aiText =
    lesson.material.ai_text === null ? null : normalizeMarkdown(lesson.material.ai_text) || null;

  return { title: normalizeMarkdown(lesson.material.title), summary, bodyMd, aiText };
}

async function loadLessonBatch(
  sql: SqlExecutor,
  file: string,
  lessons: readonly LessonInput[],
  seenCodes: string[],
): Promise<void> {
  for (const lesson of lessons) {
    const topic = await topicByCode(sql, file, lesson.topic_code);
    const material = sanitizeLessonMaterial(file, lesson);

    const [row] = await sql<{ id: string }[]>`
      insert into public.materials (
        content_code, kind, format, subject_id, grade_min, grade_max, title, summary,
        body_md, ai_text, status, content_hash, est_read_minutes
      ) values (
        ${lesson.code}, 'library', 'markdown', ${topic.subjectId},
        ${lesson.grade_min}, ${lesson.grade_max}, ${material.title},
        ${material.summary}, ${material.bodyMd}, ${material.aiText},
        'published', ${contentHash(material.bodyMd)}, ${lesson.material.est_read_minutes}
      )
      on conflict (content_code) where content_code is not null do update set
        subject_id = excluded.subject_id, grade_min = excluded.grade_min,
        grade_max = excluded.grade_max, title = excluded.title, summary = excluded.summary,
        body_md = excluded.body_md, ai_text = excluded.ai_text,
        content_hash = excluded.content_hash,
        est_read_minutes = excluded.est_read_minutes, status = 'published'
      returning id
    `;
    if (row === undefined) {
      throw new ContentValidationError(file, [`${lesson.code}: не удалось сохранить материал`]);
    }

    await sql`
      insert into public.material_topics (material_id, topic_id, weight)
      values (${row.id}, ${topic.id}, 1.0)
      on conflict (material_id, topic_id) do nothing
    `;

    await sql`
      insert into public.lessons (
        content_code, subject_id, topic_id, title, material_id, outline,
        grade_min, grade_max, origin, is_active
      ) values (
        ${lesson.code}, ${topic.subjectId}, ${topic.id}, ${lesson.title}, ${row.id},
        ${sql.json(lesson.outline)}, ${lesson.grade_min}, ${lesson.grade_max},
        'curated', true
      )
      on conflict (content_code) where content_code is not null do update set
        subject_id = excluded.subject_id, topic_id = excluded.topic_id, title = excluded.title,
        material_id = excluded.material_id, outline = excluded.outline,
        grade_min = excluded.grade_min, grade_max = excluded.grade_max, is_active = true
    `;

    seenCodes.push(lesson.code);
  }
}

async function assertPoolsDoNotOverlap(sql: SqlExecutor): Promise<void> {
  const rows = await sql<{ a: string; b: string }[]>`
    select a.content_code as a, b.content_code as b
      from public.questions a
      join public.questions b
        on a.prompt_md = b.prompt_md and a.id <> b.id
     where a.bank_pool = 'diagnostic'
       and b.bank_pool = 'exam_mock'
       and a.is_active and b.is_active
     order by a.content_code, b.content_code
     limit 20
  `;

  if (rows.length > 0) {
    throw new ContentValidationError(
      'questions/',
      rows.map((row) => `${row.b}: повторяет вопрос диагностики ${row.a}`),
    );
  }
}

async function assertMockPoolHasNoRepeats(sql: SqlExecutor): Promise<void> {
  const rows = await sql<{ a: string; b: string }[]>`
    select a.content_code as a, b.content_code as b
      from public.questions a
      join public.questions b
        on a.prompt_md = b.prompt_md and a.id < b.id
     where a.bank_pool = 'exam_mock'
       and b.bank_pool = 'exam_mock'
       and a.is_active and b.is_active
     order by a.content_code, b.content_code
     limit 20
  `;

  if (rows.length > 0) {
    throw new ContentValidationError(
      'questions/',
      rows.map((row) => `${row.b}: повторяет задание пробника ${row.a}`),
    );
  }
}

export async function loadContent(sql: SqlExecutor): Promise<LoadReport> {
  const placeholders: Placeholder[] = [];

  const subjects = await loadSubjects(sql);
  const topicResult = await loadTopics(sql, placeholders);
  const goals = await loadGoals(sql);
  const exams = await loadExams(sql);
  const lessonResult = await loadLessons(sql, placeholders);
  const diagnostic = await loadDiagnostic(sql, placeholders);
  const mockResult = await loadMocks(sql, placeholders);

  await assertPoolsDoNotOverlap(sql);
  await assertMockPoolHasNoRepeats(sql);

  return {
    subjects,
    topics: topicResult.topics,
    prerequisites: topicResult.prerequisites,
    goals,
    exams,
    lessons: lessonResult.lessons,
    questions: diagnostic.questions + mockResult.questions,
    mocks: mockResult.mocks,
    retired:
      diagnostic.retired + mockResult.retired + topicResult.retired + lessonResult.retired,
    placeholders,
  };
}
