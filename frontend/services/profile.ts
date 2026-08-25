/**
 * Профиль: смена имени/класса и загрузка аватара.
 *
 * Аватар грузится в три шага (backend/src/modules/profile/routes.ts):
 *   1. `POST /v1/me/avatar/upload-url` — сервер заводит запись файла и выдаёт
 *      подписанную ссылку Supabase Storage;
 *   2. `PUT` самого файла по этой ссылке — минуя backend, чтобы не гонять
 *      мегабайты через API;
 *   3. `POST /v1/me/avatar/commit` — сервер сверяет сигнатуру содержимого
 *      с заявленным типом и только тогда привязывает файл к профилю.
 */

import { apiPatch, apiPost } from "@/services/api";
import { SUPABASE_URL } from "@/services/supabaseAuth";
import type { MeResponse } from "@/store/useAuthStore";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export type AvatarMimeType = "image/jpeg" | "image/png" | "image/webp";

const EXTENSION_TO_MIME: Record<string, AvatarMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface UpdateProfilePayload {
  display_name?: string;
  grade?: number;
}

export function updateProfile(payload: UpdateProfilePayload): Promise<MeResponse> {
  return apiPatch<MeResponse>("/v1/me/profile", payload);
}

interface AvatarUploadTicket {
  file_id: string;
  upload_url: string;
  token: string;
  path: string;
  expires_in_sec: number;
}

/** Supabase отдаёт относительный путь вида `/object/upload/sign/...`. */
function absoluteUploadUrl(uploadUrl: string): string {
  if (uploadUrl.startsWith("http")) return uploadUrl;
  const base = SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1${uploadUrl.startsWith("/") ? "" : "/"}${uploadUrl}`;
}

/** Тип по имени файла: ImagePicker на Android не всегда отдаёт mimeType. */
export function guessMimeType(uri: string, reported?: string | null): AvatarMimeType | null {
  if (reported !== undefined && reported !== null) {
    const normalized = reported === "image/jpg" ? "image/jpeg" : reported;
    if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp") {
      return normalized;
    }
  }
  const extension = uri.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_MIME[extension] ?? null;
}

export class AvatarError extends Error {}

/**
 * Загружает выбранное изображение и возвращает обновлённый профиль.
 * `uri` — локальный путь от `expo-image-picker`.
 */
export async function uploadAvatar(uri: string, mimeType: AvatarMimeType): Promise<MeResponse> {
  const fileResponse = await fetch(uri);
  if (!fileResponse.ok) {
    throw new AvatarError("Не удалось прочитать выбранное изображение");
  }
  const blob = await fileResponse.blob();

  if (blob.size === 0) {
    throw new AvatarError("Файл пустой");
  }
  if (blob.size > AVATAR_MAX_BYTES) {
    throw new AvatarError("Изображение больше 5 МБ — выберите файл поменьше");
  }

  const ticket = await apiPost<AvatarUploadTicket>("/v1/me/avatar/upload-url", {
    mime_type: mimeType,
    size_bytes: blob.size,
  });

  const upload = await fetch(absoluteUploadUrl(ticket.upload_url), {
    method: "PUT",
    headers: { "Content-Type": mimeType, "x-upsert": "true" },
    body: blob,
  });

  if (!upload.ok) {
    throw new AvatarError(`Хранилище отклонило файл (${upload.status})`);
  }

  return apiPost<MeResponse>("/v1/me/avatar/commit", { file_id: ticket.file_id });
}
