export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

export interface ApiErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  request_id: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.retryable = body.retryable;
    this.details = body.details;
  }
}

let tokenProvider: (() => string | null) = () => null;
export function setAuthTokenProvider(fn: () => string | null): void {
  tokenProvider = fn;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

interface CryptoLike {
  randomUUID?: () => string;
}

export function randomUuid(): string {
  const globalCrypto = (globalThis as { crypto?: CryptoLike }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();

  const hex = "0123456789abcdef";
  let out = "";
  for (let index = 0; index < 36; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      out += "-";
    } else if (index === 14) {
      out += "4";
    } else if (index === 19) {
      out += hex[8 + Math.floor(Math.random() * 4)];
    } else {
      out += hex[Math.floor(Math.random() * 16)];
    }
  }
  return out;
}

function randomId(): string {
  const globalCrypto = (globalThis as { crypto?: CryptoLike }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;

  idempotencyKey?: string | null;

  skipIdempotency?: boolean;

  skipAuth?: boolean;
  timeoutMs?: number;
}

function encodeQuery(query: RequestOptions["query"]): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? "" : parts.join("&");
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const base = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const search = encodeQuery(query);
  if (search === "") return base;
  return `${base}${base.includes("?") ? "&" : "?"}${search}`;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const RETRY_PAUSE_MS = 700;

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (!options.skipAuth) {
    const token = tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const mutating = method !== "GET";
  if (mutating && !options.skipIdempotency) {
    headers["Idempotency-Key"] = options.idempotencyKey ?? randomId();
  }

  const url = buildUrl(path, query);
  const payload = body === undefined ? undefined : JSON.stringify(body);

  let response: Response | null = null;
  let lastFailure: ApiError | null = null;

  for (let attempt = 0; attempt < 2 && response === null; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(url, { method, headers, body: payload, signal: controller.signal });
    } catch (error) {
      lastFailure =
        error instanceof Error && error.name === "AbortError"
          ? new ApiError(0, {
              code: "TIMEOUT",
              message: "Сервер не ответил вовремя. Проверьте подключение.",
              retryable: true,
              request_id: "local",
            })
          : new ApiError(0, {
              code: "NETWORK_ERROR",
              message: "Нет соединения с сервером. Проверьте адрес API и подключение к сети.",
              retryable: true,
              request_id: "local",
            });
    } finally {
      clearTimeout(timer);
    }

    if (response === null && lastFailure?.code === "TIMEOUT") break;
    if (response === null && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
  }

  if (response === null) {
    throw lastFailure ?? new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Нет соединения с сервером. Проверьте адрес API и подключение к сети.",
      retryable: true,
      request_id: "local",
    });
  }

  if (response.status === 204 || response.status === 304) {
    return undefined as T;
  }

  const text = await response.text();

  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    if (response.status === 401) {
      onUnauthorized?.();
    }
    throw new ApiError(response.status, {
      code: "BAD_GATEWAY",
      message: "Сервер ответил неразборчиво. Проверьте адрес API.",
      retryable: true,
      request_id: "local",
    });
  }

  if (!response.ok) {
    const errorBody =
      json && typeof json === "object" && "error" in json
        ? (json as { error: ApiErrorBody }).error
        : { code: "UNKNOWN", message: `Ошибка сервера (${response.status})`, retryable: false, request_id: "local" };

    if (response.status === 401) {
      onUnauthorized?.();
    }
    throw new ApiError(response.status, errorBody);
  }

  return json as T;
}

export function apiGet<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
  return apiFetch<T>(path, { method: "GET", query });
}

export function apiPost<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "POST", body });
}

export function apiPatch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "PATCH", body });
}

export function apiDelete<T>(path: string, options?: RequestOptions): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "DELETE" });
}

export interface JobStatusResponse {
  job: {
    id: string;
    op_type: string;
    status: "queued" | "running" | "awaiting_retry" | "succeeded" | "failed" | "canceled" | "dead_letter";
    attempts: number;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    applied: boolean;
    error_code: string | null;
  };
  result_ref: { kind: string; attempt_id: string } | null;
  fallback_applied: boolean;
  retry_after_ms: number | null;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled", "dead_letter"]);

const MIN_POLL_PAUSE_MS = 1_500;

export async function waitForJob(
  jobId: string,
  options: { totalTimeoutMs?: number; waitMs?: number } = {},
): Promise<JobStatusResponse> {
  const totalTimeoutMs = options.totalTimeoutMs ?? 120_000;
  const waitMs = options.waitMs ?? 25_000;
  const deadline = Date.now() + totalTimeoutMs;

  for (;;) {
    const startedAt = Date.now();
    const status = await apiGet<JobStatusResponse>(`/v1/ai/jobs/${jobId}`, { wait_ms: waitMs });
    if (TERMINAL_STATUSES.has(status.job.status)) return status;
    if (Date.now() >= deadline) return status;

    const elapsed = Date.now() - startedAt;
    const pause = Math.max(status.retry_after_ms ?? MIN_POLL_PAUSE_MS, MIN_POLL_PAUSE_MS) - elapsed;
    if (pause > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pause, deadline - Date.now())));
    }
  }
}
