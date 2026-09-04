import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { assertBlueprintMatchesSubjects, sanitizeLessonMaterial } from '../src/content/loader.js';
import {
  diagnosticFileSchema,
  mockPoolFileSchema,
  examsFileSchema,
  lessonsFileSchema,
  topicsFileSchema,
} from '../src/content/schema.js';

function question(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'math.sample.one',
    kind: 'mcq_single',
    topic_code: 'math.trigonometry',
    grade: 11,
    difficulty: 2,
    prompt_md: 'Сколько будет два плюс два?',
    options: [
      { id: 'a', text_md: '3' },
      { id: 'b', text_md: '4' },
    ],
    answer_key: { correct: ['b'] },
    points: 1,
    ...overrides,
  };
}

function parseQuestion(overrides: Record<string, unknown> = {}) {
  return diagnosticFileSchema.safeParse({
    pool: 'diagnostic',
    questions: [question(overrides)],
  });
}

describe('вопросы', () => {
  it('принимает корректный вопрос с выбором ответа', () => {
    expect(parseQuestion().success).toBe(true);
  });

  it('отвергает эталон, которого нет среди вариантов', () => {
    const result = parseQuestion({ answer_key: { correct: ['z'] } });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('не найден среди вариантов');
  });

  it('требует ровно один эталон у вопроса с одним ответом', () => {
    const result = parseQuestion({ answer_key: { correct: ['a', 'b'] } });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('ровно один эталон');
  });

  it('разрешает несколько эталонов у вопроса с множественным выбором', () => {
    expect(
      parseQuestion({
        kind: 'mcq_multi',
        options: [
          { id: 'a', text_md: '3' },
          { id: 'b', text_md: '4' },
          { id: 'c', text_md: '5' },
        ],
        answer_key: { correct: ['a', 'b'] },
      }).success,
    ).toBe(true);
  });

  it('требует не меньше двух эталонов у вопроса с множественным выбором', () => {
    const result = parseQuestion({ kind: 'mcq_multi', answer_key: { correct: ['b'] } });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('не меньше двух эталонов');
  });

  it('отвергает вопрос, где верны все варианты сразу', () => {
    const result = parseQuestion({ kind: 'mcq_multi', answer_key: { correct: ['a', 'b'] } });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('все варианты сразу');
  });

  it('отвергает повторяющийся эталон', () => {
    const result = parseQuestion({
      kind: 'mcq_multi',
      options: [
        { id: 'a', text_md: '3' },
        { id: 'b', text_md: '4' },
        { id: 'c', text_md: '5' },
      ],
      answer_key: { correct: ['a', 'b', 'b'] },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('повторяется');
  });

  it('отвергает повторяющийся идентификатор варианта', () => {
    const result = parseQuestion({
      options: [
        { id: 'a', text_md: '3' },
        { id: 'a', text_md: '4' },
      ],
      answer_key: { correct: ['a'] },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('объявлен дважды');
  });

  it('отвергает эталон, форма которого не отвечает виду вопроса', () => {
    const numericWithChoiceKey = parseQuestion({
      kind: 'numeric',
      options: null,
      answer_key: { correct: ['b'] },
    });

    expect(numericWithChoiceKey.success).toBe(false);
    expect(JSON.stringify(numericWithChoiceKey.error?.issues)).toContain('описывается полем \\"value\\"');

    const choiceWithNumericKey = parseQuestion({ answer_key: { value: 4, tolerance: 0 } });

    expect(choiceWithNumericKey.success).toBe(false);
    expect(JSON.stringify(choiceWithNumericKey.error?.issues)).toContain(
      'описывается полем \\"correct\\"',
    );

    const freeTextWithNumericKey = parseQuestion({
      kind: 'free_text',
      options: null,
      answer_key: { value: 4, tolerance: 0 },
      rubric_md: 'Полный балл: получен верный ответ.',
    });

    expect(freeTextWithNumericKey.success).toBe(false);
    expect(JSON.stringify(freeTextWithNumericKey.error?.issues)).toContain(
      'описывается полем \\"expected_points\\"',
    );
  });

  it('отвергает варианты ответа у вопроса без выбора', () => {
    const result = parseQuestion({ kind: 'numeric', answer_key: { value: 4, tolerance: 0 } });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('только у вопроса с выбором');
  });

  it('требует варианты у вопроса с выбором', () => {
    const result = parseQuestion({ options: null });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('нужны варианты ответа');
  });

  it('требует критерии оценивания у свободного ответа', () => {
    const result = parseQuestion({
      kind: 'free_text',
      options: null,
      answer_key: { expected_points: ['ответ равен четырём'] },
      rubric_md: null,
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('критерии оценивания');
  });

  it('принимает свободный ответ с критериями', () => {
    expect(
      parseQuestion({
        kind: 'free_text',
        options: null,
        answer_key: { expected_points: ['ответ равен четырём'] },
        rubric_md: 'Полный балл: получен верный ответ с пояснением.',
        points: 3,
      }).success,
    ).toBe(true);
  });

  it('принимает числовой ответ с допуском', () => {
    expect(
      parseQuestion({
        kind: 'numeric',
        options: null,
        answer_key: { value: 4, tolerance: 0.01 },
      }).success,
    ).toBe(true);
  });

  it('отвергает код с недопустимыми символами', () => {
    expect(parseQuestion({ code: 'Математика Раз' }).success).toBe(false);
  });

  it('отвергает класс за пределами 5–11', () => {
    expect(parseQuestion({ grade: 4 }).success).toBe(false);
    expect(parseQuestion({ grade: 12 }).success).toBe(false);

    expect(parseQuestion({ grade: 5 }).success).toBe(true);
  });

  it('отвергает больше восьми вариантов', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: String(index),
      text_md: `вариант ${index}`,
    }));

    expect(parseQuestion({ options: many, answer_key: { correct: ['0'] } }).success).toBe(false);
  });
});

describe('темы', () => {
  const base = {
    subject_code: 'math',
    topics: [
      {
        code: 'math.sample',
        title_ru: 'Пример темы',
        grade_min: 9,
        grade_max: 11,
      },
    ],
  };

  it('принимает корректный файл и подставляет значения по умолчанию', () => {
    const result = topicsFileSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.data?.placeholder).toBe(false);
    expect(result.data?.topics[0]?.exam_weight).toBe(1);
    expect(result.data?.topics[0]?.prerequisites).toEqual([]);
  });

  it('отвергает пустой список тем', () => {
    expect(topicsFileSchema.safeParse({ ...base, topics: [] }).success).toBe(false);
  });

  it('отвергает вес темы за пределами шкалы', () => {
    const result = topicsFileSchema.safeParse({
      ...base,
      topics: [{ ...base.topics[0], exam_weight: 9 }],
    });

    expect(result.success).toBe(false);
  });
});

describe('экзамены', () => {
  const exam = {
    code: 'demo_exam',
    title_ru: 'Демонстрационный экзамен',
    goal: 'ent' as const,
    scale_kind: 'points' as const,
    max_score: 100,
    profile_slot_count: 1,
    sections: [
      { slot_kind: 'profile' as const, slot_index: 1, subject_code: null, max_points: 100 },
    ],
    subject_options: [{ subject_code: 'math', slot_kind: 'profile' as const }],
  };

  it('принимает корректный чертёж', () => {
    expect(examsFileSchema.safeParse({ exams: [exam] }).success).toBe(true);
  });

  it('требует цель из известного набора', () => {
    expect(examsFileSchema.safeParse({ exams: [{ ...exam, goal: 'subjects' }] }).success).toBe(
      false,
    );
  });

  it('отвергает более пяти профильных слотов', () => {
    expect(
      examsFileSchema.safeParse({ exams: [{ ...exam, profile_slot_count: 6 }] }).success,
    ).toBe(false);
  });

  describe('сверка чертежа с составом предметов', () => {
    function check(overrides: Record<string, unknown> = {}): () => void {
      const [parsed] = examsFileSchema.parse({ exams: [{ ...exam, ...overrides }] }).exams;
      if (parsed === undefined) {
        throw new Error('разбор чертежа не дал ни одного экзамена');
      }
      return () => {
        assertBlueprintMatchesSubjects('exams.json', parsed);
      };
    }

    it('принимает согласованный чертёж', () => {
      expect(check()).not.toThrow();
    });

    it('отвергает расхождение profile_slot_count с числом секций', () => {
      expect(check({ profile_slot_count: 2 })).toThrow(/profile_slot_count/u);
    });

    it('отвергает предмет секции, не заявленный в subject_options', () => {
      expect(
        check({
          profile_slot_count: 0,
          sections: [
            {
              slot_kind: 'mandatory' as const,
              slot_index: 1,
              subject_code: 'physics',
              max_points: 100,
            },
          ],
        }),
      ).toThrow(/не заявлен в subject_options/u);
    });

    it('отвергает предмет, заявленный для другого вида слота', () => {
      expect(
        check({
          profile_slot_count: 0,
          sections: [
            { slot_kind: 'mandatory' as const, slot_index: 1, subject_code: 'math', max_points: 100 },
          ],
        }),
      ).toThrow(/не заявлен в subject_options/u);
    });

    it('отвергает предмет, назначенный профильной секции', () => {
      expect(
        check({
          sections: [
            { slot_kind: 'profile' as const, slot_index: 1, subject_code: 'math', max_points: 100 },
          ],
        }),
      ).toThrow(/выбирает ученик/u);
    });

    it('отвергает повторяющийся номер секции', () => {
      expect(
        check({
          max_score: 100,
          sections: [
            { slot_kind: 'profile' as const, slot_index: 1, subject_code: null, max_points: 50 },
            { slot_kind: 'profile' as const, slot_index: 1, subject_code: null, max_points: 50 },
          ],
        }),
      ).toThrow(/объявлена дважды/u);
    });
  });
});

describe('уроки', () => {
  const lesson = {
    code: 'lesson.sample',
    topic_code: 'math.trigonometry',
    title: 'Пример урока',
    grade_min: 10,
    grade_max: 11,
    outline: [{ step: 1, kind: 'reading' as const, title: 'Чтение', duration_min: 5 }],
    material: { title: 'Пример', body_md: '# Заголовок' },
  };

  it('принимает корректный урок', () => {
    const result = lessonsFileSchema.safeParse({ lessons: [lesson] });

    expect(result.success).toBe(true);
    expect(result.data?.lessons[0]?.material.est_read_minutes).toBe(5);
  });

  it('требует непустой план урока', () => {
    expect(lessonsFileSchema.safeParse({ lessons: [{ ...lesson, outline: [] }] }).success).toBe(
      false,
    );
  });

  it('отвергает неизвестный вид шага', () => {
    const result = lessonsFileSchema.safeParse({
      lessons: [{ ...lesson, outline: [{ step: 1, kind: 'песня', title: 'Шаг' }] }],
    });

    expect(result.success).toBe(false);
  });
});

describe('банк заданий пробника', () => {
  const question = {
    code: 'mock.ent.math.1',
    kind: 'mcq_single' as const,
    topic_code: 'math.trigonometry',
    grade: 11,
    difficulty: 3,
    prompt_md: 'Вычислите значение выражения.',
    options: [
      { id: 'a', text_md: '1' },
      { id: 'b', text_md: '2' },
    ],
    answer_key: { correct: ['a'] },
    points: 1,
  };

  it('принимает банк без готового пробника', () => {
    const result = mockPoolFileSchema.safeParse({
      pool: 'exam_mock',
      exam_code: 'ent',
      questions: [question],
    });

    expect(result.success).toBe(true);
  });

  it('требует экзамен, к которому относится банк', () => {
    expect(
      mockPoolFileSchema.safeParse({ pool: 'exam_mock', questions: [question] }).success,
    ).toBe(false);
  });

  it('отвергает пустой банк', () => {
    expect(
      mockPoolFileSchema.safeParse({ pool: 'exam_mock', exam_code: 'ent', questions: [] }).success,
    ).toBe(false);
  });

  it('проверяет задания той же схемой, что и остальное наполнение', () => {
    const result = mockPoolFileSchema.safeParse({
      pool: 'exam_mock',
      exam_code: 'ent',
      questions: [{ ...question, answer_key: { value: 4, tolerance: 0 } }],
    });

    expect(result.success).toBe(false);
  });
});

describe('санитизация материала урока', () => {
  function material(overrides: Record<string, unknown> = {}) {
    const [parsed] = lessonsFileSchema.parse({
      lessons: [
        {
          code: 'lesson.sample',
          topic_code: 'math.trigonometry',
          title: 'Пример урока',
          grade_min: 10,
          grade_max: 11,
          outline: [{ step: 1, kind: 'reading' as const, title: 'Чтение', duration_min: 5 }],
          material: { title: 'Пример', body_md: '# Заголовок', ...overrides },
        },
      ],
    }).lessons;
    if (parsed === undefined) {
      throw new Error('разбор урока не дал ни одной записи');
    }

    return sanitizeLessonMaterial('lessons/sample.json', parsed);
  }

  it('вырезает разметку HTML из материала', () => {
    const result = material({ body_md: 'Текст <script>alert(1)</script> дальше' });

    expect(result.bodyMd).not.toContain('<script>');
    expect(result.bodyMd).not.toContain('</script>');
    expect(result.bodyMd).toContain('Текст');
  });

  it('вырезает опасные схемы ссылок', () => {
    const result = material({ body_md: '[ссылка](javascript:alert(1))' });

    expect(result.bodyMd).not.toContain('javascript:');
  });

  it('вырезает невидимые символы', () => {
    const result = material({ body_md: 'слово​слово' });

    expect(result.bodyMd).toBe('словослово');
  });

  it('санитизирует краткое описание и текст для модели', () => {
    const result = material({
      summary: '<b>кратко</b>',
      ai_text: 'для модели <i>курсив</i>',
    });

    expect(result.summary).toBe('кратко');
    expect(result.aiText).toBe('для модели курсив');
  });

  it('отвергает материал, от которого после санитизации ничего не осталось', () => {
    expect(() => material({ body_md: '<div></div>' })).toThrow();
  });

  it('принимает материал ровно по пределу длины', () => {
    expect(material({ body_md: 'я'.repeat(20_000) }).bodyMd).toHaveLength(20_000);
  });

  it('отвергает материал, который был бы молча обрезан', () => {
    const [parsed] = lessonsFileSchema.parse({
      lessons: [
        {
          code: 'lesson.sample',
          topic_code: 'math.trigonometry',
          title: 'Пример урока',
          grade_min: 10,
          grade_max: 11,
          outline: [{ step: 1, kind: 'reading' as const, title: 'Чтение', duration_min: 5 }],
          material: { title: 'Пример', body_md: '# Заголовок' },
        },
      ],
    }).lessons;
    if (parsed === undefined) {
      throw new Error('разбор урока не дал ни одной записи');
    }

    const tooLong = {
      ...parsed,
      material: { ...parsed.material, body_md: 'я'.repeat(20_001) },
    };

    expect(() => sanitizeLessonMaterial('lessons/sample.json', tooLong)).toThrow(/обрезан/u);
  });

  it('сохраняет пустое описание пустым, а не строкой из пробелов', () => {
    expect(material({ summary: '   ' }).summary).toBeNull();
  });
});

describe('пометки заготовок', () => {
  const contentDir = fileURLToPath(new URL('../../supabase/content/', import.meta.url));

  const markSchema = z.object({
    placeholder: z.boolean().optional(),
    _ЗАГОТОВКА: z.string().optional(),
  });

  function contentFiles(): string[] {
    const files: string[] = [];

    for (const entry of readdirSync(contentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const nested of readdirSync(join(contentDir, entry.name))) {
          if (nested.endsWith('.json')) {
            files.push(`${entry.name}/${nested}`);
          }
        }
      } else if (entry.name.endsWith('.json')) {
        files.push(entry.name);
      }
    }

    return files;
  }

  const files = contentFiles();

  it('файлы наполнения на месте', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s: флаг и пояснение объявлены вместе', (file) => {
    const raw: unknown = JSON.parse(readFileSync(join(contentDir, file), 'utf8'));
    const parsed = markSchema.safeParse(raw);

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    const isPlaceholder = parsed.data.placeholder === true;
    const note = parsed.data._ЗАГОТОВКА;

    if (isPlaceholder) {
      expect(note, `${file}: помечен заготовкой, но не сказано, что с ним не так`).toBeDefined();
      expect((note ?? '').length).toBeGreaterThan(10);
    } else {
      expect(note, `${file}: есть пояснение заготовки, но нет флага placeholder`).toBeUndefined();
    }
  });
});
