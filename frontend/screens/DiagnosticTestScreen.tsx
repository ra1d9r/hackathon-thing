import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { QuestionCard } from "@/components/QuestionCard";
import { apiGet } from "@/services/api";
import { useAttempt } from "@/hooks/useAttempt";
import { useAuthStore } from "@/store/useAuthStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";

interface DiagnosticState {
  state: "not_assigned" | "available" | "in_progress" | "grading" | "completed";
  assessment: { id: string; title: string; question_count: number } | null;
  attempt: { id: string; status: string } | null;
}

const targetLabels: Record<string, string> = {
  ent: "ЕНТ",
  nis: "НИШ",
  subjects: "Школьные предметы",
  olympiad: "Олимпиада",
};

export function DiagnosticTestScreen() {
  const me = useAuthStore((state) => state.me);
  const diagnosticSummary = useOnboardingStore((state) => state.diagnostic);
  const {
    attempt,
    questions,
    answers,
    index,
    currentQuestion,
    isLoading,
    isSubmitting,
    error,
    startFromAssessment,
    loadExisting,
    setAnswer,
    goNext,
    goPrev,
    submit,
  } = useAttempt();

  const [phase, setPhase] = useState<"loading" | "ready" | "submitting" | "unavailable">("loading");
  const clientAttemptId = useRef(`diag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Уже есть попытка (например, экран переоткрыли) — продолжаем её.
        const diag = await apiGet<DiagnosticState>("/v1/diagnostic");
        if (cancelled) return;

        if (diag.attempt && diag.attempt.status === "in_progress") {
          await loadExisting(diag.attempt.id);
        } else if (diag.assessment) {
          await startFromAssessment(diag.assessment.id, clientAttemptId.current);
        } else {
          setPhase("unavailable");
          return;
        }
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = questions.length;
  const answeredCount = questions.filter((q) => answers[q.id]).length;
  const progressPct = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  const isLast = index === total - 1;
  const hasAnswer = currentQuestion ? Boolean(answers[currentQuestion.id]) : false;

  const handlePrimary = async () => {
    if (!isLast) {
      await goNext();
      return;
    }
    setPhase("submitting");
    try {
      const result = await submit();
      router.replace({
        pathname: "/diagnostic-results",
        params: { attemptId: attempt?.id ?? "", jobId: result.job?.id ?? "" },
      });
    } catch {
      setPhase("ready");
    }
  };

  if (phase === "loading" || isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.blue} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "unavailable" || !attempt || !currentQuestion) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.centered}>
          <Text style={styles.title}>Диагностика недоступна</Text>
          <Text style={styles.subtitle}>
            {error ?? "Пока недостаточно вопросов для вашего класса и предметов. Загляните позже."}
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => router.replace(routes.tabsRoot)}>
            <Text style={styles.primaryButtonText}>На панель</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>Tlek</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Диагностический тест</Text>
            <Text style={styles.subtitle}>Ответьте на несколько вопросов, чтобы мы построили точный учебный маршрут.</Text>
          </View>

          <View style={styles.statusCard}>
            <View style={styles.statusIcon}>
              <Ionicons name="analytics-outline" size={22} color={colors.blue} />
            </View>
            <View style={styles.statusCopy}>
              <Text style={styles.statusLabel}>Текущая цель</Text>
              <Text style={styles.statusValue}>
                {me?.student?.goal ? targetLabels[me.student.goal] ?? me.student.goal : "—"}
              </Text>
              <Text style={styles.statusMeta}>
                {diagnosticSummary
                  ? `${diagnosticSummary.subjects.map((s) => s.name).join(", ")}`
                  : "Индивидуальная диагностика"}
              </Text>
            </View>
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressText}>Вопрос {index + 1} из {total} ({answeredCount} отвечено)</Text>
            <Text style={styles.progressText}>{progressPct}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <QuestionCard
            question={currentQuestion}
            answer={answers[currentQuestion.id]}
            onChange={(value) => setAnswer(currentQuestion.id, value)}
          />
        </ScrollView>

        <View style={styles.footer}>
          <FooterButton icon="chevron-back" label="Назад" onPress={goPrev} variant="ghost" disabled={index === 0} />
          <FooterButton
            icon={isLast ? undefined : "chevron-forward"}
            label={isLast ? "Завершить тест" : "Далее"}
            onPress={handlePrimary}
            disabled={!hasAnswer || isSubmitting || phase === "submitting"}
            loading={isSubmitting || phase === "submitting"}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

interface FooterButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}

function FooterButton({ label, onPress, icon, variant = "primary", disabled = false, loading = false }: FooterButtonProps) {
  const isGhost = variant === "ghost";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerButton,
        isGhost ? styles.footerButtonGhost : styles.footerButtonPrimary,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={22} color={isGhost ? colors.text : "#ffffff"} /> : null}
          <Text style={[styles.footerButtonText, isGhost ? styles.footerButtonGhostText : styles.footerButtonPrimaryText]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  text: "#242528",
  muted: "#515565",
  border: "#c5cede",
  blue: "#0057d9",
  navy: "#274779",
  iconBackground: "#ecf2ff",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  header: { height: 63, justifyContent: "center", borderBottomColor: "#e1e4ea", borderBottomWidth: 1, paddingHorizontal: 16 },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 },
  titleBlock: { alignItems: "center", marginBottom: 28, paddingHorizontal: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", lineHeight: 31, textAlign: "center" },
  subtitle: { maxWidth: 326, marginTop: 8, color: colors.muted, fontSize: 17, lineHeight: 25, textAlign: "center" },
  statusCard: {
    minHeight: 104,
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    marginBottom: 20,
  },
  statusIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.iconBackground },
  statusCopy: { flex: 1 },
  statusLabel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  statusValue: { marginTop: 2, color: colors.text, fontSize: 20, fontWeight: "900", lineHeight: 26 },
  statusMeta: { marginTop: 3, color: colors.muted, fontSize: 14, lineHeight: 20 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  progressText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  progressTrack: { height: 8, overflow: "hidden", borderRadius: 4, backgroundColor: "#e9edf5", marginBottom: 24 },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: colors.blue },
  errorText: { color: "#c31717", fontSize: 14, marginBottom: 12 },
  footer: {
    minHeight: 80,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.background,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  footerButton: { minHeight: 42, minWidth: 92, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  footerButtonPrimary: { backgroundColor: colors.navy, paddingHorizontal: 18 },
  footerButtonGhost: { backgroundColor: "transparent", minWidth: 80, paddingHorizontal: 0 },
  footerButtonText: { fontSize: 12, fontWeight: "800" },
  footerButtonPrimaryText: { color: "#ffffff" },
  footerButtonGhostText: { color: colors.text },
  primaryButton: { minHeight: 48, borderRadius: 8, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.48 },
});
