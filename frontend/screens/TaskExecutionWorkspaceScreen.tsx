import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { LessonReader, type LessonBodyBlock } from "@/components/LessonReader";
import { QuestionCard } from "@/components/QuestionCard";
import { apiGet, apiPost, waitForJob } from "@/services/api";
import { errorText } from "@/services/errors";
import { useAttempt } from "@/hooks/useAttempt";

type Stage = "loading" | "preparing" | "material" | "quiz" | "done" | "error";

const GENERATION_TIMEOUT_MS = 240_000;

const JOB_ERROR_MESSAGES: Record<string, string> = {
  NO_QUESTIONS: "По этой теме пока нет ни материала, ни вопросов.",
  TOPIC_NOT_FOUND: "Тема больше не доступна.",
  SUBJECT_NOT_SELECTED: "Предмет убран из вашего профиля.",
  QUOTA_EXCEEDED: "Дневной лимит обращений к ИИ исчерпан. Попробуйте завтра.",
};

interface FinishedJob {
  status: string;
  error_code: string | null;
}

async function awaitGeneration(jobId: string): Promise<FinishedJob> {
  const status = await waitForJob(jobId, {
    totalTimeoutMs: GENERATION_TIMEOUT_MS,
    waitMs: 25_000,
  });
  return { status: status.job.status, error_code: status.job.error_code };
}

function generationError(job: FinishedJob): Error {
  if (job.status === "succeeded") {
    return new Error("Задание составлено, но открыть его не удалось. Попробуйте ещё раз.");
  }
  if (job.error_code !== null && JOB_ERROR_MESSAGES[job.error_code] !== undefined) {
    return new Error(JOB_ERROR_MESSAGES[job.error_code]);
  }
  if (job.status === "queued" || job.status === "running" || job.status === "awaiting_retry") {
    return new Error("Задание всё ещё готовится. Загляните сюда через пару минут.");
  }
  return new Error("Не удалось составить задание. Попробуйте ещё раз.");
}

interface LessonMaterialDto {
  lesson: { id: string; title: string; topic: { id: string; title: string } };
  material: {
    body_blocks: LessonBodyBlock[];
  } | null;
}

interface QueuedJobRef {
  job_id: string;
  poll_url: string;
}

interface StartItemResponse {
  assessment_id: string | null;
  attempt_id: string | null;
  lesson_id: string | null;
  job: QueuedJobRef | null;
}

interface KnowledgeCheckResponse {
  assessment: { id: string } | null;
  job: QueuedJobRef | null;
}

interface ReviewAnswer {
  question_id: string;
  position: number;
  prompt_md: string;
  is_correct: boolean | null;
  points: number;
  points_awarded: number;
  grader: "deterministic" | "ai" | "pending" | "ungraded";
  explanation_md: string | null;
  ai_feedback_md: string | null;
}

interface AttemptReview {
  attempt: {
    raw_score: number | null;
    max_score: number | null;
    pending_questions: number;
  };

  exam: {
    exam: { title: string };
    scaled_score: number;
    max_score: number;
  } | null;
  answers: ReviewAnswer[];
}

export function TaskExecutionWorkspaceScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ itemId?: string; lessonId?: string; assessmentId?: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState("Урок");
  const [bodyBlocks, setBodyBlocks] = useState<LessonBodyBlock[]>([]);
  const [retryToken, setRetryToken] = useState(0);
  const [review, setReview] = useState<AttemptReview | null>(null);
  const [hasMaterial, setHasMaterial] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const lessonIdRef = useRef<string | null>(null);
  const topicIdRef = useRef<string | null>(null);

  const attempt = useAttempt();

  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  useEffect(() => {
    let cancelled = false;
    setStage("loading");
    setError(null);
    setHasMaterial(false);

    async function resolveQuiz(assessmentId: string | null, attemptId: string | null) {
      if (attemptId) {
        await attemptRef.current.loadExisting(attemptId);
      } else if (assessmentId) {
        await attemptRef.current.startFromAssessment(assessmentId);
      } else {
        throw new Error("Не удалось получить задание");
      }
      if (!cancelled) setStage("quiz");
    }

    async function loadLesson(lessonId: string) {
      lessonIdRef.current = lessonId;
      const lesson = await apiGet<LessonMaterialDto>(`/v1/lessons/${lessonId}`);
      if (cancelled) return;
      setLessonTitle(lesson.lesson.title);
      topicIdRef.current = lesson.lesson.topic.id;
      setBodyBlocks(lesson.material?.body_blocks ?? []);
      setHasMaterial(true);
      setStage("material");
    }

    (async () => {
      try {
        if (params.itemId) {
          let resolved = await apiPost<StartItemResponse>(`/v1/daily-plan/items/${params.itemId}/start`);

          if (resolved.job && !resolved.assessment_id && !resolved.attempt_id) {
            if (cancelled) return;
            setStage("preparing");
            const job = await awaitGeneration(resolved.job.job_id);
            if (cancelled) return;
            if (job.status !== "succeeded") throw generationError(job);
            resolved = await apiPost<StartItemResponse>(`/v1/daily-plan/items/${params.itemId}/start`);
          }

          if (cancelled) return;

          if (resolved.assessment_id || resolved.attempt_id) {
            await resolveQuiz(resolved.assessment_id, resolved.attempt_id);
          } else if (resolved.lesson_id) {
            await loadLesson(resolved.lesson_id);
          } else {
            throw new Error("Не удалось получить задание");
          }
        } else if (params.lessonId) {
          await loadLesson(params.lessonId);
        } else if (params.assessmentId) {
          setLessonTitle("Пробный экзамен");
          await resolveQuiz(params.assessmentId, null);
        } else {
          throw new Error("Задание не указано");
        }
      } catch (e) {
        if (!cancelled) {
          setError(errorText(e, "Не удалось загрузить задание"));
          setStage("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.itemId, params.lessonId, params.assessmentId, retryToken]);

  const continueToQuiz = async () => {
    const lessonId = lessonIdRef.current;
    if (!lessonId) return;
    setStage("loading");
    try {
      await apiPost(`/v1/lessons/${lessonId}/material-read`);
      let check = await apiPost<KnowledgeCheckResponse>(`/v1/lessons/${lessonId}/knowledge-check`);

      if (check.job && !check.assessment) {
        setStage("preparing");
        const job = await awaitGeneration(check.job.job_id);
        if (job.status !== "succeeded") throw generationError(job);
        check = await apiPost<KnowledgeCheckResponse>(`/v1/lessons/${lessonId}/knowledge-check`);
      }

      if (!check.assessment) throw new Error("Проверка знаний недоступна");
      await attempt.startFromAssessment(check.assessment.id);
      setStage("quiz");
    } catch (e) {
      setError(errorText(e, "Не удалось начать проверку знаний"));
      setStage("error");
    }
  };

  const completeTask = async () => {
    try {
      const result = await attempt.submit();
      setStage("done");

      const view = await apiGet<AttemptReview>(`/v1/attempts/${result.attempt.id}/result`);
      setReview(view);
    } catch {
    }
  };

  const question = attempt.currentQuestion;
  const isLast = attempt.questions.length > 0 && attempt.index === attempt.questions.length - 1;
  const hasAnswer = question ? Boolean(attempt.answers[question.id]) : false;
  const isBusy = isAdvancing || attempt.isSubmitting;

  const advance = async () => {
    if (isBusy) return;
    setIsAdvancing(true);
    try {
      if (isLast) {
        await completeTask();
      } else {
        await attempt.goNext();
      }
    } finally {
      setIsAdvancing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{lessonTitle}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: 112 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {stage === "loading" ? <ActivityIndicator color={colors.blue} /> : null}
          {stage === "preparing" ? <PreparingCard /> : null}

          {stage === "error" ? (
            <View style={styles.materialCard}>
              <Text style={styles.cardTitle}>Задание не открылось</Text>
              <Text style={styles.paragraph}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRetryToken((value) => value + 1)}
                style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
              >
                <Text style={styles.nextButtonText}>Попробовать снова</Text>
                <Ionicons name="refresh" size={16} color="#ffffff" />
              </Pressable>
            </View>
          ) : null}

          {hasMaterial && (stage === "material" || stage === "quiz") ? (
            <View style={styles.stepper}>
              <View style={[styles.stepBadge, stage === "material" && styles.stepBadgeActive]}>
                <Text style={[styles.stepText, stage === "material" && styles.stepTextActive]}>1. Материалы</Text>
              </View>
              <View style={styles.stepLine} />
              <View style={[styles.stepBadge, stage === "quiz" && styles.stepBadgeActive]}>
                <Text style={[styles.stepText, stage === "quiz" && styles.stepTextActive]}>2. Проверка знаний</Text>
              </View>
            </View>
          ) : null}

          {stage === "material" ? (
            <>
              <View style={styles.materialCard}>
                <Text style={styles.cardTitle}>{lessonTitle}</Text>
                <LessonReader blocks={bodyBlocks} emptyText="Материал ещё готовится." />
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/assistant",
                    params: topicIdRef.current === null ? {} : { topicId: topicIdRef.current },
                  })
                }
                style={({ pressed }) => [styles.aiBanner, pressed && styles.pressed]}
              >
                <View style={styles.aiIcon}>
                  <Ionicons name="bulb-outline" size={23} color="#c84b16" />
                </View>
                <View style={styles.aiCopy}>
                  <Text style={styles.aiTitle}>Есть вопросы? Спроси ИИ-ассистента</Text>
                  <Text style={styles.aiText}>Он видит эту тему, ваши слабые места и план на сегодня.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>

              <Pressable accessibilityRole="button" onPress={continueToQuiz} style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}>
                <Text style={styles.nextButtonText}>К проверке знаний</Text>
                <Ionicons name="arrow-forward" size={16} color="#ffffff" />
              </Pressable>
            </>
          ) : null}

          {stage === "quiz" && question ? (
            <View style={styles.quizCard}>
              <Text style={styles.cardTitle}>
                Вопрос {attempt.index + 1} из {attempt.questions.length}
              </Text>
              <QuestionCard
                question={question}
                answer={attempt.answers[question.id]}
                onChange={(value) => attempt.setAnswer(question.id, value)}
              />
              {attempt.error ? <Text style={styles.emptyText}>{attempt.error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => void advance()}
                disabled={!hasAnswer || isBusy}
                style={({ pressed }) => [styles.nextButton, (!hasAnswer || isBusy) && styles.disabled, pressed && styles.pressed]}
              >
                {isBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.nextButtonText}>{isLast ? "Завершить задание" : "Дальше"}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                  </>
                )}
              </Pressable>

              {isBusy ? (
                <View style={styles.answerLock}>
                  <ActivityIndicator color={colors.blue} size="large" />
                </View>
              ) : null}
            </View>
          ) : null}

          {stage === "done" ? (
            <>
              <View style={styles.materialCard}>
                <Text style={styles.cardTitle}>Готово!</Text>
                {review === null ? (
                  <Text style={styles.paragraph}>Задание засчитано. Считаем результат…</Text>
                ) : review.exam !== null ? (
                  <Text style={styles.paragraph}>
                    {review.exam.exam.title}: {Math.round(review.exam.scaled_score)} из{" "}
                    {Math.round(review.exam.max_score)} баллов.
                  </Text>
                ) : (
                  <Text style={styles.paragraph}>
                    Набрано {Math.round(review.attempt.raw_score ?? 0)} из{" "}
                    {Math.round(review.attempt.max_score ?? 0)}.
                    {review.attempt.pending_questions > 0
                      ? ` Свободных ответов на проверке: ${review.attempt.pending_questions}.`
                      : ""}
                  </Text>
                )}
              </View>

              {review?.answers.map((item) => (
                <ReviewCard key={item.question_id} answer={item} />
              ))}

              <Pressable accessibilityRole="button" onPress={() => router.replace("/(tabs)/dashboard")} style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}>
                <Text style={styles.nextButtonText}>На панель</Text>
                <Ionicons name="arrow-forward" size={16} color="#ffffff" />
              </Pressable>
            </>
          ) : null}
        </ScrollView>

      </View>
    </SafeAreaView>
  );
}

const REVIEW_STATUS: Record<
  ReviewAnswer["grader"],
  { label: string; color: string; background: string } | null
> = {
  deterministic: null,
  ai: null,
  pending: { label: "На проверке", color: "#c84b16", background: "#fdeee7" },
  ungraded: { label: "Не проверено", color: "#6b7280", background: "#eeeeee" },
};

function ReviewCard({ answer }: { answer: ReviewAnswer }) {
  const status = REVIEW_STATUS[answer.grader];
  const verdict =
    status ??
    (answer.is_correct === true
      ? { label: "Верно", color: "#0d8a3f", background: "#e6f6ec" }
      : { label: "Неверно", color: "#b42318", background: "#fdecec" });

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHead}>
        <View style={[styles.reviewBadge, { backgroundColor: verdict.background }]}>
          <Text style={[styles.reviewBadgeText, { color: verdict.color }]}>{verdict.label}</Text>
        </View>
        <Text style={styles.reviewScore}>
          {Math.round(answer.points_awarded)} / {Math.round(answer.points)}
        </Text>
      </View>

      <Text style={styles.reviewPrompt}>
        {answer.position}. {answer.prompt_md}
      </Text>

      {answer.ai_feedback_md ? <Text style={styles.reviewNote}>{answer.ai_feedback_md}</Text> : null}
      {answer.explanation_md ? <Text style={styles.reviewNote}>{answer.explanation_md}</Text> : null}
    </View>
  );
}

function PreparingCard() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.preparingCard}>
      <ActivityIndicator color={colors.blue} size="large" />
      <Text style={styles.cardTitle}>Готовим задание</Text>
      <Text style={styles.paragraph}>
        ИИ подбирает вопросы под вашу тему и уровень. Обычно это занимает меньше минуты;
        экран откроется сам.
      </Text>
      <Text style={styles.preparingTimer}>{seconds} с</Text>
    </View>
  );
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  text: "#202124",
  muted: "#555b66",
  border: "#c5cede",
  blue: "#245cf2",
  navy: "#274779",
  orange: "#c84b16",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  header: { height: 58, borderBottomColor: "#e1e4ea", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 18, fontWeight: "900" },
  headerSpacer: { width: 44 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 18, gap: 18 },
  stepper: { flexDirection: "row", alignItems: "center" },
  stepBadge: { minHeight: 34, borderRadius: 17, borderColor: colors.border, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, backgroundColor: colors.card },
  stepBadgeActive: { borderColor: colors.blue, backgroundColor: "#e9f1ff" },
  stepText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  stepTextActive: { color: colors.blue },
  stepLine: { flex: 1, height: 1, backgroundColor: colors.border },
  materialCard: { borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, padding: 18, gap: 4 },
  preparingCard: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    alignItems: "center",
    padding: 24,
    gap: 6,
  },
  preparingTimer: { marginTop: 6, color: colors.muted, fontSize: 13, fontWeight: "800" },
  reviewCard: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 16,
  },
  reviewHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reviewBadge: { borderRadius: 3, paddingHorizontal: 9, paddingVertical: 4 },
  reviewBadgeText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.3 },
  reviewScore: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  reviewPrompt: { marginTop: 12, color: colors.text, fontSize: 16, lineHeight: 23 },
  reviewNote: { marginTop: 10, color: colors.muted, fontSize: 15, lineHeight: 22 },
  cardTitle: { color: colors.text, fontSize: 22, fontWeight: "900", lineHeight: 29 },
  paragraph: { marginTop: 12, color: colors.muted, fontSize: 16, lineHeight: 24 },
  aiBanner: { minHeight: 82, borderRadius: 10, borderColor: "#f0d4b8", borderWidth: 1, backgroundColor: "#fff7ed", flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  aiIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#fde5d7" },
  aiCopy: { flex: 1 },
  aiTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  aiText: { marginTop: 3, color: colors.muted, fontSize: 14, lineHeight: 19 },
  quizCard: { borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, padding: 18, gap: 14 },
  answerLock: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: "rgba(251,250,249,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  nextButton: { minHeight: 52, borderRadius: 8, backgroundColor: colors.navy, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  nextButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  emptyText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.76 },
});
