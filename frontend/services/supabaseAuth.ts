/**
 * Прямой вход через Supabase Auth (password grant).
 *
 * Backend не выдаёт токены сам — регистрация создаёт пользователя и профиль
 * (`POST /v1/auth/register`), а подписанный JWT выдаёт Supabase напрямую.
 * Ровно этот путь уже проверен в `backend/test/db/auth-live.test.ts`.
 */

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
}

interface SupabaseTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  msg?: string;
}

function assertConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY не заданы. Проверьте frontend/.env",
    );
  }
}

async function tokenRequest(payload: Record<string, string>, grantType: string): Promise<SupabaseSession> {
  assertConfigured();

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as SupabaseTokenResponse;

  if (!response.ok || !body.access_token || !body.refresh_token) {
    const message = body.error_description ?? body.msg ?? body.error ?? "Не удалось войти";
    throw new Error(message);
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in ?? 3600,
    expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

export function signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
  return tokenRequest({ email, password }, "password");
}

export function refreshSession(refreshToken: string): Promise<SupabaseSession> {
  return tokenRequest({ refresh_token: refreshToken }, "refresh_token");
}
