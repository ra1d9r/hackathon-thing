import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";

import { useLessonPreview, useRoadmap, useUserProfile } from "@/hooks/useData";
import { apiGet } from "@/services/api";
import { routes } from "@/types/navigation";
import type { RoadmapNode, Subject } from "@/types/app";


interface RoadmapNodeDetail {
  node: { lesson_id: string | null };
}

export function DynamicRoadmapScreen() {
  const { user, isLoading: isUserLoading } = useUserProfile();
  const subjects = user?.selectedSubjects ?? [];

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
          <Pressable
            accessibilityLabel="Личный кабинет"
            accessibilityRole="button"
            onPress={() => router.push(routes.personalAccount)}
            style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
          >
            <Avatar uri={user?.avatarUrl} name={user?.name} size={30} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <SubjectSelector subjects={subjects} activeCode={subject?.code ?? null} />
          <ReadinessScoreCard score={nodes.length > 0 ? currentScore : null} subjectName={subject?.name ?? null} />

          <View style={styles.roadmapSection}>
            {isUserLoading || isRoadmapLoading ? <ActivityIndicator color={colors.blue} /> : null}
            {error ? <Text style={styles.emptyText}>{error}</Text> : null}
            {!isRoadmapLoading && !error && nodes.length === 0 ? (
              <Text style={styles.emptyText}>
                Дорожная карта ещё не построена. Она появится, когда будут готовы первые данные
                по темам и заданиям.
              </Text>
            ) : null}
            {nodes.length > 0 ? <RoadmapTimeline nodes={nodes} onNodePress={openTask} /> : null}
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

function SubjectSelector({ subjects, activeCode }: { subjects: Subject[]; activeCode: string | null }) {
  if (subjects.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.subjectRow}
    >
      {subjects.map((subj) => (
        <View key={subj.id} style={[styles.subjectChip, activeCode === subj.code && styles.subjectChipActive]}>
          <Text style={[styles.subjectChipText, activeCode === subj.code && styles.subjectChipTextActive]} numberOfLines={1}>
            {subj.title}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function ReadinessScoreCard({ score, subjectName }: { score: number | null; subjectName: string | null }) {
  const pct = score ?? 0;

  return (
    <View style={styles.scoreCard}>
      <View style={styles.scoreTopRow}>
        <View>
          <Text style={styles.scoreLabel}>СРЕДНЯЯ ГОТОВНОСТЬ</Text>
          <Text style={styles.scoreSubject}>{subjectName ?? "Дорожная карта"}</Text>
        </View>
        <Text style={styles.scoreValue}>
          <Text style={styles.scoreX}>{score ?? "—"}</Text>
          <Text style={styles.scoreMax}> / 100</Text>
        </Text>
      </View>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${Math.min(100, Math.max(0, pct))}%` }]} />
      </View>
      <Text style={styles.scoreHint}>Прогресс считается по освоенным темам текущего маршрута.</Text>
    </View>
  );
}

function RoadmapTimeline({ nodes, onNodePress }: { nodes: RoadmapNode[]; onNodePress: (node: RoadmapNode) => void }) {
  return (
    <View style={styles.timeline}>
      <View style={styles.timelineLine} />
      {nodes.map((node, index) => (
        <TimelineItem
          key={node.id}
          node={node}
          index={index}
          isLast={index === nodes.length - 1}
          onPress={() => onNodePress(node)}
        />
      ))}
    </View>
  );
}

function TimelineItem({ node, index, isLast, onPress }: { node: RoadmapNode; index: number; isLast: boolean; onPress: () => void }) {
  return (
    <View style={[styles.timelineItem, isLast && styles.timelineItemLast]}>
      <StatusIcon status={node.status} />
      <NodeCard node={node} index={index} onPress={onPress} />
    </View>
  );
}

function StatusIcon({ status }: { status: RoadmapNode["status"] }) {
  const isCompleted = status === "COMPLETED";
  const isLocked = status === "LOCKED";
  const icon = isCompleted ? "checkmark" : isLocked ? "lock-closed-outline" : "play";

  return (
    <View style={[styles.statusIcon, isCompleted && styles.statusIconCompleted, isLocked && styles.statusIconLocked]}>
      <Ionicons name={icon} size={isLocked ? 18 : 20} color={isLocked ? "#8a92a3" : "#ffffff"} />
    </View>
  );
}

function NodeCard({ node, index, onPress }: { node: RoadmapNode; index: number; onPress: () => void }) {
  const isCompleted = node.status === "COMPLETED";
  const isActive = node.status === "ACTIVE";
  const isLocked = node.status === "LOCKED";
  const meta = isCompleted ? "Выполнено" : isActive ? "Текущий шаг" : "Откроется позже";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={node.status === "LOCKED"}
      onPress={onPress}
      style={({ pressed }) => [
        styles.nodeCard,
        isActive && styles.nodeCardActive,
        isLocked && styles.nodeCardLocked,
        pressed && !isLocked && styles.pressed,
      ]}
    >
      {isActive ? (
        <View style={styles.ctaBadge}>
          <Text style={styles.ctaBadgeText}>Начать задание</Text>
          <Ionicons name="arrow-forward" size={13} color="#ffffff" />
        </View>
      ) : null}
      <View style={styles.nodeCopy}>
        <Text style={[styles.nodeTitle, isLocked && styles.nodeTitleLocked]}>{node.title}</Text>
        <View style={styles.nodeMetaRow}>
          <View style={[styles.nodeBadge, isCompleted && styles.nodeBadgeCompleted, isLocked && styles.nodeBadgeLocked]}>
            <Text style={[styles.nodeBadgeText, isCompleted && styles.nodeBadgeTextCompleted, isLocked && styles.nodeBadgeTextLocked]}>
              {isCompleted ? `${node.masteryPercentage}%` : `Шаг ${index + 1}`}
            </Text>
          </View>
          <Text style={[styles.nodeMeta, isLocked && styles.nodeMetaLocked]}>{meta}</Text>
        </View>
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
  panel: "#f5f3f1",
  card: "#ffffff",
  text: "#202124",
  muted: "#4f5362",
  border: "#c5cede",
  blue: "#0057d9",
  navy: "#274779",
  green: "#11a857",
  orange: "#c84b16",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  header: { height: 63, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: "#e1e4ea", borderBottomWidth: 1, paddingHorizontal: 16 },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  avatarButton: { borderRadius: 15 },
  scroll: { flex: 1 },
  content: { paddingBottom: 28 },
  subjectRow: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 17,
    paddingBottom: 18,
  },
  subjectChip: {
    height: 34,
    minWidth: 128,
    maxWidth: 190,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
  },
  subjectChipActive: {
    borderColor: colors.blue,
    borderWidth: 2,
    backgroundColor: colors.navy,
  },
  subjectChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17,
  },
  subjectChipTextActive: { color: "#ffffff" },
  scoreCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 16,
    marginBottom: 26,
    shadowColor: "#243b63",
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  scoreTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  scoreLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.4, lineHeight: 16 },
  scoreSubject: {
    marginTop: 3,
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24,
  },
  scoreValue: { color: colors.muted, fontSize: 15, lineHeight: 30, flexShrink: 0 },
  scoreX: { color: colors.blue, fontSize: 30, fontWeight: "900" },
  scoreMax: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  scoreTrack: {
    height: 9,
    overflow: "hidden",
    borderRadius: 5,
    backgroundColor: "#e7ebf2",
    marginTop: 16,
  },
  scoreFill: {
    height: "100%",
    borderRadius: 5,
    backgroundColor: "#55aab1",
  },
  scoreHint: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  roadmapSection: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 30,
    paddingBottom: 12,
    backgroundColor: colors.background,
  },
  timeline: {
    position: "relative",
    gap: 0,
    paddingLeft: 44,
  },
  timelineLine: {
    position: "absolute",
    top: 18,
    bottom: 18,
    left: 22,
    width: 2,
    borderRadius: 1,
    backgroundColor: "#dbe3ef",
  },
  timelineItem: {
    position: "relative",
    paddingBottom: 28,
  },
  timelineItemLast: {
    paddingBottom: 4,
  },
  statusIcon: {
    position: "absolute",
    left: -40,
    top: 20,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.background,
    backgroundColor: colors.blue,
  },
  statusIconCompleted: { backgroundColor: colors.green },
  statusIconLocked: { backgroundColor: "#eef0f3" },
  nodeCard: {
    minHeight: 112,
    borderRadius: 14,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: "#243b63",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  nodeCardActive: {
    borderColor: colors.blue,
    borderWidth: 1.5,
    backgroundColor: "#fbfdff",
  },
  nodeCardLocked: {
    backgroundColor: "#f3f4f6",
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaBadge: {
    position: "absolute",
    top: -13,
    left: 18,
    minHeight: 26,
    borderRadius: 13,
    backgroundColor: colors.blue,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
  },
  ctaBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  nodeCopy: { flex: 1 },
  nodeTitle: { color: colors.text, fontSize: 20, fontWeight: "900", lineHeight: 26 },
  nodeTitleLocked: { color: "#8b8d96" },
  nodeMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  nodeBadge: {
    borderRadius: 6,
    backgroundColor: "#eaf1ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  nodeBadgeCompleted: { backgroundColor: "#e4f6ed" },
  nodeBadgeLocked: { backgroundColor: "#e4e7ec" },
  nodeBadgeText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  nodeBadgeTextCompleted: { color: colors.green },
  nodeBadgeTextLocked: { color: "#7a8291" },
  nodeMeta: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  nodeMetaLocked: { color: "#8b8d96" },
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
