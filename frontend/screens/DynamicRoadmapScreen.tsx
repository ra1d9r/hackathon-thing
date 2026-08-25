import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";

import { useLessonPreview, useRoadmap, useUserProfile } from "@/hooks/useData";
import { apiGet } from "@/services/api";
import type { RoadmapNode, Subject } from "@/types/app";


interface RoadmapNodeDetail {
  node: { lesson_id: string | null };
}

export function DynamicRoadmapScreen() {
  const { user, isLoading: isUserLoading } = useUserProfile();
  const subjects = user?.selectedSubjects ?? [];

  // `subject_id` в `/v1/roadmap` — настоящий UUID, а не код предмета, и ни
  // `/v1/me`, ни каталог его клиенту не отдают. backend сам выбирает предмет
  // ученика; какой именно — видно в ответе (`subject`) и подсвечивается ниже
  // в списке предметов.
  const { nodes, currentScore, subject, isLoading: isRoadmapLoading, error } = useRoadmap();
  const [selectedNode, setSelectedNode] = useState<RoadmapNode | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const { material } = useLessonPreview(selectedLessonId);

  const openTask = async (node: RoadmapNode) => {
    if (node.status === "LOCKED") return;
    setSelectedNode(node);
    try {
      const detail = await apiGet<RoadmapNodeDetail>(`/v1/roadmap/nodes/${node.id}`);
      setSelectedLessonId(detail.node.lesson_id);
    } catch {
      setSelectedLessonId(null);
    }
  };

  const startTask = () => {
    if (!selectedLessonId) return;
    setSelectedNode(null);
    router.push({ pathname: "/task-execution-workspace", params: { lessonId: selectedLessonId } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>Tlek</Text>
          <Avatar uri={user?.avatarUrl} name={user?.name} size={30} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <SubjectChips subjects={subjects} activeCode={subject?.code ?? null} />

          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>СРЕДНЯЯ ГОТОВНОСТЬ</Text>
            <Text style={styles.scoreValue}>
              <Text style={styles.scoreX}>{nodes.length > 0 ? currentScore : "—"}</Text> / 100 по темам карты
            </Text>
          </View>

          <View style={styles.roadmap}>
            {isUserLoading || isRoadmapLoading ? <ActivityIndicator color={colors.blue} /> : null}
            {error ? <Text style={styles.emptyText}>{error}</Text> : null}
            {!isRoadmapLoading && !error && nodes.length === 0 ? (
              <Text style={styles.emptyText}>
                Дорожная карта ещё не построена. Она появится после диагностики — тогда ИИ
                подберёт темы под ваши слабые места.
              </Text>
            ) : null}
            {nodes.map((node) => (
              <NodeCard key={node.id} node={node} onPress={() => openTask(node)} />
            ))}
          </View>
        </ScrollView>

        <TaskSheet
          node={selectedNode}
          paragraphs={material?.paragraphs ?? []}
          canStart={selectedLessonId !== null}
          onClose={() => setSelectedNode(null)}
          onStart={startTask}
        />
      </View>
    </SafeAreaView>
  );
}

/**
 * Список предметов ученика — информационный, не переключатель.
 *
 * Подсвечивается тот, чью карту сейчас показывает backend (см. комментарий
 * в `DynamicRoadmapScreen`); нажатие не меняет запрос.
 */
function SubjectChips({ subjects, activeCode }: { subjects: Subject[]; activeCode: string | null }) {
  if (subjects.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {subjects.map((subj) => (
        <View key={subj.id} style={[styles.chip, activeCode === subj.code && styles.chipActive]}>
          <Text style={[styles.chipText, activeCode === subj.code && styles.chipTextActive]} numberOfLines={1}>
            {subj.title}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function NodeCard({ node, onPress }: { node: RoadmapNode; onPress: () => void }) {
  const icon = node.status === "COMPLETED" ? "checkmark-circle" : node.status === "LOCKED" ? "lock-closed-outline" : "play-circle-outline";
  const iconColor = node.status === "COMPLETED" ? colors.green : node.status === "LOCKED" ? "#9aa1af" : colors.blue;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={node.status === "LOCKED"}
      onPress={onPress}
      style={({ pressed }) => [
        styles.nodeCard,
        node.status === "ACTIVE" && styles.nodeCardActive,
        node.status === "LOCKED" && styles.nodeCardLocked,
        pressed && node.status !== "LOCKED" && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={28} color={iconColor} />
      <View style={styles.nodeCopy}>
        <Text style={[styles.nodeTitle, node.status === "LOCKED" && styles.nodeTitleLocked]}>{node.title}</Text>
        <Text style={styles.nodeMeta}>{node.masteryPercentage}% пройдено</Text>
      </View>
    </Pressable>
  );
}

function TaskSheet({
  node,
  paragraphs,
  canStart,
  onClose,
  onStart,
}: {
  node: RoadmapNode | null;
  paragraphs: string[];
  canStart: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <View style={[styles.sheetOverlay, !node && styles.hidden]} pointerEvents={node ? "auto" : "none"}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.dragHandle} />
        <Pressable accessibilityLabel="Закрыть" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={28} color="#4b5060" />
        </Pressable>

        <Text style={styles.sheetTitle}>{node?.title ?? ""}</Text>
        <Text style={styles.lessonPreview} numberOfLines={4}>
          {paragraphs[0] ?? "Материал к этой теме ещё готовится."}
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={!canStart}
          onPress={onStart}
          style={({ pressed }) => [styles.sheetButton, pressed && styles.pressed, !canStart && styles.sheetButtonDisabled]}
        >
          <Text style={styles.sheetButtonText}>
            {canStart ? "Начать урок и проверку" : "Материал ещё не готов"}
          </Text>
          {canStart ? <Ionicons name="arrow-forward" size={22} color="#ffffff" /> : null}
        </Pressable>
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
  green: "#11a857",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  header: { height: 63, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: "#e1e4ea", borderBottomWidth: 1, paddingHorizontal: 16 },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  scroll: { flex: 1 },
  content: { paddingBottom: 24 },
  chipRow: { gap: 8, paddingHorizontal: 16, paddingTop: 17, paddingBottom: 20 },
  chip: { height: 32, minWidth: 120, alignItems: "center", justifyContent: "center", borderRadius: 12, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, paddingHorizontal: 16 },
  chipActive: { borderColor: "#1765ff", borderWidth: 2, backgroundColor: colors.navy },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 17 },
  chipTextActive: { color: "#ffffff" },
  scoreCard: { minHeight: 78, marginHorizontal: 17, borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, justifyContent: "center", paddingHorizontal: 16, marginBottom: 24 },
  scoreLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.4, lineHeight: 16 },
  scoreValue: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  scoreX: { color: colors.blue, fontSize: 24, fontWeight: "900" },
  roadmap: { paddingHorizontal: 16, gap: 12 },
  nodeCard: { minHeight: 74, borderRadius: 8, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16 },
  nodeCardActive: { borderColor: "#1765ff", borderWidth: 1.5 },
  nodeCardLocked: { opacity: 0.6 },
  nodeCopy: { flex: 1 },
  nodeTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  nodeTitleLocked: { color: "#8b8d96" },
  nodeMeta: { marginTop: 4, color: colors.muted, fontSize: 13 },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 12 },
  sheetOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  hidden: { opacity: 0 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.22)" },
  sheet: { width: "100%", borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: colors.card, paddingHorizontal: 36, paddingTop: 16, paddingBottom: 24 },
  dragHandle: { width: 48, height: 5, borderRadius: 3, alignSelf: "center", backgroundColor: colors.border, marginBottom: 16 },
  closeButton: { position: "absolute", right: 22, top: 44, width: 36, height: 36, alignItems: "center", justifyContent: "center", zIndex: 2 },
  sheetTitle: { color: colors.text, fontSize: 26, fontWeight: "900", lineHeight: 33, marginTop: 10, paddingRight: 42 },
  lessonPreview: { marginTop: 12, color: colors.muted, fontSize: 15, lineHeight: 22 },
  sheetButton: { minHeight: 52, borderRadius: 7, backgroundColor: colors.navy, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 32 },
  sheetButtonDisabled: { opacity: 0.5 },
  sheetButtonText: { color: "#ffffff", fontSize: 20, fontWeight: "900", lineHeight: 26 },
  pressed: { opacity: 0.76 },
});
