import { useCallback, useRef, useState } from "react";

import { apiGet, apiPatch, apiPost, waitForJob } from "@/services/api";

/**
 * Прохождение теста: старт/возобновление попытки, локальные ответы,
 * автосохранение и отправка. Общий хук для диагностики и задач дня —
 * оба используют один и тот же контракт `backend/src/contracts/dto/attempts.ts`.
 */

export type QuestionKind = "mcq_single" | "mcq_multi" | "free_text" | "numeric";

export interface QuestionOption {
  id: string;
  text_md: string;
}

export interface QuestionView {
  id: string;
  position: number;
  kind: QuestionKind;
  prompt_md: string;
  options: QuestionOption[] | null;
  points: number;
  difficulty: number;
  max_chars: number | null;
  subject: { code: string; name: string };
  topic: { id: string; title: string };
}

export interface AnswerPayload {
  selected?: string[];
  value?: number;
  text?: string;
}

export interface AttemptHeader {
  id: string;
  assessment_id: string;
  kind: string;
  title: string;
  status: "in_progress" | "submitted" | "grading" | "graded" | "abandoned";
  started_at: string;
  submitted_at: string | null;
  deadline_at: string | null;
  time_limit_sec: number | null;
  time_spent_sec: number;
  answered_count: number;
  total_count: number;
}

interface AttemptView {
  attempt: AttemptHeader;
  questions: QuestionView[];
  answers: { question_id: string; answer: AnswerPayload; time_spent_sec: number; answered_at: string }[];
  server_time: string;
}

export interface JobRef {
  id: string;
  op_type: string;
  status: string;
  poll_url: string;
  suggested_wait_ms: number;
}

interface SubmitResponse {
  attempt: {
    id: string;
    status: string;
    deterministic: { raw_score: number; max_score: number; graded_questions: number };
    pending_ai_questions: number;
  };
  job: JobRef | null;
}

export function useAttempt() {
  const [attempt, setAttempt] = useState<AttemptHeader | null>(null);
  const [questions, setQuestions] = useState<QuestionView[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerPayload>>({});
  const [index, setIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questionStartedAt = useRef<number>(Date.now());
  const savedQuestionIds = useRef<Set<string>>(new Set());

  const applyView = useCallback((view: AttemptView) => {
    setAttempt(view.attempt);
    setQuestions([...view.questions].sort((a, b) => a.position - b.position));
    const restored: Record<string, AnswerPayload> = {};
    for (const saved of view.answers) restored[saved.question_id] = saved.answer;
    setAnswers(restored);
    savedQuestionIds.current = new Set(view.answers.map((a) => a.question_id));
    setIndex(0);
    questionStartedAt.current = Date.now();
  }, []);

  const startFromAssessment = useCallback(
    async (assessmentId: string, clientAttemptId?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const view = await apiPost<AttemptView>("/v1/attempts", {
          assessment_id: assessmentId,
          client_attempt_id: clientAttemptId ?? null,
        });
        applyView(view);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось начать попытку");
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [applyView],
  );

  const loadExisting = useCallback(
    async (attemptId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const view = await apiGet<AttemptView>(`/v1/attempts/${attemptId}`);
        applyView(view);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить попытку");
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [applyView],
  );

  const setAnswer = useCallback((questionId: string, answer: AnswerPayload) => {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  }, []);

  const persistAnswer = useCallback(
    async (questionId: string) => {
      if (!attempt) return;
      const answer = answers[questionId];
      if (!answer) return;

      const elapsedSec = Math.max(1, Math.round((Date.now() - questionStartedAt.current) / 1000));
      await apiPatch(`/v1/attempts/${attempt.id}/answers`, {
        answers: [{ question_id: questionId, answer, time_spent_sec: elapsedSec }],
      });
      savedQuestionIds.current.add(questionId);
      questionStartedAt.current = Date.now();
    },
    [attempt, answers],
  );

  const goTo = useCallback(
    async (nextIndex: number) => {
      const current = questions[index];
      if (current && answers[current.id]) {
        await persistAnswer(current.id).catch(() => undefined);
      }
      setIndex(Math.max(0, Math.min(questions.length - 1, nextIndex)));
    },
    [index, questions, answers, persistAnswer],
  );

  const flushAll = useCallback(async () => {
    if (!attempt) return;
    const unsaved = questions
      .filter((q) => answers[q.id] && !savedQuestionIds.current.has(q.id))
      .map((q) => ({ question_id: q.id, answer: answers[q.id]!, time_spent_sec: 1 }));
    // Батчами по 50 — предел контракта.
    for (let i = 0; i < unsaved.length; i += 50) {
      const batch = unsaved.slice(i, i + 50);
      if (batch.length === 0) continue;
      await apiPatch(`/v1/attempts/${attempt.id}/answers`, { answers: batch });
      for (const item of batch) savedQuestionIds.current.add(item.question_id);
    }
  }, [attempt, questions, answers]);

  const submit = useCallback(async (): Promise<SubmitResponse> => {
    if (!attempt) throw new Error("Попытка не начата");
    setIsSubmitting(true);
    setError(null);
    try {
      const current = questions[index];
      if (current && answers[current.id]) {
        await persistAnswer(current.id).catch(() => undefined);
      }
      await flushAll();
      return await apiPost<SubmitResponse>(`/v1/attempts/${attempt.id}/submit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить попытку");
      throw e;
    } finally {
      setIsSubmitting(false);
    }
  }, [attempt, questions, index, answers, persistAnswer, flushAll]);

  return {
    attempt,
    questions,
    answers,
    index,
    currentQuestion: questions[index] ?? null,
    isLoading,
    isSubmitting,
    error,
    startFromAssessment,
    loadExisting,
    setAnswer,
    goTo,
    goNext: () => goTo(index + 1),
    goPrev: () => goTo(index - 1),
    submit,
  };
}

/** Ждёт разбор попытки (для диагностики/пробника) перед показом результата. */
export async function waitForAttemptJob(jobId: string | null | undefined): Promise<void> {
  if (!jobId) return;
  await waitForJob(jobId, { totalTimeoutMs: 90_000, waitMs: 20_000 }).catch(() => undefined);
}
