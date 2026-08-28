import { z } from 'zod';

import { gradeSchema, learningGoalSchema, timeZoneSchema, userRoleSchema } from '../domain.js';

export const emailSchema = z.email().max(254).transform((value) => value.trim().toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'пароль должен быть не короче 8 символов')
  .max(128);

export const displayNameSchema = z.string().trim().min(1).max(64);

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    display_name: displayNameSchema,
    role: userRoleSchema,
    grade: gradeSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.role === 'student' && body.grade === undefined) {
      ctx.addIssue({ code: 'custom', path: ['grade'], message: 'ученику нужно указать класс' });
    }
  });

export const registerResponseSchema = z.object({
  user_id: z.uuid(),
  public_id: z.string(),
  role: userRoleSchema,
  requires_onboarding: z.boolean(),
});

export const teacherRequestSchema = z.object({
  email: emailSchema,
  display_name: displayNameSchema,
  organization_email: emailSchema,
  organization_name: z.string().trim().max(160).optional(),
  message: z.string().trim().max(1000).optional(),
});

export const teacherRequestResponseSchema = z.object({
  request_id: z.uuid(),
  status: z.enum(['pending', 'approved']),
  can_register_now: z.boolean(),
});

export const meResponseSchema = z.object({
  user_id: z.uuid(),
  public_id: z.string(),
  role: userRoleSchema,
  display_name: z.string(),
  grade: z.number().int().nullable(),
  locale: z.string(),
  timezone: z.string(),
  avatar_url: z.string().nullable(),
  created_at: z.iso.datetime(),
  requires_onboarding: z.boolean(),
  student: z
    .object({
      goal: learningGoalSchema.nullable(),
      target_exam_code: z.string().nullable(),
      target_date: z.string().nullable(),
      onboarding_completed_at: z.iso.datetime().nullable(),
      diagnostic_attempt_id: z.uuid().nullable(),
      diagnostic_available: z.boolean(),
      subjects: z.array(
        z.object({
          code: z.string(),
          name: z.string(),
          is_profile: z.boolean(),
        }),
      ),
      class_name: z.string().nullable(),
      streak_days: z.number().int(),
      questions_answered: z.number().int(),
      ai_usage_count: z.number().int(),
    })
    .nullable(),
});

export const updateProfileSchema = z
  .object({
    display_name: displayNameSchema.optional(),
    grade: gradeSchema.optional(),
    locale: z.enum(['ru', 'kk', 'en']).optional(),
    timezone: timeZoneSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'нечего изменять' });

export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const avatarUploadRequestSchema = z.object({
  mime_type: z.enum(AVATAR_MIME_TYPES),
  size_bytes: z.number().int().min(1).max(AVATAR_MAX_BYTES),
});

export const avatarUploadResponseSchema = z.object({
  file_id: z.uuid(),
  upload_url: z.string(),
  token: z.string(),
  path: z.string(),
  expires_in_sec: z.number().int(),
});

export const avatarCommitSchema = z.object({ file_id: z.uuid() });

export const avatarUrlResponseSchema = z.object({
  url: z.string().nullable(),
  expires_in_sec: z.number().int(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type TeacherRequest = z.infer<typeof teacherRequestSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;
