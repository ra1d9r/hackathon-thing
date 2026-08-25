import { useCallback, useEffect, useState } from "react";

import { formatGrade } from "@/constants/grades";
import { apiGet } from "@/services/api";
import { useAuthStore } from "@/store/useAuthStore";
import type { LessonMaterial, RoadmapNode, TaskItem, UserProfile } from "@/types/app";

/**
 * Данные экранов приложения — тонкие обёртки над реальным API.
 * Заменяет `services/mockData.ts` (фаза 13: подключение к backend).
 */

function useResource<T>(loader: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    loader()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);

  return { data, setData, isLoading, error, reload };
}

// ─── Профиль ───────────────────────────────────────────────────────────────

export function useUserProfile() {
  const me = useAuthStore((state) => state.me);
  const refreshMe = useAuthStore((state) => state.refreshMe);

  const user: UserProfile | null = me
    ? {
        id: me.public_id,
        name: me.display_name,
        avatarUrl: me.avatar_url,
        grade: formatGrade(me.grade),
        target: (me.student?.goal?.toUpperCase() as UserProfile["target"]) ?? "SUBJECTS",
        selectedSubjects: (me.student?.subjects ?? []).map((s) => ({ id: s.code, code: s.code, title: s.name })),
        streakDays: me.student?.streak_days ?? 0,
        totalPracticeCount: me.student?.questions_answered ?? 0,
        aiUsageCount: me.student?.ai_usage_count ?? 0,
      }
    : null;

  return { user, isLoading: false, error: null, updateUserTarget: refreshMe };
}

// ─── Дневной план ────────────────────────────────────────────────────────────

interface DailyPlanItemDto {
  id: string;
  kind: "task" | "lesson" | "review";
  title: string;
  meta: string;
  subject_name: string | null;
  est_minutes: number | null;
  status: "pending" | "in_progress" | "completed" | "skipped";
  topic: { id: string; title: string };
}

interface DailyPlanResponse {
  items: DailyPlanItemDto[];
  empty_reason: string | null;
}

const KIND_TO_TYPE: Record<DailyPlanItemDto["kind"], TaskItem["type"]> = {
  task: "QUIZ",
  lesson: "LESSON",
  review: "DRILL",
};

function toTaskItem(item: DailyPlanItemDto): TaskItem {
  return {
    id: item.id,
    subjectId: item.topic.id,
    subjectTitle: item.subject_name ?? item.topic.title,
    title: item.title,
    subtitle: item.meta,
    durationMinutes: item.est_minutes ?? 0,
    status: item.status === "completed" || item.status === "skipped" ? "COMPLETED" : item.status === "in_progress" ? "IN_PROGRESS" : "NOT_STARTED",
    progressPercentage: item.status === "completed" || item.status === "skipped" ? 100 : item.status === "in_progress" ? 50 : 0,
    type: KIND_TO_TYPE[item.kind],
  };
}

export function useDailyTasks() {
  const { data, isLoading, error, reload } = useResource<TaskItem[]>(async () => {
    const plan = await apiGet<DailyPlanResponse>("/v1/daily-plan");
    return plan.items.map(toTaskItem);
  }, []);

  const tasks = data ?? [];
  const isCompleted = tasks.length > 0 && tasks.every((task) => task.status === "COMPLETED");

  return { tasks, isCompleted, isLoading, error, markTaskComplete: reload, reload };
}

// ─── Roadmap ─────────────────────────────────────────────────────────────────

interface RoadmapNodeDto {
  id: string;
  position: number;
  title: string;
  status: "locked" | "available" | "in_progress" | "completed";
  progress_pct: number;
  lesson_id: string | null;
}

interface RoadmapResponseDto {
  roadmap: { id: string; subject: { id: string; code: string; name: string } } | null;
  nodes: RoadmapNodeDto[];
}

const NODE_STATUS: Record<RoadmapNodeDto["status"], RoadmapNode["status"]> = {
  completed: "COMPLETED",
  in_progress: "ACTIVE",
  available: "ACTIVE",
  locked: "LOCKED",
};

/**
 * Дорожная карта.
 *
 * `subject_id` в query — настоящий UUID предмета, а не код. Ни `/v1/me`,
 * ни `/v1/catalog/subjects` код в UUID не переводят — единственное место,
 * где UUID вообще виден клиенту, это сам ответ роадмапа. Поэтому карта
 * запрашивается без параметра: backend сам выбирает предмет ученика,
 * а какой именно — видно в `roadmap.subject` из ответа.
 */
export function useRoadmap() {
  const { data, isLoading, error } = useResource<{
    nodes: RoadmapNode[];
    subject: { id: string; code: string; name: string } | null;
  }>(async () => {
    const response = await apiGet<RoadmapResponseDto>("/v1/roadmap");
    const subjectId = response.roadmap?.subject.id ?? "";
    return {
      subject: response.roadmap?.subject ?? null,
      nodes: response.nodes.map((node) => ({
        id: node.id,
        subjectId,
        title: node.title,
        masteryPercentage: Math.round(node.progress_pct),
        status: NODE_STATUS[node.status],
        badgeText: node.status === "completed" ? `${Math.round(node.progress_pct)}% выполнено` : undefined,
      })),
    };
  }, []);

  const nodes = data?.nodes ?? [];
  const currentScore = nodes.length
    ? Math.round(nodes.reduce((sum, node) => sum + node.masteryPercentage, 0) / nodes.length)
    : 0;

  return { nodes, currentScore, subject: data?.subject ?? null, isLoading, error };
}

// ─── Материал урока (только чтение, для превью в карте) ──────────────────────

export function useLessonPreview(lessonId: string | null) {
  const { data, isLoading, error } = useResource<LessonMaterial | null>(async () => {
    if (!lessonId) return null;
    const response = await apiGet<{
      lesson: { id: string; title: string };
      material: { body_blocks: { type: string; spans?: { text: string }[] }[] } | null;
    }>(`/v1/lessons/${lessonId}`);

    const paragraphs =
      response.material?.body_blocks
        .filter((block) => block.type === "paragraph")
        .map((block) => block.spans?.map((span) => span.text).join("") ?? "")
        .filter(Boolean) ?? [];

    return {
      id: response.lesson.id,
      taskId: lessonId,
      title: response.lesson.title,
      paragraphs,
      topics: [],
    };
  }, [lessonId]);

  return { material: data, isLoading, error };
}

// ─── Статистика ───────────────────────────────────────────────────────────────

interface DashboardResponseDto {
  analytics: {
    questions_answered: number;
    study_hours: number;
    weak_topics: { topic_id: string; title: string; mastery_pct: number }[];
    score_history: { at: string; value: number }[];
  };
}

export function useLearningStats() {
  const { data, isLoading, error } = useResource(async () => {
    const dashboard = await apiGet<DashboardResponseDto>("/v1/dashboard");
    return {
      subjectProgress: dashboard.analytics.weak_topics.map((topic) => ({
        label: topic.title,
        value: Math.round(topic.mastery_pct),
        color: topic.mastery_pct >= 70 ? "#2b63f1" : "#c91f1f",
        important: topic.mastery_pct < 50,
      })),
      gradeChartData: dashboard.analytics.score_history.slice(-5).map((point, index) => ({
        value: Math.max(1, Math.round(point.value / 14)),
        label: `Д${index + 1}`,
      })),
    };
  }, []);

  return {
    subjectProgress: data?.subjectProgress ?? [],
    gradeChartData: data?.gradeChartData ?? [],
    isLoading,
    error,
  };
}
