import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/services/api";
import { errorText } from "@/services/errors";
import { useAuthStore } from "@/store/useAuthStore";

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
  // Маршруты `/v1/stats/*` требуют завершённого онбординга ученика (см.
  // `requireOnboarding` в backend/src/plugins/auth.ts) и отвечают учителю
  // `FORBIDDEN_ROLE`. Хук вызывается на общем экране профиля, поэтому сам
  // решает, стоит ли вообще идти в сеть, а не полагается на вызывающий код.
  const role = useAuthStore((state) => state.me?.role);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [isLoading, setIsLoading] = useState(role === "student");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (role !== "student") {
      setIsLoading(false);
      return () => undefined;
    }

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
        if (!cancelled) setError(errorText(e, "Не удалось загрузить статистику"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => reload(), [reload]);

  return { overview, history, isLoading, error, reload };
}
