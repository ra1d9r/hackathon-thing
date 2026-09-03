import { apiDelete, apiGet, apiPost } from "@/services/api";
import { SUPABASE_URL } from "@/services/supabaseAuth";
import type { LessonBodyBlock } from "@/components/LessonReader";

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const MB = 1024 * 1024;

const MAX_BYTES: Record<string, number> = {
  pdf: 25 * MB,
  docx: 25 * MB,
  pptx: 50 * MB,
  txt: 1 * MB,
  mp4: 200 * MB,
  mov: 200 * MB,
};

export const ACCEPTED_MIME_TYPES = Object.keys(MIME_TO_EXTENSION);

export const ACCEPTED_HINT = "PDF, DOCX, PPTX, TXT, MP4, MOV";

export class MaterialFileError extends Error {}

interface UploadTicket {
  file_id: string;
  upload_url: string;
  token: string;
  path: string;
  expires_in_sec: number;
  format: "pdf" | "docx" | "pptx" | "txt" | "video";
}

function absoluteUploadUrl(uploadUrl: string): string {
  if (uploadUrl.startsWith("http")) return uploadUrl;
  const base = SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1${uploadUrl.startsWith("/") ? "" : "/"}${uploadUrl}`;
}

export function resolveFileType(
  name: string,
  reported?: string | null,
): { mimeType: string; extension: string } | null {
  const extension = name.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const byExtension = EXTENSION_TO_MIME[extension];
  if (byExtension !== undefined) {
    return { mimeType: byExtension, extension };
  }

  if (reported !== undefined && reported !== null) {
    const byMime = MIME_TO_EXTENSION[reported.toLowerCase()];
    if (byMime !== undefined) {
      return { mimeType: reported.toLowerCase(), extension: byMime };
    }
  }

  return null;
}

export interface MaterialFileInput {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

export interface CreateFileMaterialInput {
  title: string;
  summary?: string;
  classId?: string;
}

function putWithProgress(
  url: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", mimeType);
    request.setRequestHeader("x-upsert", "true");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      reject(new MaterialFileError(`Хранилище отклонило файл (${String(request.status)})`));
    };

    request.onerror = () => reject(new MaterialFileError("Связь с хранилищем оборвалась"));
    request.onabort = () => reject(new MaterialFileError("Загрузка отменена"));

    request.send(blob);
  });
}

export async function uploadMaterialFile(
  file: MaterialFileInput,
  material: CreateFileMaterialInput,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const type = resolveFileType(file.name, file.mimeType);
  if (type === null) {
    throw new MaterialFileError(`Такой файл загрузить нельзя. Подойдут: ${ACCEPTED_HINT}`);
  }

  const response = await fetch(file.uri);
  if (!response.ok) {
    throw new MaterialFileError("Не удалось прочитать выбранный файл");
  }
  const blob = await response.blob();

  if (blob.size === 0) {
    throw new MaterialFileError("Файл пустой");
  }
  const limit = MAX_BYTES[type.extension] ?? 25 * MB;
  if (blob.size > limit) {
    throw new MaterialFileError(
      `Файл больше предела для .${type.extension} (${String(Math.round(limit / MB))} МБ)`,
    );
  }

  const baseName = file.name.replace(/\.[^.]*$/, "") || material.title;
  const filename = `${baseName.slice(0, 180)}.${type.extension}`;

  const ticket = await apiPost<UploadTicket>("/v1/materials/upload-url", {
    filename,
    mime_type: type.mimeType,
    size_bytes: blob.size,
    ...(material.classId === undefined ? {} : { class_id: material.classId }),
  });

  await putWithProgress(absoluteUploadUrl(ticket.upload_url), blob, type.mimeType, onProgress);

  await apiPost("/v1/materials", {
    format: ticket.format,
    title: material.title,
    file_id: ticket.file_id,
    ...(material.summary === undefined || material.summary === ""
      ? {}
      : { summary: material.summary }),
    ...(material.classId === undefined ? {} : { class_id: material.classId }),
  });
}

export interface MaterialFileView {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface MaterialDetail {
  id: string;
  kind: string;
  format: string;
  title: string;
  summary: string | null;
  body_md: string | null;
  body_blocks: LessonBodyBlock[] | null;
  file: MaterialFileView | null;
  external_url: string | null;
  status: "draft" | "published" | "blocked";
}

export function fetchMaterial(materialId: string): Promise<MaterialDetail> {
  return apiGet<{ material: MaterialDetail }>(`/v1/materials/${materialId}`).then(
    (response) => response.material,
  );
}

interface FileUrlResponse {
  url: string;
  expires_in_sec: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

export function fetchFileUrl(fileId: string): Promise<string> {
  return apiGet<FileUrlResponse>(`/v1/files/${fileId}/url`).then((response) => response.url);
}

export function deleteMaterial(materialId: string): Promise<void> {
  return apiDelete<void>(`/v1/materials/${materialId}`);
}
