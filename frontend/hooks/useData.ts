import { useCallback, useEffect, useRef, useState } from "react";

import { formatGrade } from "@/constants/grades";
import { apiGet } from "@/services/api";
import { errorText } from "@/services/errors";
import { useAuthStore, type LearningGoal } from "@/store/useAuthStore";
import type { LessonMaterial, RoadmapNode, UserProfile } from "@/types/app";

function useResource<T>(loader: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation;

    setIsLoading(true);
    setError(null);
    loaderRef.current()
      .then((value) => {
        if (isCurrent()) setData(value);
      })
      .catch((e: unknown) => {
        if (isCurrent()) setError(errorText(e, "Не удалось загрузить данные"));
      })
      .finally(() => {
        if (isCurrent()) setIsLoading(false);
      });
  }, deps);

  useEffect(() => reload(), [reload]);

  return { data, setData, isLoading, error, reload };
}

function toUserTarget(goal: LearningGoal | null | undefined): UserProfile["target"] {
  switch (goal) {
    case "ent":
      return "ENT";
    case "nis":
      return "NIS";
    default:
      return "SUBJECTS";
  }
}

export function useUserProfile() {
  const me = useAuthStore((state) => state.me);
  const refreshMe = useAuthStore((state) => state.refreshMe);

  const user: UserProfile | null = me
    ? {
        id: me.public_id,
        name: me.display_name,
        avatarUrl: me.avatar_url,
        grade: formatGrade(me.grade),
        target: toUserTarget(me.student?.goal),
        selectedSubjects: (me.student?.subjects ?? []).map((s) => ({ id: s.code, code: s.code, title: s.name })),
        streakDays: me.student?.streak_days ?? 0,
        totalPracticeCount: me.student?.questions_answered ?? 0,
        aiUsageCount: me.student?.ai_usage_count ?? 0,
      }
    : null;

  return { user, isLoading: false, error: null, updateUserTarget: refreshMe };
}

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

export function useRoadmap(subjectId?: string | null) {
  const { data, isLoading, error } = useResource<{
    nodes: RoadmapNode[];
    subject: { id: string; code: string; name: string } | null;
  }>(async () => {
    const response = await apiGet<RoadmapResponseDto>(
      "/v1/roadmap",
      subjectId ? { subject_id: subjectId } : undefined,
    );
    const roadmapSubjectId = response.roadmap?.subject.id ?? "";
    return {
      subject: response.roadmap?.subject ?? null,
      nodes: response.nodes.map((node) => ({
        id: node.id,
        subjectId: roadmapSubjectId,
        title: node.title,
        masteryPercentage: Math.round(node.progress_pct),
        status: NODE_STATUS[node.status],
        badgeText: node.status === "completed" ? `${Math.round(node.progress_pct)}% выполнено` : undefined,
      })),
    };
  }, [subjectId]);

  const nodes = data?.nodes ?? [];
  const currentScore = nodes.length
    ? Math.round(nodes.reduce((sum, node) => sum + node.masteryPercentage, 0) / nodes.length)
    : 0;

  return { nodes, currentScore, subject: data?.subject ?? null, isLoading, error };
}

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
