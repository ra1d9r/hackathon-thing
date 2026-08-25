import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { apiGet } from "@/services/api";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";

const targetLabels: Record<string, string> = {
  ent: "ЕНТ",
  nis: "НИШ",
  subjects: "Предметы",
  olympiad: "Олимпиада",
};

interface DailyPlanItemDto {
  id: string;
  title: string;
  meta: string;
  subject_name: string | null;
  status: "pending" | "in_progress" | "completed" | "skipped";
}

interface DashboardResponse {
  goal: { kind: string; title: string; days_left: number | null };
  predicted_score: { value: number; max: number } | null;
  daily_plan: { completed: number; total: number; items: DailyPlanItemDto[] };
}

export function StudentDashboardScreen() {
  const me = useAuthStore((state) => state.me);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    apiGet<DashboardResponse>("/v1/dashboard")
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Не удалось загрузить панель"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(load, [load]);
  useFocusEffect(useCallback(() => load(), [load]));

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.logo}>Tlek</Text>
          <Pressable
            accessibilityLabel="Личный кабинет"
            accessibilityRole="button"
            onPress={() => router.push(routes.personalAccount)}
            style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
          >
            <Avatar uri={me?.avatar_url} name={me?.display_name} size={30} />
          </Pressable>
        </View>

        {isLoading ? <ActivityIndicator color={colors.blue} style={{ marginTop: 24 }} /> : null}
        {error ? <Text style={styles.emptyText}>{error}</Text> : null}

        {data ? (
          <>
            <View style={styles.goalCard}>
              <View style={styles.goalTop}>
                <View>
                  <Text style={styles.kicker}>ЦЕЛЬ</Text>
                  <Text style={styles.goalValue}>{targetLabels[data.goal.kind] ?? data.goal.title}</Text>
                </View>
                {data.goal.days_left !== null ? (
                  <View style={styles.daysBlock}>
                    <Text style={styles.kicker}>ОСТАЛОСЬ</Text>
                    <Text style={styles.daysValue}>{data.goal.days_left} дней</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.divider} />
              {data.predicted_score ? (
                <View style={styles.scoreRow}>
                  <View>
                    <Text style={styles.scoreLabel}>Ориентировочный балл</Text>
                    <Text style={styles.scoreValue}>
                      {Math.round(data.predicted_score.value)} <Text style={styles.scoreTotal}>/ {Math.round(data.predicted_score.max)}</Text>
                    </Text>
                  </View>
                  <View style={styles.smallProgressTrack}>
                    <View
                      style={[
                        styles.smallProgressFill,
                        { width: `${Math.min(100, Math.round((data.predicted_score.value / data.predicted_score.max) * 100))}%` },
                      ]}
                    />
                  </View>
                </View>
              ) : (
                <Text style={styles.subjectHint}>Прогноз появится после первого теста.</Text>
              )}
            </View>

            <View style={styles.focusCard}>
              <View style={styles.focusHeader}>
                <Ionicons name="radio-button-on-outline" size={22} color={colors.text} />
                <Text style={styles.focusTitle}>Сегодняшний фокус</Text>
                <Text style={styles.focusCount}>
                  {data.daily_plan.completed}/{data.daily_plan.total}
                </Text>
              </View>
              <View style={styles.taskList}>
                {data.daily_plan.items.length === 0 ? (
                  <Text style={styles.emptyText}>На сегодня заданий нет.</Text>
                ) : (
                  data.daily_plan.items.map((task) => (
                    <TaskCard
                      key={task.id}
                      title={task.title}
                      meta={task.meta}
                      subject={task.subject_name}
                      done={task.status === "completed" || task.status === "skipped"}
                      onPress={() =>
                        router.push({ pathname: "/task-execution-workspace", params: { itemId: task.id } })
                      }
                    />
                  ))
                )}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

interface TaskCardProps {
  title: string;
  meta: string;
  subject: string | null;
  done: boolean;
  onPress: () => void;
}

function TaskCard({ title, meta, subject, done, onPress }: TaskCardProps) {
  return (
    <Pressable
      disabled={done}
      onPress={onPress}
      style={({ pressed }) => [styles.taskCard, done && styles.taskCardDone, pressed && styles.pressed]}
    >
      <View style={[styles.checkBox, done && styles.checkBoxDone]}>
        {done ? <Ionicons name="checkmark" size={18} color="#ffffff" /> : null}
      </View>
      <View style={styles.taskCopy}>
        <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{title}</Text>
        <Text style={[styles.taskMeta, done && styles.taskMetaDone]}>{meta}</Text>
      </View>
      {subject ? (
        <View style={styles.subjectBadge}>
          <Text style={styles.subjectBadgeText}>{subject}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  panel: "#f7f5f4",
  text: "#202124",
  muted: "#5b6070",
  border: "#c5cede",
  blue: "#0057d9",
  navy: "#274779",
  teal: "#55aab1",
  orange: "#cc4d00"
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 28 },
  header: {
    width: "100%",
    height: 63,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#e1e4ea",
    borderBottomWidth: 1,
    paddingHorizontal: 16
  },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  avatarButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  avatar: { width: 28, height: 28, borderRadius: 14, borderColor: "#ffffff", borderWidth: 2 },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 16, paddingHorizontal: 16 },
  goalCard: {
    marginHorizontal: 16,
    marginTop: 17,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14
  },
  goalTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  kicker: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.6, lineHeight: 16 },
  goalValue: { color: colors.text, fontSize: 21, fontWeight: "900", lineHeight: 27 },
  daysBlock: { alignItems: "flex-end" },
  daysValue: { color: colors.orange, fontSize: 20, fontWeight: "900", lineHeight: 27 },
  divider: { height: 1, backgroundColor: colors.border, marginTop: 16, marginBottom: 15 },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 20 },
  scoreLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.35, lineHeight: 16 },
  scoreValue: { color: colors.teal, fontSize: 24, fontWeight: "500", lineHeight: 30 },
  scoreTotal: { color: colors.muted, fontSize: 15, fontWeight: "500" },
  smallProgressTrack: { width: 96, height: 8, overflow: "hidden", borderRadius: 4, backgroundColor: "#dadada" },
  smallProgressFill: { height: "100%", borderRadius: 4, backgroundColor: colors.teal },
  subjectHint: { marginTop: 10, color: colors.muted, fontSize: 12, lineHeight: 16 },
  focusCard: {
    marginHorizontal: 16,
    marginTop: 32,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingTop: 17,
    paddingBottom: 16
  },
  focusHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  focusTitle: { flex: 1, color: colors.text, fontSize: 22, fontWeight: "900", lineHeight: 28 },
  focusCount: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  taskList: { gap: 12 },
  taskCard: {
    minHeight: 74,
    borderRadius: 4,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.panel,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 14
  },
  taskCardDone: { opacity: 0.58 },
  checkBox: { width: 20, height: 20, borderRadius: 2, borderColor: "#9aa3b4", borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 4 },
  checkBoxDone: { borderColor: "#9a9a9a", backgroundColor: "#9a9a9a" },
  taskCopy: { flex: 1, paddingLeft: 12, paddingRight: 8 },
  taskTitle: { color: colors.text, fontSize: 17, fontWeight: "500", lineHeight: 24 },
  taskTitleDone: { color: "#777777", textDecorationLine: "line-through" },
  taskMeta: { marginTop: 8, color: "#6b6b6b", fontSize: 15, lineHeight: 20 },
  taskMetaDone: { color: "#777777" },
  subjectBadge: { maxWidth: 132, borderRadius: 3, backgroundColor: "#e9e7e7", paddingHorizontal: 8, paddingVertical: 3 },
  subjectBadgeText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  pressed: { opacity: 0.76 }
});
