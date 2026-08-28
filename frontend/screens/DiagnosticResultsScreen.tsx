import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiGet, waitForJob } from "@/services/api";
import { waitForAttemptJob, type JobRef } from "@/hooks/useAttempt";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";

interface TopicResult {
  topic_id: string;
  title: string;
  points_earned: number;
  points_possible: number;
  pct: number;
}

interface SubjectResult {
  code: string;
  name: string;
  points_earned: number;
  points_possible: number;
  pct: number;
}

interface Highlight {
  topic_id: string;
  title: string;
  pct: number;
  note: string | null;
}

interface AttemptResult {
  attempt: {
    id: string;
    status: string;
    raw_score: number | null;
    max_score: number | null;
    score_pct: number | null;
    pending_questions: number;
  };
  subjects: SubjectResult[];
  topics: TopicResult[];
  strengths: Highlight[];
  focus: Highlight[];
  analysis: { source: "ai" | "fallback"; summary_md: string | null } | null;
  job: JobRef | null;
}

export function DiagnosticResultsScreen() {
  const params = useLocalSearchParams<{ attemptId?: string; jobId?: string }>();
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!params.attemptId) {
        setError("Попытка не найдена");
        setIsLoading(false);
        return;
      }

      try {
        await waitForAttemptJob(params.jobId);
        let data = await apiGet<AttemptResult>(`/v1/attempts/${params.attemptId}/result`);
        if (!cancelled) setResult(data);

        const jobDeadline = Date.now() + 240_000;
        while (data.job && Date.now() < jobDeadline && !cancelled) {
          await waitForJob(data.job.id, { totalTimeoutMs: 20_000, waitMs: 20_000 });
          data = await apiGet<AttemptResult>(`/v1/attempts/${params.attemptId}/result`);
          if (!cancelled) setResult(data);
        }

        if (!cancelled) await useAuthStore.getState().refreshMe();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить результат");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.attemptId, params.jobId]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.blue} size="large" />
          <Text style={styles.subtitle}>Считаем результат…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !result) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.centered}>
          <Text style={styles.title}>Не удалось загрузить результат</Text>
          <Text style={styles.subtitle}>{error}</Text>
          <Pressable style={styles.nextButton} onPress={() => router.replace(routes.tabsRoot)}>
            <Text style={styles.nextButtonText}>На панель</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const maxScore = result.attempt.max_score ?? 0;
  const rawScore = result.attempt.raw_score ?? 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.logo}>Tlek</Text>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>Результаты</Text>
          <Text style={styles.subtitle}>Здесь результаты проверки ваших знаний</Text>
        </View>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreTitle}>Набрано баллов</Text>
          <Text style={styles.scoreDescription}>
            {result.analysis?.summary_md ??
              "Ваши базовые показатели показывают солидную основу и выявляют области для целенаправленного изучения."}
          </Text>
          <View style={styles.scoreRing}>
            <Text style={styles.scoreNumber}>{Math.round(rawScore)}</Text>
            <Text style={styles.scoreTotal}>/ {Math.round(maxScore)}</Text>
          </View>
          {result.attempt.pending_questions > 0 ? (
            <Text style={styles.pendingText}>
              {result.attempt.pending_questions} ответов ещё проверяются моделью
            </Text>
          ) : null}
        </View>

        {result.strengths.length > 0 ? (
          <InsightCard
            icon="checkmark-circle-outline"
            iconColor="#00a85a"
            title="Сильные стороны"
            rows={result.strengths.map((h) => ({ label: h.title, score: `${Math.round(h.pct)}%` }))}
          />
        ) : null}

        {result.focus.length > 0 ? (
          <InsightCard
            icon="warning-outline"
            iconColor="#df2020"
            title="Требует фокуса"
            rows={result.focus.map((h) => ({ label: h.title, score: `${Math.round(h.pct)}%` }))}
            danger
          />
        ) : null}

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>По предметам</Text>
          <View style={styles.subjectList}>
            {result.subjects.map((item) => (
              <SubjectProgress
                key={item.code}
                label={item.name}
                score={`${Math.round(item.points_earned)}/${Math.round(item.points_possible)}`}
                progress={item.pct / 100}
                color={item.pct >= 70 ? "#27b83e" : item.pct >= 40 ? "#efb900" : "#d42020"}
              />
            ))}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace(routes.tabsRoot)}
          style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
        >
          <Text style={styles.nextButtonText}>Дальше</Text>
          <Ionicons name="arrow-forward" size={16} color="#ffffff" />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

interface InsightCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  rows: { label: string; score: string }[];
  danger?: boolean;
}

function InsightCard({ icon, iconColor, title, rows, danger = false }: InsightCardProps) {
  return (
    <View style={styles.insightCard}>
      <View style={styles.insightHeader}>
        <Ionicons name={icon} size={22} color={iconColor} />
        <Text style={styles.insightTitle}>{title}</Text>
      </View>
      <View style={styles.metricRows}>
        {rows.map((row) => (
          <View key={row.label} style={styles.metricRow}>
            <Text style={styles.metricLabel}>{row.label}</Text>
            <View style={[styles.metricBadge, danger && styles.metricBadgeDanger]}>
              <Text style={[styles.metricScore, danger && styles.metricScoreDanger]}>{row.score}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function SubjectProgress({ label, score, progress, color }: { label: string; score: string; progress: number; color: string }) {
  return (
    <View style={styles.subjectItem}>
      <View style={styles.subjectHeader}>
        <Text style={styles.subjectLabel}>{label}</Text>
        <Text style={styles.subjectScore}>{score}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  text: "#202124",
  muted: "#4f5362",
  border: "#c5cede",
  blue: "#0057d9",
  navy: "#274779",
  teal: "#51aab3",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  content: { alignItems: "center", paddingBottom: 46 },
  header: { width: "100%", height: 63, justifyContent: "center", borderBottomColor: "#e1e4ea", borderBottomWidth: 1, paddingHorizontal: 16 },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  titleBlock: { width: "100%", alignItems: "center", paddingHorizontal: 16, paddingTop: 30, paddingBottom: 28 },
  title: { color: colors.text, fontSize: 40, fontWeight: "900", lineHeight: 48, textAlign: "center" },
  subtitle: { maxWidth: 320, marginTop: 8, color: colors.muted, fontSize: 17, lineHeight: 25, textAlign: "center" },
  scoreCard: {
    width: "100%",
    maxWidth: 358,
    alignItems: "center",
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 28,
    paddingTop: 26,
    paddingBottom: 26,
    marginHorizontal: 16,
  },
  scoreTitle: { color: colors.text, fontSize: 25, fontWeight: "900", lineHeight: 31, textAlign: "center" },
  scoreDescription: { maxWidth: 300, marginTop: 12, color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  scoreRing: { width: 186, height: 186, alignItems: "center", justifyContent: "center", borderRadius: 93, borderColor: colors.teal, borderWidth: 16, marginTop: 30 },
  scoreNumber: { color: colors.teal, fontSize: 44, fontWeight: "900", lineHeight: 52 },
  scoreTotal: { marginTop: -4, color: "#252936", fontSize: 13, fontWeight: "800" },
  pendingText: { marginTop: 16, color: "#c84b16", fontSize: 13, fontWeight: "700", textAlign: "center" },
  insightCard: { width: "100%", maxWidth: 358, borderRadius: 6, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 16, marginTop: 25, marginHorizontal: 16 },
  insightHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  insightTitle: { color: colors.text, fontSize: 22, fontWeight: "900", lineHeight: 28 },
  metricRows: { gap: 0 },
  metricRow: { minHeight: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: colors.border, borderBottomWidth: 1 },
  metricLabel: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22 },
  metricBadge: { minWidth: 42, borderRadius: 3, backgroundColor: "#f0eeee", paddingHorizontal: 8, paddingVertical: 4, alignItems: "center" },
  metricBadgeDanger: { backgroundColor: "#ffdede" },
  metricScore: { color: colors.text, fontSize: 12, fontWeight: "800" },
  metricScoreDanger: { color: "#c31717" },
  summaryCard: { width: "100%", maxWidth: 358, borderRadius: 6, borderColor: colors.border, borderWidth: 1, backgroundColor: "#f7f5f4", paddingHorizontal: 24, paddingTop: 25, paddingBottom: 24, marginTop: 25, marginHorizontal: 16 },
  summaryTitle: { color: colors.text, fontSize: 22, fontWeight: "900", lineHeight: 28 },
  subjectList: { marginTop: 24, gap: 26 },
  subjectItem: { width: "100%" },
  subjectHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 9 },
  subjectLabel: { flex: 1, color: colors.muted, fontSize: 15, lineHeight: 21, paddingRight: 12 },
  subjectScore: { color: colors.text, fontSize: 12, lineHeight: 17 },
  progressTrack: { height: 7, overflow: "hidden", borderRadius: 4, backgroundColor: "#f0eeee" },
  progressFill: { height: "100%", borderRadius: 4 },
  nextButton: { minWidth: 132, minHeight: 44, borderRadius: 7, backgroundColor: colors.navy, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 32 },
  nextButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.78 },
});
