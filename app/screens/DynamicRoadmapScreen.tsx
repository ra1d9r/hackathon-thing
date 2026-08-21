import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLessonWorkspace, useRoadmap, useUserProfile } from "@/hooks/useData";
import { subjectGroups } from "@/services/mockData";
import type { LessonMaterial, RoadmapNode, Subject } from "@/types/app";
import { routes } from "@/types/navigation";

interface RoadmapTask {
  id: string;
  title: string;
  points: string;
  duration: string;
  topics: LessonMaterial["topics"];
}

const fallbackAvatarUrl = "https://i.pravatar.cc/96?img=12";

export function DynamicRoadmapScreen() {
  const { user, isLoading: isUserLoading } = useUserProfile();
  const subjects = user?.selectedSubjects.length ? user.selectedSubjects : subjectGroups.ENT_MANDATORY;
  const [activeSubjectId, setActiveSubjectId] = useState(subjects[0]?.id ?? "math-literacy");
  const { nodes, currentScore, isLoading: isRoadmapLoading, error } = useRoadmap(activeSubjectId);
  const { material } = useLessonWorkspace("quadratic");
  const [selectedTask, setSelectedTask] = useState<RoadmapTask | null>(null);

  const completedNode = nodes.find((node) => node.status === "COMPLETED");
  const activeNode = nodes.find((node) => node.status === "ACTIVE" && node.subjectId === activeSubjectId) ?? nodes.find((node) => node.status === "ACTIVE");
  const branchNode = nodes.find((node) => node.subjectId !== activeSubjectId && node.status !== "LOCKED");
  const lockedNode = nodes.find((node) => node.status === "LOCKED");

  const openTask = (node?: RoadmapNode) => {
    if (!node || node.status === "LOCKED") return;
    setSelectedTask({
      id: node.id,
      title: node.title,
      points: `~${Math.max(4, Math.round((node.masteryPercentage || 45) / 10))}-6 points on UNT`,
      duration: "20 mins expected",
      topics: material?.topics ?? []
    });
  };

  const startTask = () => {
    setSelectedTask(null);
    router.push(routes.taskExecutionWorkspace);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>EduPrep</Text>
          <Image source={{ uri: user?.avatarUrl ?? fallbackAvatarUrl }} style={styles.avatar} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <SubjectChips subjects={subjects} activeSubjectId={activeSubjectId} onChange={setActiveSubjectId} />

          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>PREDICTED SCORE</Text>
            <Text style={styles.scoreValue}>
              <Text style={styles.scoreX}>{currentScore || "X"}</Text> / 140 баллов
            </Text>
          </View>

          <View style={styles.roadmap}>
            <View style={styles.verticalLine} />
            {isUserLoading || isRoadmapLoading ? <ActivityIndicator color={colors.blue} /> : null}
            {error ? <Text style={styles.emptyText}>{error}</Text> : null}
            {!isRoadmapLoading && !error && nodes.length === 0 ? <Text style={styles.emptyText}>Roadmap пока пуст.</Text> : null}
            <CompletedNode node={completedNode} />
            <PlayNode />
            <ActiveNode node={activeNode} onPress={() => openTask(activeNode)} />
            <BranchNode node={branchNode} />
            <LockedNode node={lockedNode} />
          </View>
        </ScrollView>

        <TaskSheet task={selectedTask} onClose={() => setSelectedTask(null)} onStart={startTask} />
      </View>
    </SafeAreaView>
  );
}

function SubjectChips({ subjects, activeSubjectId, onChange }: { subjects: Subject[]; activeSubjectId: string; onChange: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {subjects.map((subject) => (
        <Pressable
          key={subject.id}
          accessibilityRole="button"
          accessibilityState={{ selected: activeSubjectId === subject.id }}
          onPress={() => onChange(subject.id)}
          style={({ pressed }) => [styles.chip, activeSubjectId === subject.id && styles.chipActive, pressed && styles.pressed]}
        >
          <Text style={[styles.chipText, activeSubjectId === subject.id && styles.chipTextActive]} numberOfLines={1}>
            {subject.title}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function CompletedNode({ node }: { node?: RoadmapNode }) {
  return (
    <View style={styles.nodeSection}>
      <View style={styles.completedCircle}>
        <Ionicons name="checkmark" size={28} color="#ffffff" />
      </View>
      <View style={styles.completedCard}>
        <Text style={styles.completedTitle}>{node?.title ?? "Квадратные уравнения"}</Text>
        <View style={styles.masteryBadge}>
          <Ionicons name="checkmark-circle-outline" size={12} color="#10a957" />
          <Text style={styles.masteryText}>{node?.badgeText ?? `${node?.masteryPercentage ?? 100}% Выполнено`}</Text>
        </View>
      </View>
    </View>
  );
}

function PlayNode() {
  return (
    <View style={styles.playSection}>
      <View style={styles.playButton}>
        <Ionicons name="play" size={31} color="#ffffff" />
      </View>
    </View>
  );
}

function ActiveNode({ node, onPress }: { node?: RoadmapNode; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.activeCardWrap, pressed && styles.pressed]}>
      <View style={styles.startBadge}>
        <Text style={styles.startBadgeText}>{node?.badgeText ?? "Начни задание"}</Text>
        <Ionicons name="arrow-forward" size={12} color="#ffffff" />
      </View>
      <View style={styles.activeCard}>
        <Text style={styles.activeTitle}>{node?.title ?? "Тригонометрия"}</Text>
        <View style={styles.durationBadge}>
          <Ionicons name="timer-outline" size={12} color="#c84b16" />
          <Text style={styles.durationText}>15 минут</Text>
        </View>
      </View>
    </Pressable>
  );
}

function BranchNode({ node }: { node?: RoadmapNode }) {
  return (
    <View style={styles.branchSection}>
      <View style={styles.branchLine} />
      <View style={styles.branchCard}>
        <View style={styles.branchIcon}>
          <Ionicons name="hardware-chip-outline" size={16} color="#68707f" />
        </View>
        <Text style={styles.branchText}>{node?.title ?? "Физика\nОснова"}</Text>
      </View>
    </View>
  );
}

function LockedNode({ node }: { node?: RoadmapNode }) {
  return (
    <View style={styles.lockedSection}>
      <View style={styles.lockCircle}>
        <Ionicons name="lock-closed-outline" size={17} color="#7b808c" />
      </View>
      <View style={styles.lockedCard}>
        <Text style={styles.lockedText}>{node?.title ?? "Логарифмы"}</Text>
      </View>
    </View>
  );
}

function TaskSheet({ task, onClose, onStart }: { task: RoadmapTask | null; onClose: () => void; onStart: () => void }) {
  return (
    <Modal visible={Boolean(task)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalLayer}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />
          <Pressable accessibilityLabel="Close task details" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color="#4b5060" />
          </Pressable>

          <View style={styles.pointsBadge}>
            <Ionicons name="flame-outline" size={13} color="#0057d9" />
            <Text style={styles.pointsText}>Worth {task?.points ?? "~4-6 points on UNT"}</Text>
          </View>
          <Text style={styles.sheetTitle}>{task?.title ?? "Trigonometric Functions"}</Text>
          <View style={styles.timeRow}>
            <Ionicons name="time-outline" size={15} color="#4f5362" />
            <Text style={styles.timeText}>{task?.duration ?? "20 mins expected"}</Text>
          </View>

          <View style={styles.sheetDivider} />
          <Text style={styles.lessonLabel}>LESSON TOPICS</Text>
          <View style={styles.lessonList}>
            {(task?.topics ?? []).map((topic) => (
              <View key={topic.id} style={styles.lessonItem}>
                <Ionicons name={topic.type === "video" ? "play-circle-outline" : topic.type === "reading" ? "document-text-outline" : "help-circle-outline"} size={24} color={topic.isLocked ? "#4f5362" : "#0057d9"} />
                <View style={styles.lessonCopy}>
                  <Text style={styles.lessonTitle}>{topic.title}</Text>
                  <Text style={styles.lessonMeta}>{topic.type} • {topic.duration}</Text>
                </View>
                {topic.isLocked ? <Ionicons name="lock-closed-outline" size={22} color="#c5cede" /> : null}
              </View>
            ))}
          </View>

          <Pressable accessibilityRole="button" onPress={onStart} style={({ pressed }) => [styles.sheetButton, pressed && styles.pressed]}>
            <Text style={styles.sheetButtonText}>Start Lesson & Quiz</Text>
            <Ionicons name="arrow-forward" size={22} color="#ffffff" />
          </Pressable>
        </View>
      </View>
    </Modal>
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
  orange: "#c84b16"
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  header: { height: 63, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: "#e1e4ea", borderBottomWidth: 1, paddingHorizontal: 16 },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  avatar: { width: 28, height: 28, borderRadius: 14, borderColor: "#ffffff", borderWidth: 2 },
  scroll: { flex: 1 },
  content: { paddingBottom: 16 },
  chipRow: { gap: 8, paddingHorizontal: 16, paddingTop: 17, paddingBottom: 20 },
  chip: { height: 32, minWidth: 168, alignItems: "center", justifyContent: "center", borderRadius: 12, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, paddingHorizontal: 16 },
  chipActive: { borderColor: "#1765ff", borderWidth: 2, backgroundColor: colors.navy },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 17 },
  chipTextActive: { color: "#ffffff" },
  scoreCard: { minHeight: 78, marginHorizontal: 17, borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, justifyContent: "center", paddingHorizontal: 16, marginBottom: 32 },
  scoreLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.4, lineHeight: 16 },
  scoreValue: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  scoreX: { color: colors.blue, fontSize: 24, fontWeight: "900" },
  roadmap: { minHeight: 806, borderTopColor: colors.border, borderTopWidth: 1, alignItems: "center", paddingTop: 50, position: "relative" },
  verticalLine: { position: "absolute", top: 40, bottom: 16, left: "50%", width: 2, marginLeft: -1, backgroundColor: "#e0e5ee" },
  nodeSection: { width: "100%", alignItems: "center" },
  completedCircle: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.green, elevation: 2 },
  completedCard: { width: "61%", minWidth: 238, maxWidth: 270, minHeight: 80, alignItems: "center", justifyContent: "center", borderRadius: 6, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, marginTop: 10 },
  completedTitle: { color: colors.text, fontSize: 20, fontWeight: "900", lineHeight: 26, textAlign: "center" },
  masteryBadge: { marginTop: 10, borderRadius: 2, backgroundColor: "#e4f8eb", flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3 },
  masteryText: { color: colors.green, fontSize: 12, fontWeight: "800" },
  playSection: { alignItems: "center", marginTop: 68 },
  playButton: { width: 60, height: 60, borderRadius: 8, borderColor: "#ffffff", borderWidth: 4, alignItems: "center", justifyContent: "center", backgroundColor: "#2c73ee", elevation: 3 },
  activeCardWrap: { width: "100%", alignItems: "center", marginTop: 8 },
  startBadge: { height: 20, minWidth: 144, borderRadius: 10, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, marginBottom: -10, zIndex: 2 },
  startBadgeText: { color: "#ffffff", fontSize: 11, lineHeight: 14 },
  activeCard: { width: "67%", minWidth: 260, maxWidth: 300, minHeight: 110, alignItems: "center", justifyContent: "center", borderRadius: 6, borderColor: "#1765ff", borderWidth: 1.5, backgroundColor: colors.card },
  activeTitle: { color: colors.text, fontSize: 21, fontWeight: "900", lineHeight: 28, textAlign: "center" },
  durationBadge: { marginTop: 12, borderRadius: 2, backgroundColor: "#fde5d7", flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3 },
  durationText: { color: colors.orange, fontSize: 12, fontWeight: "800" },
  branchSection: { width: "100%", minHeight: 124, alignItems: "center", marginTop: 54 },
  branchLine: { position: "absolute", top: 31, left: "53%", width: "8%", height: 2, backgroundColor: colors.border },
  branchCard: { position: "absolute", top: 7, right: "8%", minWidth: 106, minHeight: 50, borderRadius: 7, borderColor: colors.border, borderWidth: 1, backgroundColor: "#f7f6f6", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10 },
  branchIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#e1e2e5" },
  branchText: { color: colors.text, fontSize: 12, lineHeight: 15 },
  lockedSection: { width: "100%", alignItems: "center", marginTop: 2 },
  lockCircle: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#ececec" },
  lockedCard: { width: "52%", minWidth: 200, maxWidth: 240, minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 6, borderColor: colors.border, borderWidth: 1, backgroundColor: "#fbfbfb", marginTop: 9 },
  lockedText: { color: "#8b8d96", fontSize: 16, lineHeight: 22 },
  modalLayer: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.22)" },
  sheet: { width: "100%", borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: colors.card, paddingHorizontal: 36, paddingTop: 16, paddingBottom: 24 },
  dragHandle: { width: 48, height: 5, borderRadius: 3, alignSelf: "center", backgroundColor: colors.border, marginBottom: 16 },
  closeButton: { position: "absolute", right: 22, top: 44, width: 36, height: 36, alignItems: "center", justifyContent: "center", zIndex: 2 },
  pointsBadge: { alignSelf: "flex-start", borderRadius: 2, backgroundColor: "#e9f1ff", flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4 },
  pointsText: { color: colors.blue, fontSize: 12, lineHeight: 15 },
  sheetTitle: { color: colors.text, fontSize: 26, fontWeight: "900", lineHeight: 33, marginTop: 10, paddingRight: 42 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  timeText: { color: colors.muted, fontSize: 15, lineHeight: 20 },
  sheetDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: -36, marginTop: 16, marginBottom: 16 },
  lessonLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.45, lineHeight: 16 },
  lessonList: { overflow: "hidden", borderRadius: 7, borderColor: colors.border, borderWidth: 1, marginTop: 8 },
  lessonItem: { minHeight: 68, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  lessonCopy: { flex: 1 },
  lessonTitle: { color: colors.text, fontSize: 16, lineHeight: 22 },
  lessonMeta: { color: colors.text, fontSize: 11, lineHeight: 14 },
  sheetButton: { minHeight: 52, borderRadius: 7, backgroundColor: colors.navy, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 48 },
  sheetButtonText: { color: "#ffffff", fontSize: 20, fontWeight: "900", lineHeight: 26 },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 12 },
  pressed: { opacity: 0.76 }
});
