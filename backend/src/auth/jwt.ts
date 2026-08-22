import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';

import { AppError } from '../contracts/errors.js';
import { requireEnv, type Env } from '../env.js';

const claimsSchema = z.object({
  sub: z.uuid(),
  exp: z.number().int().positive(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  email: z.string().optional(),
  session_id: z.string().optional(),
});

export interface VerifiedToken {
  readonly userId: string;
  readonly email: string | undefined;
  readonly expiresAt: Date;
}

export interface JwtVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export function createJwtVerifier(env: Env): JwtVerifier {
  const supabaseUrl = requireEnv(env, 'SUPABASE_URL', 'проверка токенов');
  const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  });

  return {
    async verify(token: string): Promise<VerifiedToken> {
      let payload: JWTPayload;

      try {
        const result = await jwtVerify(token, jwks, {
          issuer: `${supabaseUrl}/auth/v1`,
          audience: 'authenticated',
        });
        payload = result.payload;
      } catch (cause) {
        throw new AppError('UNAUTHENTICATED', { cause });
      }

      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) {
        throw new AppError('UNAUTHENTICATED', {
          message: 'Токен не содержит нужных данных',
        });
      }

      return {
        userId: claims.data.sub,
        email: claims.data.email,
        expiresAt: new Date(claims.data.exp * 1000),
      };
    },
  };
}

export function extractBearerToken(header: string | undefined): string {
  if (header === undefined) {
    throw new AppError('UNAUTHENTICATED', { message: 'Требуется вход в аккаунт' });
  }

  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (match?.[1] === undefined) {
    throw new AppError('UNAUTHENTICATED', { message: 'Неверный формат заголовка авторизации' });
  }

  return match[1];
}
