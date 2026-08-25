import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RAW_DIR = join(ROOT, 'docs', 'raw material');
const CONTENT_DIR = join(ROOT, 'supabase', 'content');

const SUBJECT_BY_TITLE: Record<string, string> = {
  'Математика': 'math',
  'Алгебра': 'math',
  'Физика': 'physics',
  'Химия': 'chemistry',
  'Биология': 'biology',
  'Информатика': 'informatics',
  'Русский язык': 'russian_language',
  'История Казахстана': 'kz_history',
  'Казахский язык и литература': 'kazakh_language',
  'Казахский язык': 'kazakh_language',
  'Английский язык': 'english_language',
  'Естествознание': 'natural_science',
};

const PREFIX: Record<string, string> = {
  math: 'math',
  physics: 'phys',
  chemistry: 'chem',
  biology: 'bio',
  informatics: 'inf',
  russian_language: 'rus',
  kz_history: 'hist',
  kazakh_language: 'kaz',
  english_language: 'eng',
  natural_science: 'nat',
};

const EXAM_WEIGHT: Record<string, number> = {
  math: 1.3,
  physics: 1.2,
  chemistry: 1.2,
  biology: 1.2,
  informatics: 1.1,
  kz_history: 1.2,
  russian_language: 1,
  kazakh_language: 1,
  english_language: 1,
  natural_science: 1,
};

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h', һ: 'h',
  ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', і: 'i', ь: '', э: 'e',
  ю: 'yu', я: 'ya',
};

function slug(title: string, limit: number): string {
  const base = title
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/gu, (char) => TRANSLIT[char] ?? char)
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  if (base.length <= limit) {
    return base;
  }

  // Обрезка по границе слова: обрубок посреди слова читается как опечатка.
  const cut = base.slice(0, limit);
  const lastDash = cut.lastIndexOf('-');
  return lastDash > limit / 2 ? cut.slice(0, lastDash) : cut;
}

interface RawTopic {
  readonly subjectCode: string;
  readonly grade: number;
  readonly title: string;
  readonly page: number;
}

function parseTopicList(): RawTopic[] {
  const text = readFileSync(join(RAW_DIR, 'все темы список.txt'), 'utf8');
  const topics: RawTopic[] = [];

  let subjectCode: string | null = null;
  let grade = 0;

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }

    const header = /^(.+?)\s+(\d{1,2})\s+класс$/u.exec(trimmed);
    if (header !== null) {
      const code = SUBJECT_BY_TITLE[header[1] ?? ''];
      if (code === undefined) {
        throw new Error(`неизвестный предмет в списке тем: ${header[1] ?? ''}`);
      }
      subjectCode = code;
      grade = Number(header[2]);
      continue;
    }

    if (/^https?:/u.test(trimmed)) {
      continue;
    }

    const topic = /^(.+?)\s+(\d{1,3})$/u.exec(trimmed);
    if (topic === null || subjectCode === null) {
      continue;
    }

    topics.push({
      subjectCode,
      grade,
      title: (topic[1] ?? '').trim(),
      page: Number(topic[2]),
    });
  }

  return topics;
}

interface TopicEntry {
  code: string;
  title_ru: string;
  grade_min: number;
  grade_max: number;
  exam_weight: number;
  sort_order: number;
}

function buildTopics(raw: readonly RawTopic[]): Map<string, TopicEntry[]> {
  const bySubject = new Map<string, TopicEntry[]>();
  const seen = new Set<string>();

  for (const item of raw) {
    const prefix = PREFIX[item.subjectCode] ?? item.subjectCode;
    let code = `${prefix}.g${item.grade}.${slug(item.title, 48)}`;

    let attempt = 2;
    while (seen.has(code)) {
      code = `${prefix}.g${item.grade}.${slug(item.title, 44)}-${attempt}`;
      attempt += 1;
    }
    seen.add(code);

    const list = bySubject.get(item.subjectCode) ?? [];
    list.push({
      code,
      title_ru: item.title,
      grade_min: item.grade,
      grade_max: item.grade,
      exam_weight: EXAM_WEIGHT[item.subjectCode] ?? 1,
      sort_order: item.grade * 1000 + Math.min(item.page, 999),
    });
    bySubject.set(item.subjectCode, list);
  }

  for (const list of bySubject.values()) {
    list.sort((left, right) => left.sort_order - right.sort_order);
  }

  return bySubject;
}


const MATERIAL_DIR = join(RAW_DIR, 'материал (по предметам)');

const PAGED_FILE_SUBJECT: Record<string, string> = {
  'МАТЕМ': 'math',
  'МАТЕМАТИКА': 'math',
  'ЕСТЕСТВОЗНАНИЕ': 'natural_science',
  'КАЗАХСКИЙ ЯЗЫК': 'kazakh_language',
  'РУССКИЙ ЯЗЫК': 'russian_language',
  'АНГЛИЙСКИЙ ЯЗЫК': 'english_language',
};

const TITLED_FILES: Record<string, { grade: number; subjects: string[] }> = {
  'темы_алгебра_и_физика_7_класс': { grade: 7, subjects: ['math', 'physics'] },
  'химия_7_класс_текст': { grade: 7, subjects: ['chemistry'] },
  'информатика 7': { grade: 7, subjects: ['informatics'] },
  'история казахстана 7': { grade: 7, subjects: ['kz_history'] },
  'русский_язык_7_класс_темы': { grade: 7, subjects: ['russian_language'] },
  'английский_язык_7_класс_читаемый': { grade: 7, subjects: ['english_language'] },
  'Алгебра_и_Физика_8_класс_10_тем_ПОДРОБНО_ЧИСТО': {
    grade: 8,
    subjects: ['math', 'physics'],
  },
  'Химия_и_Биология_8_класс_полные_подробные_чистые': {
    grade: 8,
    subjects: ['chemistry', 'biology'],
  },
  'Казахский_и_Английский_8_класс_10_тем_ФИНАЛ_ПРОВЕРЕНО': {
    grade: 8,
    subjects: ['kazakh_language', 'english_language'],
  },
  'Русский_и_История_8_класс_ПОЛНЫЙ_ЧИСТЫЙ_1': {
    grade: 8,
    subjects: ['russian_language', 'kz_history'],
  },
  'Алгебра_и_Физика_9_класс_10_тем_ПОЛНО_ПОСТРАНИЧНО_1': {
    grade: 9,
    subjects: ['math', 'physics'],
  },
  'Химия_и_Биология_9_класс_ПОЛНЫЙ_ЧИСТЫЙ_ПРОВЕРЕННЫЙ_1': {
    grade: 9,
    subjects: ['chemistry', 'biology'],
  },
  'Информатика_и_Русский_язык_9_класс_10_тем_ПОЛНО_БЕЗ_СОКРАЩЕНИЙ': {
    grade: 9,
    subjects: ['informatics', 'russian_language'],
  },
  'История_Казахстана_и_Казахский_язык_9_класс_ФИНАЛ_ЧИСТЫЙ': {
    grade: 9,
    subjects: ['kz_history', 'kazakh_language'],
  },
  'Алгебра_и_Физика_10_класс_10_тем_ПОЛНО_БЕЗ_СОКРАЩЕНИЙ_ПРОВЕРЕНО': {
    grade: 10,
    subjects: ['math', 'physics'],
  },
  'Химия_и_Биология_10_класс_ПОЛНЫЙ_ТЕКСТ_ПРОВЕРЕНО': {
    grade: 10,
    subjects: ['chemistry', 'biology'],
  },
  'Информатика_и_Русский_язык_10_класс_10_тем_ПОЛНО_БЕЗ_СОКРАЩЕНИЙ': {
    grade: 10,
    subjects: ['informatics', 'russian_language'],
  },
  'История_Казахстана_и_Казахский_язык_10_класс_ОКОНЧАТЕЛЬНЫЙ_ПОЛНЫЙ': {
    grade: 10,
    subjects: ['kz_history', 'kazakh_language'],
  },
  'Английский_язык_10_класс_5_тем_ПОЛНЫЙ_БЕЗ_СОКРАЩЕНИЙ_ФИНАЛ': {
    grade: 10,
    subjects: ['english_language'],
  },
};

interface RawLesson {
  readonly subjectCode: string;
  readonly grade: number;
  readonly page: number | null;
  readonly topicCode: string | null;
  readonly body: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .trim();
}

function parsePagedMaterials(): RawLesson[] {
  const lessons: RawLesson[] = [];

  for (const name of readdirSync(MATERIAL_DIR).filter((file) => file.endsWith('.txt'))) {
    const header = /^(\d{1,2})\s+класс\s+(.+)\.txt$/u.exec(name);
    if (header === null) {
      continue;
    }

    const grade = Number(header[1]);
    const subjectCode = PAGED_FILE_SUBJECT[(header[2] ?? '').trim()];
    if (subjectCode === undefined) {
      throw new Error(`неизвестный предмет в имени файла: ${name}`);
    }

    const text = readFileSync(join(MATERIAL_DIR, name), 'utf8').replace(/\r\n/gu, '\n');
    const parts = text.split(/^\s*(\d{1,3})\s+СТРАНИЦ[АЫ]?\s*$/gmu);

    for (let index = 1; index < parts.length; index += 2) {
      const page = Number(parts[index]);
      const body = (parts[index + 1] ?? '').trim();
      if (body !== '') {
        lessons.push({ subjectCode, grade, page, topicCode: null, body: trimBody(body) });
      }
    }
  }

  return lessons;
}

const TITLE_SLACK = 60;

const MAX_BODY_CHARS = 20_000;

function trimBody(body: string): string {
  const cleaned = body
    .split('\n')
    .filter((line) => !/^[=-]{10,}\s*$/u.test(line))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (cleaned.length <= MAX_BODY_CHARS) {
    return cleaned;
  }

  const cut = cleaned.slice(0, MAX_BODY_CHARS);
  const lastBreak = cut.lastIndexOf('\n\n');
  return (lastBreak > MAX_BODY_CHARS / 2 ? cut.slice(0, lastBreak) : cut).trim();
}

function stripNumbering(line: string): string {
  return line.replace(/^(?:тема|глава|параграф|раздел)?\s*\d+(?:[\s.]\d+)*\s*/u, '');
}

const MIN_BODY_CHARS = 600;

function parseTitledMaterials(topics: ReadonlyMap<string, TopicEntry[]>): {
  lessons: RawLesson[];
  problems: string[];
} {
  const lessons: RawLesson[] = [];
  const problems: string[] = [];

  for (const [base, meta] of Object.entries(TITLED_FILES)) {
    const path = join(MATERIAL_DIR, `${base}.txt`);
    if (!existsSync(path)) {
      problems.push(`нет файла: ${base}.txt`);
      continue;
    }

    const lines = readFileSync(path, 'utf8').replace(/\r\n/gu, '\n').split('\n');
    const normalized = lines.map(normalize);

    const found: { topic: TopicEntry; subjectCode: string; line: number }[] = [];

    for (const subjectCode of meta.subjects) {
      const candidates = (topics.get(subjectCode) ?? []).filter(
        (topic) => topic.grade_min === meta.grade,
      );

      for (const topic of candidates) {
        const title = normalize(topic.title_ru);
        const words = title.split(' ');

        const shortest = Math.min(3, words.length);

        let line = -1;
        for (let length = Math.min(words.length, 6); length >= shortest && line === -1; length -= 1) {
          const key = words.slice(0, length).join(' ');
          line = normalized.findIndex(
            (candidate) =>
              stripNumbering(candidate).startsWith(key) &&
              candidate.length < title.length + TITLE_SLACK,
          );
        }

        if (line === -1) {
          problems.push(`${base}: не найдена тема «${topic.title_ru}»`);
          continue;
        }

        found.push({ topic, subjectCode, line });
      }
    }

    found.sort((left, right) => left.line - right.line);

    for (const [index, entry] of found.entries()) {
      const end = found[index + 1]?.line ?? lines.length;
      const body = lines.slice(entry.line, end).join('\n').trim();

      if (body.length < MIN_BODY_CHARS) {
        problems.push(`${base}: обрывок вместо текста темы «${entry.topic.title_ru}»`);
        continue;
      }

      lessons.push({
        subjectCode: entry.subjectCode,
        grade: meta.grade,
        page: null,
        topicCode: entry.topic.code,
        body: trimBody(body),
      });
    }
  }

  return { lessons, problems };
}

function lessonTitle(body: string, fallback: string): string {
  const first = body.split('\n').find((line) => line.trim() !== '') ?? '';
  const cleaned = first
    .replace(/\*\*/gu, '')
    .replace(/^#+\s*/u, '')
    .replace(/^§\s*\d+[.)]?\s*/u, '')
    .trim();

  return cleaned === '' ? fallback : cleaned.slice(0, 200);
}

function toAiText(body: string): string {
  return body
    .replace(/\*\*/gu, '')
    .replace(/^#+\s*/gmu, '')
    .replace(/^\s*[*•]\s*/gmu, '- ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function summarize(aiText: string): string {
  const sentences = aiText
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 40 &&
        !trimmed.startsWith('§') &&
        !/^-?\s*(ознакомитесь|научитесь|узнаете|сможете|повторите)/iu.test(trimmed)
      );
    })
    .join(' ')
    .split(/(?<=[.!?])\s+/u);

  let summary = '';
  for (const sentence of sentences) {
    if (summary.length + sentence.length > 420) {
      break;
    }
    summary += (summary === '' ? '' : ' ') + sentence.trim();
  }

  return summary.slice(0, 500);
}

function readMinutes(text: string): number {
  return Math.max(3, Math.min(60, Math.round(text.length / 900)));
}

interface LessonEntry {
  code: string;
  topic_code: string;
  title: string;
  grade_min: number;
  grade_max: number;
  outline: { step: number; kind: string; title: string; duration_min: number | null }[];
  material: {
    title: string;
    summary: string;
    body_md: string;
    ai_text: string;
    est_read_minutes: number;
  };
}

function buildLessons(
  raw: readonly RawLesson[],
  topicsBySubject: ReadonlyMap<string, TopicEntry[]>,
): Map<string, LessonEntry[]> {
  const bySubject = new Map<string, LessonEntry[]>();

  for (const lesson of raw) {
    const topics = topicsBySubject.get(lesson.subjectCode) ?? [];

    const topic =
      lesson.topicCode === null
        ? topics.find(
            (candidate) =>
              candidate.grade_min === lesson.grade &&
              candidate.sort_order === lesson.grade * 1000 + Math.min(lesson.page ?? 0, 999),
          )
        : topics.find((candidate) => candidate.code === lesson.topicCode);

    if (topic === undefined) {
      throw new Error(
        `нет темы для параграфа ${lesson.subjectCode}, ${lesson.grade} класс ` +
          `(${lesson.topicCode ?? `стр. ${lesson.page ?? 0}`})`,
      );
    }

    const title = lessonTitle(lesson.body, topic.title_ru);
    const aiText = toAiText(lesson.body);
    const minutes = readMinutes(aiText);

    const list = bySubject.get(lesson.subjectCode) ?? [];
    list.push({
      code: `lesson.${topic.code}`.slice(0, 64),
      topic_code: topic.code,
      title: topic.title_ru,
      grade_min: lesson.grade,
      grade_max: lesson.grade,
      outline: [
        { step: 1, kind: 'intro', title: 'О чём тема', duration_min: 2 },
        { step: 2, kind: 'reading', title: title.slice(0, 200), duration_min: minutes },
        { step: 3, kind: 'quiz', title: 'Проверка знаний', duration_min: 7 },
      ],
      material: {
        title: topic.title_ru,
        summary: summarize(aiText),
        body_md: lesson.body,
        ai_text: aiText,
        est_read_minutes: minutes,
      },
    });
    bySubject.set(lesson.subjectCode, list);
  }

  return bySubject;
}

function readLessons(path: string): LessonEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('lessons' in parsed) ||
    !Array.isArray(parsed.lessons)
  ) {
    throw new Error(`${path}: нет списка уроков`);
  }

  const lessons: unknown[] = parsed.lessons;

  return lessons.filter((lesson): lesson is LessonEntry => {
    if (typeof lesson !== 'object' || lesson === null || !('topic_code' in lesson)) {
      return false;
    }
    return typeof lesson.topic_code === 'string';
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main(): void {
  const rawTopics = parseTopicList();
  const topics = buildTopics(rawTopics);

  const topicsDir = join(CONTENT_DIR, 'topics');
  for (const [subjectCode, list] of topics) {
    writeJson(join(topicsDir, `${subjectCode}.json`), {
      subject_code: subjectCode,
      placeholder: false,
      topics: list,
    });
  }

  const paged = parsePagedMaterials();
  const titled = parseTitledMaterials(topics);
  const lessons = buildLessons([...paged, ...titled.lessons], topics);

  const lessonsDir = join(CONTENT_DIR, 'lessons');
  if (!existsSync(lessonsDir)) {
    mkdirSync(lessonsDir, { recursive: true });
  }

  for (const [subjectCode, list] of lessons) {
    const path = join(lessonsDir, `${subjectCode}.json`);

    const imported = new Set(list.map((lesson) => lesson.topic_code));
    const handWritten = existsSync(path)
      ? readLessons(path).filter((lesson) => !imported.has(lesson.topic_code))
      : [];

    const merged = [...list, ...handWritten].sort(
      (left, right) => left.grade_min - right.grade_min || left.code.localeCompare(right.code),
    );

    writeJson(path, { placeholder: false, lessons: merged });
  }

  const topicCount = [...topics.values()].reduce((sum, list) => sum + list.length, 0);
  const lessonCount = [...lessons.values()].reduce((sum, list) => sum + list.length, 0);

  console.log(`Темы: ${topicCount} в ${topics.size} предметах`);
  console.log(`Уроки из учебников: ${lessonCount} в ${lessons.size} предметах`);
  for (const [subject, list] of [...lessons].sort()) {
    console.log(`  ${subject}: ${list.length}`);
  }

  const covered = new Set(
    [...lessons.values()].flatMap((list) => list.map((lesson) => lesson.topic_code)),
  );
  const uncovered = [...topics.entries()].flatMap(([subject, list]) =>
    list.filter((topic) => !covered.has(topic.code)).map((topic) => `${subject} ${topic.grade_min}`),
  );

  if (uncovered.length > 0) {
    const counts = new Map<string, number>();
    for (const key of uncovered) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    console.log(`\nБез материала: ${uncovered.length} тем`);
    for (const [key, count] of [...counts].sort()) {
      console.log(`  ${key} класс: ${count}`);
    }
  }

  if (titled.problems.length > 0) {
    console.log(`\nНе разобрано: ${titled.problems.length}`);
    for (const problem of titled.problems) {
      console.log(`  ${problem}`);
    }
  }
}

main();
