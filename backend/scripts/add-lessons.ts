import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';


const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = join(ROOT, 'supabase', 'content');

const inputSchema = z.array(
  z.object({
    topic_code: z.string().min(3),
    summary: z.string().min(40).max(480),
    body_md: z.string().min(300),
  }),
);

const topicsFileSchema = z.object({
  subject_code: z.string(),
  topics: z.array(
    z.object({
      code: z.string(),
      title_ru: z.string(),
      grade_min: z.number().int(),
      grade_max: z.number().int(),
    }),
  ),
});

const lessonsFileSchema = z.object({
  placeholder: z.boolean().default(false),
  lessons: z.array(z.object({ code: z.string(), topic_code: z.string() }).loose()),
});

function readJson<T>(path: string, schema: z.ZodType<T>): T {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${path}: ${parsed.error.issues[0]?.message ?? 'не разобран'}`);
  }
  return parsed.data;
}

function toAiText(bodyMd: string): string {
  return bodyMd
    .replace(/^#+\s*/gmu, '')
    .replace(/\*\*/gu, '')
    .replace(/^\s*[*•]\s*/gmu, '- ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function readMinutes(text: string): number {
  return Math.max(3, Math.min(60, Math.round(text.length / 900)));
}

function main(): void {
  const input = process.argv[2];
  if (input === undefined) {
    console.error('Укажите файл с уроками');
    process.exit(64);
  }

  const entries = readJson(input, inputSchema);

  const topicIndex = new Map<
    string,
    { subject: string; title: string; gradeMin: number; gradeMax: number }
  >();

  const topicsDir = join(CONTENT_DIR, 'topics');
  for (const name of readFileSync(join(topicsDir, '..', 'subjects.json'), 'utf8')
    .match(/"code":\s*"([a-z_]+)"/gu)
    ?.map((match) => match.replace(/.*"([a-z_]+)"$/u, '$1')) ?? []) {
    const path = join(topicsDir, `${name}.json`);
    if (!existsSync(path)) {
      continue;
    }
    const parsed = readJson(path, topicsFileSchema);
    for (const topic of parsed.topics) {
      topicIndex.set(topic.code, {
        subject: parsed.subject_code,
        title: topic.title_ru,
        gradeMin: topic.grade_min,
        gradeMax: topic.grade_max,
      });
    }
  }

  const bySubject = new Map<string, Record<string, unknown>[]>();

  for (const entry of entries) {
    const topic = topicIndex.get(entry.topic_code);
    if (topic === undefined) {
      throw new Error(`нет такой темы: ${entry.topic_code}`);
    }

    const aiText = toAiText(entry.body_md);
    const minutes = readMinutes(aiText);

    const list = bySubject.get(topic.subject) ?? [];
    list.push({
      code: `lesson.${entry.topic_code}`.slice(0, 64),
      topic_code: entry.topic_code,
      title: topic.title,
      grade_min: topic.gradeMin,
      grade_max: topic.gradeMax,
      outline: [
        { step: 1, kind: 'intro', title: 'О чём тема', duration_min: 2 },
        { step: 2, kind: 'reading', title: topic.title.slice(0, 200), duration_min: minutes },
        { step: 3, kind: 'quiz', title: 'Проверка знаний', duration_min: 7 },
      ],
      material: {
        title: topic.title,
        summary: entry.summary,
        body_md: entry.body_md,
        ai_text: aiText,
        est_read_minutes: minutes,
      },
    });
    bySubject.set(topic.subject, list);
  }

  for (const [subject, list] of bySubject) {
    const path = join(CONTENT_DIR, 'lessons', `${subject}.json`);
    const existing = existsSync(path)
      ? readJson(path, lessonsFileSchema)
      : { placeholder: false, lessons: [] };

    const codes = new Set(list.map((lesson) => String(lesson['code'])));
    const merged = [
      ...existing.lessons.filter((lesson) => !codes.has(lesson.code)),
      ...list,
    ].sort((left, right) => String(left['code']).localeCompare(String(right['code'])));

    writeFileSync(path, `${JSON.stringify({ placeholder: false, lessons: merged }, null, 2)}\n`, 'utf8');
    console.log(`${subject}: +${list.length} = ${merged.length}`);
  }
}

main();
