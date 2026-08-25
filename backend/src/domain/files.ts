

export const MATERIAL_FORMATS = ['pdf', 'docx', 'pptx', 'txt', 'video'] as const;
export type MaterialFileFormat = (typeof MATERIAL_FORMATS)[number];

const MB = 1024 * 1024;

export interface FileTypeSpec {
  readonly format: MaterialFileFormat;
  readonly extension: string;
  readonly maxBytes: number;
}

export const ALLOWED_UPLOADS: ReadonlyMap<string, FileTypeSpec> = new Map([
  ['application/pdf', { format: 'pdf', extension: 'pdf', maxBytes: 25 * MB }],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { format: 'docx', extension: 'docx', maxBytes: 25 * MB },
  ],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    { format: 'pptx', extension: 'pptx', maxBytes: 50 * MB },
  ],
  ['text/plain', { format: 'txt', extension: 'txt', maxBytes: 1 * MB }],
  ['video/mp4', { format: 'video', extension: 'mp4', maxBytes: 200 * MB }],
  ['video/quicktime', { format: 'video', extension: 'mov', maxBytes: 200 * MB }],
]);

export function specForMime(mimeType: string): FileTypeSpec | null {
  return ALLOWED_UPLOADS.get(mimeType.toLowerCase().trim()) ?? null;
}

export const MAGIC_HEAD_BYTES = 4096;

const ZIP_SIGNATURES: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04], 
  [0x50, 0x4b, 0x05, 0x06], 
  [0x50, 0x4b, 0x07, 0x08], 
];

function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => head[index] === byte);
}

function isZip(head: Uint8Array): boolean {
  return ZIP_SIGNATURES.some((signature) => startsWith(head, signature));
}

function isIsoMedia(head: Uint8Array): boolean {
  return (
    head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70 
  );
}

function looksLikeText(head: Uint8Array): boolean {
  for (const byte of head) {
    if (byte === 0x00) {
      return false;
    }
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      return false;
    }
  }
  return true;
}

function ooxmlHint(head: Uint8Array): 'docx' | 'pptx' | null {
  const text = new TextDecoder('latin1').decode(head);

  if (text.includes('word/')) {
    return 'docx';
  }
  if (text.includes('ppt/')) {
    return 'pptx';
  }
  return null;
}

export interface MagicCheck {
  readonly ok: boolean;
  
  readonly reason: string | null;
}

export function checkMagic(format: MaterialFileFormat, head: Uint8Array): MagicCheck {
  if (head.length === 0) {
    return { ok: false, reason: 'файл пуст' };
  }

  switch (format) {
    case 'pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46]) 
        ? { ok: true, reason: null }
        : { ok: false, reason: 'содержимое не похоже на PDF' };

    case 'docx':
    case 'pptx': {
      if (!isZip(head)) {
        return { ok: false, reason: 'содержимое не похоже на документ Office' };
      }
      const hint = ooxmlHint(head);
      if (hint !== null && hint !== format) {
        return { ok: false, reason: `внутри архива ${hint}, а заявлен ${format}` };
      }
      return { ok: true, reason: null };
    }

    case 'txt':
      return looksLikeText(head)
        ? { ok: true, reason: null }
        : { ok: false, reason: 'в текстовом файле двоичные данные' };

    case 'video':
      return isIsoMedia(head)
        ? { ok: true, reason: null }
        : { ok: false, reason: 'содержимое не похоже на видео mp4 или mov' };
  }
}

export const CHECKSUM_MAX_BYTES = 25 * MB;
