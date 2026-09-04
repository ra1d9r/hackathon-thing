import { ApiError } from "@/services/api";

const BY_CODE: Record<string, string> = {
  NOT_FOUND: "Не найдено: похоже, это удалили или ссылка устарела.",
  FORBIDDEN_RESOURCE: "Нет доступа к этому разделу.",
  FORBIDDEN_ROLE: "Действие недоступно для вашей роли.",
  UNAUTHENTICATED: "Сессия истекла. Войдите заново.",
  INVALID_INVITE_CODE: "Неверный код приглашения.",
  ONBOARDING_INCOMPLETE: "Сначала нужно завершить первичный опрос.",
  DIAGNOSTIC_REQUIRED: "Сначала нужно пройти диагностический тест.",
  RATE_LIMITED: "Слишком много запросов подряд. Подождите и попробуйте снова.",
  PAYLOAD_TOO_LARGE: "Файл слишком большой.",
  UNSUPPORTED_FILE_TYPE: "Такой тип файла не поддерживается.",
  TIMEOUT: "Сервер не ответил вовремя. Проверьте подключение.",
  NETWORK_ERROR: "Нет соединения с сервером.",
  BAD_GATEWAY: "Сервер ответил неразборчиво. Проверьте адрес API.",
};

const SERVER_FAULT = "На сервере что-то сломалось. Мы уже знаем, попробуйте позже.";

export interface ErrorNotice {
  message: string;

  retryable: boolean;
  code: string | null;
}

export function describeError(error: unknown, fallback: string): ErrorNotice {
  if (error instanceof ApiError) {
    const message =
      error.status >= 500 ? SERVER_FAULT : (BY_CODE[error.code] ?? error.message ?? fallback);
    return { message, retryable: error.retryable, code: error.code };
  }

  if (error instanceof Error) {
    return { message: error.message || fallback, retryable: false, code: null };
  }

  return { message: fallback, retryable: false, code: null };
}

export function errorText(error: unknown, fallback: string): string {
  return describeError(error, fallback).message;
}
