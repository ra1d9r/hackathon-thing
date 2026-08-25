import { z } from 'zod';

import { MAX_GRADE, MIN_GRADE } from '../domain.js';

export const classSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  grade: z.number().int().nullable(),
  subject: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  is_archived: z.boolean(),
  
  member_count: z.number().int(),
  
  chat_channel_id: z.uuid().nullable(),
  created_at: z.iso.datetime(),
});

export const classListResponseSchema = z.object({
  classes: z.array(classSchema),
  
  empty_reason: z.enum(['no_classes']).nullable(),
});

export const createClassSchema = z.object({
  name: z.string().min(1).max(80),
  grade: z.number().int().min(MIN_GRADE).max(MAX_GRADE).optional(),
  subject_code: z.string().min(1).max(40).optional(),
});

export const patchClassSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    is_archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'нечего менять' });

export const classMemberSchema = z.object({
  student_id: z.uuid(),
  public_id: z.string(),
  display_name: z.string(),
  grade: z.number().int().nullable(),
  joined_at: z.iso.datetime(),
});

export const classMembersResponseSchema = z.object({
  class: classSchema,
  members: z.array(classMemberSchema),
  empty_reason: z.enum(['no_members']).nullable(),
});

export const addMemberSchema = z.object({
  
  public_id: z
    .string()
    .min(4)
    .max(20)
    .transform((value) => value.trim().toUpperCase()),
});

export const addMemberResponseSchema = z.object({
  student: classMemberSchema,
});

export const removeMemberResponseSchema = z.object({
  student_id: z.uuid(),
  removed: z.boolean(),
  member_count: z.number().int(),
});

export const classResponseSchema = z.object({ class: classSchema });

export type ClassView = z.infer<typeof classSchema>;
export type CreateClassRequest = z.infer<typeof createClassSchema>;
export type PatchClassRequest = z.infer<typeof patchClassSchema>;
export type AddMemberRequest = z.infer<typeof addMemberSchema>;
export type ClassListResponse = z.infer<typeof classListResponseSchema>;
export type ClassMembersResponse = z.infer<typeof classMembersResponseSchema>;
export type AddMemberResponse = z.infer<typeof addMemberResponseSchema>;
export type RemoveMemberResponse = z.infer<typeof removeMemberResponseSchema>;
export type ClassResponse = z.infer<typeof classResponseSchema>;
