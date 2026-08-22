import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from '../contracts/errors.js';
import { requireEnv, resolveSupabaseSecretKey, type Env } from '../env.js';

const createdUserSchema = z.object({ id: z.uuid() });

export interface SupabaseAdmin {
  readonly client: SupabaseClient;
  createUser(input: { email: string; password: string }): Promise<string>;
  deleteUser(userId: string): Promise<void>;
  createSignedUploadUrl(
    bucket: string,
    path: string,
  ): Promise<{ signedUrl: string; token: string }>;
  createSignedDownloadUrl(bucket: string, path: string, expiresInSec: number): Promise<string>;
  removeObject(bucket: string, path: string): Promise<void>;
}

export function createSupabaseAdmin(env: Env): SupabaseAdmin {
  const url = requireEnv(env, 'SUPABASE_URL', 'работа с Supabase');
  const { key: secretKey } = resolveSupabaseSecretKey(env);

  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    client,

    async createUser(input) {
      const { data, error } = await client.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });

      if (error !== null) {
        if (error.status === 422 || /already registered|already been registered/i.test(error.message)) {
          throw new AppError('EMAIL_TAKEN', { cause: error });
        }
        throw new AppError('INTERNAL_ERROR', { cause: error });
      }

      const parsed = createdUserSchema.safeParse(data.user);
      if (!parsed.success) {
        throw new AppError('INTERNAL_ERROR', { message: 'Supabase вернул пользователя без идентификатора' });
      }

      return parsed.data.id;
    },

    async deleteUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error !== null) {
        throw new AppError('INTERNAL_ERROR', { cause: error });
      }
    },

    async createSignedUploadUrl(bucket, path) {
      const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);
      if (error !== null) {
        throw new AppError('INTERNAL_ERROR', { cause: error });
      }
      return { signedUrl: data.signedUrl, token: data.token };
    },

    async createSignedDownloadUrl(bucket, path, expiresInSec) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresInSec);
      if (error !== null) {
        throw new AppError('NOT_FOUND', { cause: error });
      }
      return data.signedUrl;
    },

    async removeObject(bucket, path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error !== null) {
        throw new AppError('INTERNAL_ERROR', { cause: error });
      }
    },
  };
}
