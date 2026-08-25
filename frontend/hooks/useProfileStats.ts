import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/services/api";

/**
 * Статистика профиля — один запрос `/v1/stats/overview`.
 *
 * Backend уже отдаёт всё в готовом к показу виде (проценты округлены,
 * предсказанный балл посчитан), поэтому клиент ничего не досчитывает:
 * иначе два экрана однажды покажут разные числа из одних данных.
 */

export interface PredictedScore {
  scale: string;
  value: number;
  max: number;
  five_grade: number | null;
  delta_vs_previous: number | null;
  source: "ai" | "baseline";
}

export interface SubjectMastery {
  code: string;
  name: string;
  mastery_pct: number;
  topics_total: number;
  topics_mastered: number;
}

export interface StatsOverview {
  questions_answered: number;
  attempts_graded: number;
  study_hours: number;
  predicted_score: PredictedScore | null;
  subjects: SubjectMastery[];
  class_name: string | null;
  streak_days: number;
  ai_usage_count: number;
}

export interface ScorePoint {
  at: string;
  value: number;
}

interface ScoreHistory {
  scale: string;
  max: number;
  points: ScorePoint[];
}

export function useProfileStats() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      apiGet<StatsOverview>("/v1/stats/overview"),
      apiGet<ScoreHistory>("/v1/stats/score-history", { range: "90d" }),
    ])
      .then(([nextOverview, nextHistory]) => {
        if (cancelled) return;
        setOverview(nextOverview);
        setHistory(nextHistory);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить статистику");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => reload(), [reload]);

  return { overview, history, isLoading, error, reload };
}
