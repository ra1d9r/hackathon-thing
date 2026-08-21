import { useCallback, useEffect, useMemo, useState, type DependencyList } from "react";

import { currentUser, dailyTasks, gradeChartData, lessonMaterials, quizQuestions, roadmapNodes, subjectProgress } from "@/services/mockData";
import type { LessonMaterial, QuizQuestion, RoadmapNode, TaskItem, UserProfile } from "@/types/app";
import type { UserTarget } from "@/types/onboarding";

const API_DELAY_MS = 300;

function delay() {
  return new Promise<void>((resolve) => setTimeout(resolve, API_DELAY_MS));
}

function useMockResource<T>(factory: () => T, deps: DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setError(null);
    delay()
      .then(() => {
        if (mounted) setData(factory());
      })
      .catch(() => {
        if (mounted) setError("Unable to load mock data");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, deps);

  return { data, setData, isLoading, error };
}

export function useUserProfile() {
  const { data: user, setData: setUser, isLoading, error } = useMockResource<UserProfile>(() => currentUser, []);

  const updateUserTarget = useCallback(
    async (target: UserTarget) => {
      await delay();
      setUser((current) => (current ? { ...current, target } : current));
    },
    [setUser]
  );

  return { user, isLoading, error, updateUserTarget };
}

export function useDailyTasks() {
  const { data, setData, isLoading, error } = useMockResource<TaskItem[]>(() => dailyTasks, []);
  const tasks = data ?? [];
  const isCompleted = tasks.length > 0 && tasks.every((task) => task.status === "COMPLETED");

  const markTaskComplete = useCallback(
    async (taskId: string) => {
      await delay();
      setData((current) =>
        (current ?? dailyTasks).map((task) =>
          task.id === taskId ? { ...task, status: "COMPLETED", progressPercentage: 100 } : task
        )
      );
    },
    [setData]
  );

  return { tasks, isCompleted, isLoading, error, markTaskComplete };
}

export function useRoadmap(subjectId: string) {
  const { data, isLoading, error } = useMockResource<RoadmapNode[]>(
    () => roadmapNodes.filter((node) => node.subjectId === subjectId || node.subjectId === "physics"),
    [subjectId]
  );
  const nodes = data ?? [];
  const currentScore = useMemo(
    () => (nodes.length ? Math.round(nodes.reduce((sum, node) => sum + node.masteryPercentage, 0) / nodes.length) : 0),
    [nodes]
  );

  return { nodes, currentScore, isLoading, error };
}

export function useLessonWorkspace(taskId: string) {
  const materialState = useMockResource<LessonMaterial | null>(
    () => lessonMaterials.find((item) => item.taskId === taskId) ?? null,
    [taskId]
  );
  const questionsState = useMockResource<QuizQuestion[]>(
    () => quizQuestions.filter((question) => question.taskId === taskId),
    [taskId]
  );

  const submitQuiz = useCallback(async (answers: Record<string, string>) => {
    await delay();
    return {
      submitted: true,
      correctCount: quizQuestions.filter((question) =>
        question.options.some((option) => option.id === answers[question.id] && option.isCorrect)
      ).length
    };
  }, []);

  return {
    material: materialState.data,
    questions: questionsState.data ?? [],
    isLoading: materialState.isLoading || questionsState.isLoading,
    error: materialState.error ?? questionsState.error,
    submitQuiz
  };
}

export function useLearningStats() {
  const { data, isLoading, error } = useMockResource(
    () => ({
      subjectProgress,
      gradeChartData
    }),
    []
  );

  return {
    subjectProgress: data?.subjectProgress ?? [],
    gradeChartData: data?.gradeChartData ?? [],
    isLoading,
    error
  };
}
