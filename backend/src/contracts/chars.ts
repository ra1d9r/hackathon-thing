

export const CHAR = {
  tab: String.fromCharCode(0x09),
  lf: String.fromCharCode(0x0a),
  cr: String.fromCharCode(0x0d),
  space: String.fromCharCode(0x20),
} as const;

export type CodeRange = readonly [start: number, end: number];

function escapeCodePoint(code: number): string {
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

export function codeClassBody(ranges: readonly CodeRange[]): string {
  return ranges
    .map(([start, end]) =>
      start === end
        ? escapeCodePoint(start)
        : `${escapeCodePoint(start)}-${escapeCodePoint(end)}`,
    )
    .join('');
}

export function codeClassRegExp(ranges: readonly CodeRange[], flags = 'g'): RegExp {
  return new RegExp(`[${codeClassBody(ranges)}]`, flags);
}

export const CONTROL_RANGES: readonly CodeRange[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
];

export const INVISIBLE_RANGES: readonly CodeRange[] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];
