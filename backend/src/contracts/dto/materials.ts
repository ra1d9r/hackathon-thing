import { z } from 'zod';

import { MAX_GRADE, MIN_GRADE } from '../domain.js';
import { blocksSchema, MARKDOWN_LIMITS } from '../markdown.js';

export const materialFormatSchema = z.enum([
  'markdown',
  'pdf',
  'docx',
  'pptx',
  'txt',
  'video',
  'link',
]);

export const materialFileSchema = z.object({
  id: z.uuid(),
  original_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
});

export const materialSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['library', 'teacher_upload', 'teacher_link', 'teacher_text']),
  format: materialFormatSchema,
  title: z.string(),
  summary: z.string().nullable(),
  
  content_hash: z.string(),
  
  body_md: z.string().nullable(),
  
  body_blocks: blocksSchema.nullable(),
  file: materialFileSchema.nullable(),
  external_url: z.string().nullable(),
  subject: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  class_id: z.uuid().nullable(),
  grade_min: z.number().int().nullable(),
  grade_max: z.number().int().nullable(),
  est_read_minutes: z.number().int().nullable(),
  status: z.enum(['draft', 'published', 'blocked']),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const materialListResponseSchema = z.object({
  materials: z.array(materialSchema),
  empty_reason: z.enum(['no_materials']).nullable(),
});

export const materialResponseSchema = z.object({ material: materialSchema });

const commonFields = {
  title: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  subject_code: z.string().min(1).max(40).optional(),
  class_id: z.uuid().optional(),
  topic_ids: z.array(z.uuid()).max(10).optional(),
  grade_min: z.number().int().min(MIN_GRADE).max(MAX_GRADE).optional(),
  grade_max: z.number().int().min(MIN_GRADE).max(MAX_GRADE).optional(),
};

export const createMaterialSchema = z.discriminatedUnion('format', [
  z
    .object({
      ...commonFields,
      format: z.literal('markdown'),
      body_md: z.string().min(1).max(MARKDOWN_LIMITS.material),
    })
    .strict(),
  z
    .object({
      ...commonFields,
      format: z.literal('link'),
      external_url: z.string().min(4).max(2000),
    })
    .strict(),
  z
    .object({
      ...commonFields,
      format: z.enum(['pdf', 'docx', 'pptx', 'txt', 'video']),
      
      file_id: z.uuid(),
    })
    .strict(),
]);

export const patchMaterialSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    summary: z.string().max(500).optional(),
    body_md: z.string().min(1).max(MARKDOWN_LIMITS.material).optional(),
    status: z.enum(['draft', 'published']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'нечего менять' });

export const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(200),
  mime_type: z.string().min(3).max(120),
  size_bytes: z.number().int().positive(),
  
  class_id: z.uuid().optional(),
});

export const uploadUrlResponseSchema = z.object({
  file_id: z.uuid(),
  upload_url: z.string(),
  token: z.string(),
  path: z.string(),
  expires_in_sec: z.number().int(),
  
  format: materialFormatSchema,
});

export const fileUrlResponseSchema = z.object({
  url: z.string(),
  expires_in_sec: z.number().int(),
  original_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
});

export const materialQuerySchema = z.object({
  class_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type MaterialView = z.infer<typeof materialSchema>;
export type CreateMaterialRequest = z.infer<typeof createMaterialSchema>;
export type PatchMaterialRequest = z.infer<typeof patchMaterialSchema>;
export type UploadUrlRequest = z.infer<typeof uploadUrlSchema>;
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;
export type MaterialListResponse = z.infer<typeof materialListResponseSchema>;
export type MaterialResponse = z.infer<typeof materialResponseSchema>;
export type FileUrlResponse = z.infer<typeof fileUrlResponseSchema>;
export type MaterialQuery = z.infer<typeof materialQuerySchema>;
