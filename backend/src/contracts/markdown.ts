import { z } from 'zod';

import {
  CHAR,
  CONTROL_RANGES,
  INVISIBLE_RANGES,
  codeClassBody,
  codeClassRegExp,
} from './chars.js';

export const spanMarkSchema = z.enum(['bold', 'italic', 'underline', 'strike']);
export type SpanMark = z.infer<typeof spanMarkSchema>;

const MARK_ORDER: readonly SpanMark[] = ['bold', 'italic', 'underline', 'strike'];

export const spanSchema = z.object({
  text: z.string(),
  marks: z.array(spanMarkSchema),
});
export type Span = z.infer<typeof spanSchema>;

export const blockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    spans: z.array(spanSchema),
  }),
  z.object({
    type: z.literal('paragraph'),
    spans: z.array(spanSchema),
  }),
  z.object({
    type: z.literal('quote'),
    spans: z.array(spanSchema),
  }),
  z.object({
    type: z.literal('list'),
    items: z.array(z.object({ spans: z.array(spanSchema) })),
  }),
]);
export type Block = z.infer<typeof blockSchema>;

export const blocksSchema = z.array(blockSchema);

export const MARKDOWN_LIMITS = {
  
  material: 20_000,
  
  message: 4_000,
  
  note: 2_000,
  
  maxMarkDepth: 8,
  
  maxBlocks: 2_000,
} as const;

const LF_CLASS = codeClassBody([[0x0a, 0x0a]]);

const HTML_TAG = new RegExp(`<\\/?[a-zA-Z][^${LF_CLASS}>]*>`, 'g');

const DANGEROUS_SCHEME = /(?:javascript|data|vbscript|file)\s*:/gi;

const CONTROL_CHARS = codeClassRegExp(CONTROL_RANGES);
const INVISIBLE_CHARS = codeClassRegExp(INVISIBLE_RANGES);

const EXCESS_BLANK_LINES = new RegExp(`[${LF_CLASS}]{3,}`, 'g');

const TRAILING_WHITESPACE = /\s+$/;

export interface NormalizeOptions {
  readonly maxLength?: number;
}

export function normalizeMarkdown(input: string, options: NormalizeOptions = {}): string {
  const maxLength = options.maxLength ?? MARKDOWN_LIMITS.material;

  let text = input.normalize('NFC');

  
  text = text.split(CHAR.cr + CHAR.lf).join(CHAR.lf);
  text = text.split(CHAR.cr).join(CHAR.lf);

  text = text.replace(HTML_TAG, '');
  text = text.replace(DANGEROUS_SCHEME, '');
  text = text.replace(CONTROL_CHARS, '');
  text = text.replace(INVISIBLE_CHARS, '');
  text = text.split(CHAR.tab).join(CHAR.space);

  text = text
    .split(CHAR.lf)
    .map((line) => line.replace(TRAILING_WHITESPACE, ''))
    .join(CHAR.lf);

  
  text = text.replace(EXCESS_BLANK_LINES, CHAR.lf + CHAR.lf);
  text = text.trim();

  return truncateByCodePoint(text, maxLength);
}

function truncateByCodePoint(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const points = Array.from(text);
  if (points.length <= maxLength) {
    return text;
  }
  return points.slice(0, maxLength).join('').trimEnd();
}

interface Delimiter {
  readonly token: string;
  readonly mark: SpanMark;
}

const DELIMITERS: readonly Delimiter[] = [
  { token: '**', mark: 'bold' },
  { token: '__', mark: 'underline' },
  { token: '~~', mark: 'strike' },
  { token: '*', mark: 'italic' },
];

function withMark(marks: readonly SpanMark[], mark: SpanMark): SpanMark[] {
  if (marks.includes(mark)) {
    return [...marks];
  }
  const next = [...marks, mark];
  return MARK_ORDER.filter((candidate) => next.includes(candidate));
}

function makeSpan(text: string, marks: readonly SpanMark[]): Span[] {
  return text === '' ? [] : [{ text, marks: [...marks] }];
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const merged: Span[] = [];

  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous !== undefined && sameMarks(previous.marks, span.marks)) {
      previous.text += span.text;
      continue;
    }
    merged.push({ text: span.text, marks: [...span.marks] });
  }

  return merged.filter((span) => span.text !== '');
}

function sameMarks(left: readonly SpanMark[], right: readonly SpanMark[]): boolean {
  return left.length === right.length && left.every((mark, index) => mark === right[index]);
}

function parseInline(text: string, marks: readonly SpanMark[], depth: number): Span[] {
  if (depth >= MARKDOWN_LIMITS.maxMarkDepth) {
    return makeSpan(text, marks);
  }

  for (let index = 0; index < text.length; index += 1) {
    for (const { token, mark } of DELIMITERS) {
      if (!text.startsWith(token, index)) {
        continue;
      }

      const contentStart = index + token.length;
      const closeIndex = text.indexOf(token, contentStart);

      
      if (closeIndex === -1 || closeIndex === contentStart) {
        continue;
      }

      return [
        ...makeSpan(text.slice(0, index), marks),
        ...parseInline(text.slice(contentStart, closeIndex), withMark(marks, mark), depth + 1),
        ...parseInline(text.slice(closeIndex + token.length), marks, depth + 1),
      ];
    }
  }

  return makeSpan(text, marks);
}

export function parseSpans(text: string): Span[] {
  return mergeSpans(parseInline(text, [], 0));
}

const HEADING = /^(#{1,3}) +(.*)$/;
const QUOTE = /^> ?(.*)$/;
const LIST_ITEM = /^- +(.*)$/;

type PendingKind = 'paragraph' | 'quote' | 'list';

interface Pending {
  kind: PendingKind;
  lines: string[];
}

export function parseMarkdown(normalized: string): Block[] {
  const blocks: Block[] = [];
  let pending: Pending | null = null;

  const flush = (): void => {
    if (pending === null) {
      return;
    }
    if (blocks.length >= MARKDOWN_LIMITS.maxBlocks) {
      pending = null;
      return;
    }

    switch (pending.kind) {
      case 'paragraph':
        blocks.push({ type: 'paragraph', spans: parseSpans(pending.lines.join(CHAR.lf)) });
        break;
      case 'quote':
        blocks.push({ type: 'quote', spans: parseSpans(pending.lines.join(CHAR.lf)) });
        break;
      case 'list':
        blocks.push({
          type: 'list',
          items: pending.lines.map((line) => ({ spans: parseSpans(line) })),
        });
        break;
    }

    pending = null;
  };

  const append = (kind: PendingKind, line: string): void => {
    if (pending !== null && pending.kind === kind) {
      pending.lines.push(line);
      return;
    }
    flush();
    pending = { kind, lines: [line] };
  };

  for (const line of normalized.split(CHAR.lf)) {
    if (line.trim() === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      if (blocks.length < MARKDOWN_LIMITS.maxBlocks) {
        const level = heading[1]?.length ?? 1;
        blocks.push({
          type: 'heading',
          level: level === 3 ? 3 : level === 2 ? 2 : 1,
          spans: parseSpans(heading[2] ?? ''),
        });
      }
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote !== null) {
      append('quote', quote[1] ?? '');
      continue;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem !== null) {
      append('list', listItem[1] ?? '');
      continue;
    }

    append('paragraph', line);
  }

  flush();
  return blocks;
}

export interface SanitizedMarkdown {
  
  readonly bodyMd: string;
  
  readonly blocks: Block[];
}

export function sanitizeMarkdown(
  input: string,
  options: NormalizeOptions = {},
): SanitizedMarkdown {
  const bodyMd = normalizeMarkdown(input, options);
  return { bodyMd, blocks: parseMarkdown(bodyMd) };
}

export function blocksToPlainText(blocks: readonly Block[]): string {
  const separator = CHAR.lf + CHAR.lf;

  return blocks
    .map((block) => {
      if (block.type === 'list') {
        return block.items
          .map((item) => item.spans.map((span) => span.text).join(''))
          .join(CHAR.lf);
      }
      return block.spans.map((span) => span.text).join('');
    })
    .join(separator);
}
