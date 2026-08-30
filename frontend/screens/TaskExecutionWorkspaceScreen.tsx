import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { QuestionCard } from "@/components/QuestionCard";
import { apiGet, apiPost, waitForJob } from "@/services/api";
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
  lesson: { id: string; title: string };
  material: {
    body_blocks: {
      type: string;
      spans?: { text: string }[];
      items?: { spans?: { text: string }[] }[];
    }[];
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

function extractParagraphs(material: LessonMaterialDto["material"]): string[] {
  if (!material) return [];
  return material.body_blocks
    .map((block) => {
      if (block.type === "list") {
        return (block.items ?? [])
          .map((item) => `• ${item.spans?.map((span) => span.text).join("") ?? ""}`)
          .join("\n");
      }
      return block.spans?.map((span) => span.text).join("") ?? "";
    })
    .filter(Boolean);
}

export function TaskExecutionWorkspaceScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ itemId?: string; lessonId?: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState("Урок");
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const lessonIdRef = useRef<string | null>(null);

  const attempt = useAttempt();

  useEffect(() => {
    let cancelled = false;
    setStage("loading");
    setError(null);

    async function resolveQuiz(assessmentId: string | null, attemptId: string | null) {
      if (attemptId) {
        await attempt.loadExisting(attemptId);
      } else if (assessmentId) {
        await attempt.startFromAssessment(assessmentId);
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
      setParagraphs(extractParagraphs(lesson.material));
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
        } else {
          throw new Error("Задание не указано");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить задание");
          setStage("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.itemId, params.lessonId, retryToken]);

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
      setError(e instanceof Error ? e.message : "Не удалось начать проверку знаний");
      setStage("error");
    }
  };

  const completeTask = async () => {
    try {
      await attempt.submit();
      setStage("done");
    } catch {
    }
  };

  const question = attempt.currentQuestion;
  const isLast = attempt.questions.length > 0 && attempt.index === attempt.questions.length - 1;
  const hasAnswer = question ? Boolean(attempt.answers[question.id]) : false;

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

          {stage === "material" || stage === "quiz" ? (
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
                {paragraphs.length === 0 ? (
                  <Text style={styles.paragraph}>Материал ещё готовится.</Text>
                ) : (
                  paragraphs.map((paragraph, i) => (
                    <Text key={`${paragraph.slice(0, 20)}-${i}`} style={styles.paragraph}>
                      {paragraph}
                    </Text>
                  ))
                )}
              </View>

              <Pressable accessibilityRole="button" onPress={() => setAiOpen(true)} style={({ pressed }) => [styles.aiBanner, pressed && styles.pressed]}>
                <View style={styles.aiIcon}>
                  <Ionicons name="bulb-outline" size={23} color="#c84b16" />
                </View>
                <View style={styles.aiCopy}>
                  <Text style={styles.aiTitle}>Есть вопросы? Спроси AI-ассистента</Text>
                  <Text style={styles.aiText}>Откройте вкладку ассистента на панели, чтобы получить подсказку.</Text>
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
                onPress={isLast ? completeTask : attempt.goNext}
                disabled={!hasAnswer || attempt.isSubmitting}
                style={({ pressed }) => [styles.nextButton, (!hasAnswer || attempt.isSubmitting) && styles.disabled, pressed && styles.pressed]}
              >
                {attempt.isSubmitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.nextButtonText}>{isLast ? "Завершить задание" : "Дальше"}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {stage === "done" ? (
            <View style={styles.materialCard}>
              <Text style={styles.cardTitle}>Готово!</Text>
              <Text style={styles.paragraph}>Задание засчитано. Прогресс обновится на панели.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace("/(tabs)/dashboard")} style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}>
                <Text style={styles.nextButtonText}>На панель</Text>
                <Ionicons name="arrow-forward" size={16} color="#ffffff" />
              </Pressable>
            </View>
          ) : null}
        </ScrollView>

        <AIModal visible={aiOpen} onClose={() => setAiOpen(false)} />
      </View>
    </SafeAreaView>
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

function AIModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalLayer}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.aiSheet}>
          <View style={styles.dragHandle} />
          <View style={styles.aiSheetHeader}>
            <Text style={styles.aiSheetTitle}>AI-ассистент</Text>
            <Pressable accessibilityLabel="Close AI assistant" accessibilityRole="button" onPress={onClose}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.aiSheetText}>
            Полноценный чат с ассистентом доступен на вкладке «Ассистент» — там он видит вашу
            текущую тему и слабые места и помогает без готового ответа.
          </Text>
        </View>
      </View>
    </Modal>
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
  cardTitle: { color: colors.text, fontSize: 22, fontWeight: "900", lineHeight: 29 },
  paragraph: { marginTop: 12, color: colors.muted, fontSize: 16, lineHeight: 24 },
  aiBanner: { minHeight: 82, borderRadius: 10, borderColor: "#f0d4b8", borderWidth: 1, backgroundColor: "#fff7ed", flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  aiIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#fde5d7" },
  aiCopy: { flex: 1 },
  aiTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  aiText: { marginTop: 3, color: colors.muted, fontSize: 14, lineHeight: 19 },
  quizCard: { borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, padding: 18, gap: 14 },
  nextButton: { minHeight: 52, borderRadius: 8, backgroundColor: colors.navy, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  nextButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  modalLayer: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.22)" },
  aiSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  dragHandle: { width: 48, height: 5, borderRadius: 3, alignSelf: "center", backgroundColor: colors.border, marginBottom: 16 },
  aiSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  aiSheetTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  aiSheetText: { marginTop: 12, color: colors.muted, fontSize: 16, lineHeight: 24 },
  emptyText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.76 },
});
