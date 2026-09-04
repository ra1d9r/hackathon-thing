import { describe, expect, it } from 'vitest';

import { CHAR } from '../src/contracts/chars.js';
import {
  MARKDOWN_LIMITS,
  blocksToPlainText,
  normalizeMarkdown,
  parseSpans,
  sanitizeMarkdown,
} from '../src/contracts/markdown.js';

function lines(...parts: readonly string[]): string {
  return parts.join(CHAR.lf);
}

describe('normalizeMarkdown', () => {
  it('вырезает HTML-теги, оставляя их содержимое текстом', () => {
    const result = normalizeMarkdown('<script>alert(1)</script> текст');
    expect(result).toBe('alert(1) текст');
    expect(result).not.toContain('<');
  });

  it('вырезает опасные схемы URI', () => {
    expect(normalizeMarkdown('ссылка javascript:evil()')).toBe('ссылка evil()');
    expect(normalizeMarkdown('картинка data:text/html;base64,AA')).toBe(
      'картинка text/html;base64,AA',
    );
    expect(normalizeMarkdown('VBScript : x')).toBe('x');
  });

  it('не трогает сравнение чисел, похожее на тег', () => {
    expect(normalizeMarkdown('если a < b и b > c')).toBe('если a < b и b > c');
  });

  it('удаляет управляющие и невидимые символы', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const rtlOverride = String.fromCharCode(0x202e);
    const bell = String.fromCharCode(0x07);

    expect(normalizeMarkdown(`те${zeroWidth}кст${rtlOverride}${bell}`)).toBe('текст');
  });

  it('приводит переводы строк к одному виду и схлопывает пустые', () => {
    const input = `а${CHAR.cr}${CHAR.lf}б${CHAR.cr}в${CHAR.lf}${CHAR.lf}${CHAR.lf}${CHAR.lf}г`;
    expect(normalizeMarkdown(input)).toBe(lines('а', 'б', 'в', '', 'г'));
  });

  it('убирает хвостовые пробелы и табуляции', () => {
    const input = `строка  ${CHAR.tab}${CHAR.lf}вторая${CHAR.tab}`;
    expect(normalizeMarkdown(input)).toBe(lines('строка', 'вторая'));
  });

  it('обрезает текст по заданному пределу', () => {
    const result = normalizeMarkdown('а'.repeat(50), { maxLength: 10 });
    expect(result).toHaveLength(10);
  });

  it('не разрывает суррогатные пары при обрезке', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const result = normalizeMarkdown(emoji.repeat(5), { maxLength: 3 });
    expect(Array.from(result)).toHaveLength(3);
    expect(result.endsWith(emoji)).toBe(true);
  });
});

describe('parseSpans', () => {
  it('разбирает все четыре начертания из SPEC', () => {
    expect(parseSpans('**ж**')).toEqual([{ text: 'ж', marks: ['bold'] }]);
    expect(parseSpans('*к*')).toEqual([{ text: 'к', marks: ['italic'] }]);
    expect(parseSpans('__п__')).toEqual([{ text: 'п', marks: ['underline'] }]);
    expect(parseSpans('~~з~~')).toEqual([{ text: 'з', marks: ['strike'] }]);
  });

  it('поддерживает вложенность и выдаёт начертания в фиксированном порядке', () => {
    expect(parseSpans('**жирный с *курсивом* внутри**')).toEqual([
      { text: 'жирный с ', marks: ['bold'] },
      { text: 'курсивом', marks: ['bold', 'italic'] },
      { text: ' внутри', marks: ['bold'] },
    ]);
  });

  it('оставляет незакрытый разделитель обычным текстом', () => {
    expect(parseSpans('незакрытый **маркер')).toEqual([
      { text: 'незакрытый **маркер', marks: [] },
    ]);
  });

  it('не считает разметкой пустое содержимое', () => {
    expect(parseSpans('****')).toEqual([{ text: '****', marks: [] }]);
  });

  it('склеивает соседние участки с одинаковым набором начертаний', () => {
    const spans = parseSpans('обычный текст');
    expect(spans).toHaveLength(1);
  });

  it('не уходит в бесконечную рекурсию на глубокой вложенности', () => {
    const deep = '*'.repeat(MARKDOWN_LIMITS.maxMarkDepth * 4);
    expect(() => parseSpans(`${deep}текст${deep}`)).not.toThrow();
  });
});

describe('sanitizeMarkdown', () => {
  it('разбирает заголовки трёх уровней', () => {
    const { blocks } = sanitizeMarkdown(lines('# один', '', '## два', '', '### три'));

    expect(blocks).toEqual([
      { type: 'heading', level: 1, spans: [{ text: 'один', marks: [] }] },
      { type: 'heading', level: 2, spans: [{ text: 'два', marks: [] }] },
      { type: 'heading', level: 3, spans: [{ text: 'три', marks: [] }] },
    ]);
  });

  it('не считает заголовком решётку без пробела', () => {
    const { blocks } = sanitizeMarkdown('#хештег');
    expect(blocks[0]?.type).toBe('paragraph');
  });

  it('объединяет подряд идущие строки цитаты в один блок', () => {
    const { blocks } = sanitizeMarkdown(lines('> первая', '> вторая'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'quote',
      spans: [{ text: `первая${CHAR.lf}вторая`, marks: [] }],
    });
  });

  it('собирает элементы списка в один блок с отдельными пунктами', () => {
    const { blocks } = sanitizeMarkdown(lines('- раз', '- два **жирный**'));

    expect(blocks).toEqual([
      {
        type: 'list',
        items: [
          { spans: [{ text: 'раз', marks: [] }] },
          {
            spans: [
              { text: 'два ', marks: [] },
              { text: 'жирный', marks: ['bold'] },
            ],
          },
        ],
      },
    ]);
  });

  it('разделяет блоки пустой строкой', () => {
    const { blocks } = sanitizeMarkdown(lines('первый', '', 'второй'));
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.type === 'paragraph')).toBe(true);
  });

  it('возвращает канонический текст и дерево, согласованные между собой', () => {
    const { bodyMd, blocks } = sanitizeMarkdown('  <b>жирный</b> текст  ');

    expect(bodyMd).toBe('жирный текст');
    expect(blocksToPlainText(blocks)).toBe('жирный текст');
  });

  it('не оставляет разметки в тексте, собранном из блоков', () => {
    const { blocks } = sanitizeMarkdown('# Тема **важная**');
    expect(blocksToPlainText(blocks)).toBe('Тема важная');
  });

  it('разбирает формулу в ограде и одной строкой', () => {
    const { blocks } = sanitizeMarkdown(lines('$$', 'E = mc^2', '$$', '', '$$a + b$$'));

    expect(blocks).toEqual([
      { type: 'formula', formula: 'E = mc^2' },
      { type: 'formula', formula: 'a + b' },
    ]);
  });

  it('не разбирает разметку внутри формулы', () => {
    const { blocks } = sanitizeMarkdown(lines('$$', 'a * b * c', '$$'));

    expect(blocks).toEqual([{ type: 'formula', formula: 'a * b * c' }]);
  });

  it('не теряет текст незакрытой формулы', () => {
    const { blocks } = sanitizeMarkdown(lines('$$', 'E = mc^2'));

    expect(blocks).toEqual([{ type: 'formula', formula: 'E = mc^2' }]);
  });

  it('превращает помеченную цитату во врезку, а обычную оставляет цитатой', () => {
    const { blocks } = sanitizeMarkdown(
      lines('> [!key] Главное', '> Текст врезки.', '', '> Просто цитата.'),
    );

    expect(blocks).toEqual([
      {
        type: 'callout',
        tone: 'key',
        title: 'Главное',
        spans: [{ text: 'Текст врезки.', marks: [] }],
      },
      { type: 'quote', spans: [{ text: 'Просто цитата.', marks: [] }] },
    ]);
  });

  it('принимает врезку без заголовка и с неизвестным тоном', () => {
    const { blocks } = sanitizeMarkdown(lines('> [!warning]', '> Осторожно.'));

    expect(blocks).toEqual([
      {
        type: 'callout',
        tone: 'warning',
        title: null,
        spans: [{ text: 'Осторожно.', marks: [] }],
      },
    ]);
  });

  it('разбирает таблицу с шапкой и без неё', () => {
    const withHead = sanitizeMarkdown(
      lines('| Шаг | a |', '| --- | --- |', '| 1 | 3 |'),
    ).blocks;
    const withoutHead = sanitizeMarkdown(lines('| 1 | 3 |', '| 2 | 5 |')).blocks;

    expect(withHead).toEqual([
      {
        type: 'table',
        header: [
          { spans: [{ text: 'Шаг', marks: [] }] },
          { spans: [{ text: 'a', marks: [] }] },
        ],
        rows: [
          {
            cells: [
              { spans: [{ text: '1', marks: [] }] },
              { spans: [{ text: '3', marks: [] }] },
            ],
          },
        ],
      },
    ]);

    expect(withoutHead[0]).toMatchObject({ type: 'table', header: [] });
    expect(withoutHead[0]).toMatchObject({ rows: [{}, {}] });
  });

  it('собирает текст врезки и формулы без разметки', () => {
    const { blocks } = sanitizeMarkdown(
      lines('> [!info] Замечание', '> Важное **место**.', '', '$$x = 1$$'),
    );

    expect(blocksToPlainText(blocks)).toBe(
      ['Замечание', 'Важное место.', '', 'x = 1'].join(CHAR.lf),
    );
  });
});
