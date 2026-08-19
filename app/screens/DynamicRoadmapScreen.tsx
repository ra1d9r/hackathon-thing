import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";
import { useState } from "react";

type SubjectKey = "mathLiteracy" | "history" | "physics" | "math";

interface RoadmapTask {
  id: string;
  title: string;
  englishTitle: string;
  points: string;
  duration: string;
}

const avatarUrl = "https://i.pravatar.cc/96?img=12";

const subjectChips: Array<{ key: SubjectKey; label: string; predicted: string }> = [
  { key: "mathLiteracy", label: "Матем. грамотность", predicted: "X / X баллов" },
  { key: "history", label: "История Казахстана", predicted: "X / X баллов" },
  { key: "physics", label: "Физика", predicted: "X / X баллов" },
  { key: "math", label: "Математика", predicted: "X / X баллов" }
];

const activeTask: RoadmapTask = {
  id: "trigonometry",
  title: "Тригонометрия",
  englishTitle: "Trigonometric Functions",
  points: "~4-6 points on UNT",
  duration: "20 mins expected"
};

const lessonTopics = [
  { icon: "play-circle-outline" as const, title: "1. Intro to Unit Circle", meta: "Video • 5 mins", locked: false },
  { icon: "document-text-outline" as const, title: "2. Sine & Cosine Identities", meta: "Reading • 10 mins", locked: false },
  { icon: "help-circle-outline" as const, title: "3. Practice Drill", meta: "Quiz • 5 mins", locked: true }
];

export function DynamicRoadmapScreen() {
  const selectedSubjects = useOnboardingStore((state) => state.selectedSubjects);
  const [activeSubject, setActiveSubject] = useState<SubjectKey>("mathLiteracy");
  const [selectedTask, setSelectedTask] = useState<RoadmapTask | null>(null);
  const activeChip = subjectChips.find((chip) => chip.key === activeSubject) ?? subjectChips[0];

  const visibleChips =
    selectedSubjects.length > 0
      ? [
          ...subjectChips,
          ...selectedSubjects.slice(0, 2).map((subject, index) => ({
            key: `custom-${index}` as SubjectKey,
            label: subject,
            predicted: "X / X баллов"
          }))
        ]
      : subjectChips;

  const startTask = () => {
    setSelectedTask(null);
    router.push(routes.taskExecutionWorkspace);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>EduPrep</Text>
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {visibleChips.map((chip) => (
              <Pressable
                key={`${chip.key}-${chip.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected: activeSubject === chip.key }}
                onPress={() => setActiveSubject(chip.key)}
                style={({ pressed }) => [styles.chip, activeSubject === chip.key && styles.chipActive, pressed && styles.pressed]}
              >
                <Text style={[styles.chipText, activeSubject === chip.key && styles.chipTextActive]}>{chip.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>PREDICTED SCORE</Text>
            <Text style={styles.scoreValue}>
              <Text style={styles.scoreX}>{activeChip.predicted.split(" ")[0]}</Text> / X баллов
            </Text>
          </View>

          <View style={styles.roadmap}>
            <View style={styles.verticalLine} />
            <CompletedNode />
            <PlayNode />
            <ActiveNode onPress={() => setSelectedTask(activeTask)} />
            <BranchNode />
            <LockedNode />
          </View>
        </ScrollView>

        <TaskSheet task={selectedTask} onClose={() => setSelectedTask(null)} onStart={startTask} />
      </View>
    </SafeAreaView>
  );
}

function CompletedNode() {
  return (
    <View style={styles.nodeSection}>
      <View style={styles.completedCircle}>
        <Ionicons name="checkmark" size={28} color="#ffffff" />
      </View>
      <View style={styles.completedCard}>
        <Text style={styles.completedTitle}>Квадратные уравнения</Text>
        <View style={styles.masteryBadge}>
          <Ionicons name="checkmark-circle-outline" size={12} color="#10a957" />
          <Text style={styles.masteryText}>100% Выполнено</Text>
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

function ActiveNode({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.activeCardWrap, pressed && styles.pressed]}>
      <View style={styles.startBadge}>
        <Text style={styles.startBadgeText}>Начни задание</Text>
        <Ionicons name="arrow-forward" size={12} color="#ffffff" />
      </View>
      <View style={styles.activeCard}>
        <Text style={styles.activeTitle}>Тригонометрия</Text>
        <View style={styles.durationBadge}>
          <Ionicons name="timer-outline" size={12} color="#c84b16" />
          <Text style={styles.durationText}>15 минут</Text>
        </View>
      </View>
    </Pressable>
  );
}

function BranchNode() {
  return (
    <View style={styles.branchSection}>
      <View style={styles.branchLine} />
      <View style={styles.branchCard}>
        <View style={styles.branchIcon}>
          <Ionicons name="hardware-chip-outline" size={16} color="#68707f" />
        </View>
        <Text style={styles.branchText}>Физика{"\n"}Основа</Text>
      </View>
    </View>
  );
}

function LockedNode() {
  return (
    <View style={styles.lockedSection}>
      <View style={styles.lockCircle}>
        <Ionicons name="lock-closed-outline" size={17} color="#7b808c" />
      </View>
      <View style={styles.lockedCard}>
        <Text style={styles.lockedText}>Логарифмы</Text>
      </View>
    </View>
  );
}

interface TaskSheetProps {
  task: RoadmapTask | null;
  onClose: () => void;
  onStart: () => void;
}

function TaskSheet({ task, onClose, onStart }: TaskSheetProps) {
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
          <Text style={styles.sheetTitle}>{task?.englishTitle ?? "Trigonometric Functions"}</Text>
          <View style={styles.timeRow}>
            <Ionicons name="time-outline" size={15} color="#4f5362" />
            <Text style={styles.timeText}>{task?.duration ?? "20 mins expected"}</Text>
          </View>

          <View style={styles.sheetDivider} />
          <Text style={styles.lessonLabel}>LESSON TOPICS</Text>
          <View style={styles.lessonList}>
            {lessonTopics.map((topic) => (
              <View key={topic.title} style={styles.lessonItem}>
                <Ionicons name={topic.icon} size={24} color={topic.locked ? "#4f5362" : "#0057d9"} />
                <View style={styles.lessonCopy}>
                  <Text style={styles.lessonTitle}>{topic.title}</Text>
                  <Text style={styles.lessonMeta}>{topic.meta}</Text>
                </View>
                {topic.locked ? <Ionicons name="lock-closed-outline" size={22} color="#c5cede" /> : null}
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
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  root: {
    flex: 1,
    backgroundColor: colors.background
  },
  header: {
    height: 63,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#e1e4ea",
    borderBottomWidth: 1,
    paddingHorizontal: 16
  },
  logo: {
    color: colors.blue,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderColor: "#ffffff",
    borderWidth: 2
  },
  scroll: {
    flex: 1
  },
  content: {
    paddingBottom: 16
  },
  chipRow: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 17,
    paddingBottom: 20
  },
  chip: {
    height: 32,
    minWidth: 168,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 16
  },
  chipActive: {
    borderColor: "#1765ff",
    borderWidth: 2,
    backgroundColor: colors.navy
  },
  chipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17
  },
  chipTextActive: {
    color: "#ffffff"
  },
  scoreCard: {
    minHeight: 78,
    marginHorizontal: 17,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    justifyContent: "center",
    paddingHorizontal: 16,
    marginBottom: 32
  },
  scoreLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    lineHeight: 16
  },
  scoreValue: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 25
  },
  scoreX: {
    color: colors.blue,
    fontSize: 24,
    fontWeight: "900"
  },
  roadmap: {
    minHeight: 806,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    alignItems: "center",
    paddingTop: 50,
    position: "relative"
  },
  verticalLine: {
    position: "absolute",
    top: 40,
    bottom: 16,
    left: "50%",
    width: 2,
    marginLeft: -1,
    backgroundColor: "#e0e5ee"
  },
  nodeSection: {
    width: "100%",
    alignItems: "center"
  },
  completedCircle: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  completedCard: {
    width: "61%",
    minWidth: 238,
    maxWidth: 270,
    minHeight: 80,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    marginTop: 10
  },
  completedTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26,
    textAlign: "center"
  },
  masteryBadge: {
    marginTop: 10,
    borderRadius: 2,
    backgroundColor: "#e4f8eb",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  masteryText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: "800"
  },
  playSection: {
    alignItems: "center",
    marginTop: 68
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderColor: "#ffffff",
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2c73ee",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3
  },
  activeCardWrap: {
    width: "100%",
    alignItems: "center",
    marginTop: 8
  },
  startBadge: {
    height: 20,
    minWidth: 144,
    borderRadius: 10,
    backgroundColor: colors.blue,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    marginBottom: -10,
    zIndex: 2
  },
  startBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    lineHeight: 14
  },
  activeCard: {
    width: "67%",
    minWidth: 260,
    maxWidth: 300,
    minHeight: 110,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    borderColor: "#1765ff",
    borderWidth: 1.5,
    backgroundColor: colors.card
  },
  activeTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 28,
    textAlign: "center"
  },
  durationBadge: {
    marginTop: 12,
    borderRadius: 2,
    backgroundColor: "#fde5d7",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  durationText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: "800"
  },
  branchSection: {
    width: "100%",
    minHeight: 124,
    alignItems: "center",
    marginTop: 54
  },
  branchLine: {
    position: "absolute",
    top: 31,
    left: "53%",
    width: "8%",
    height: 2,
    backgroundColor: colors.border
  },
  branchCard: {
    position: "absolute",
    top: 7,
    right: "8%",
    minWidth: 106,
    minHeight: 50,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#f7f6f6",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10
  },
  branchIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e1e2e5"
  },
  branchText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15
  },
  lockedSection: {
    width: "100%",
    alignItems: "center",
    marginTop: 2
  },
  lockCircle: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ececec"
  },
  lockedCard: {
    width: "52%",
    minWidth: 200,
    maxWidth: 240,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#fbfbfb",
    marginTop: 9
  },
  lockedText: {
    color: "#8b8d96",
    fontSize: 16,
    lineHeight: 22
  },
  modalLayer: {
    flex: 1,
    justifyContent: "flex-end"
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)"
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: colors.card,
    paddingHorizontal: 36,
    paddingTop: 16,
    paddingBottom: 24
  },
  dragHandle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    backgroundColor: colors.border,
    marginBottom: 16
  },
  closeButton: {
    position: "absolute",
    right: 22,
    top: 44,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2
  },
  pointsBadge: {
    alignSelf: "flex-start",
    borderRadius: 2,
    backgroundColor: "#e9f1ff",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  pointsText: {
    color: colors.blue,
    fontSize: 12,
    lineHeight: 15
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 33,
    marginTop: 10,
    paddingRight: 42
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6
  },
  timeText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 20
  },
  sheetDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: -36,
    marginTop: 16,
    marginBottom: 16
  },
  lessonLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.45,
    lineHeight: 16
  },
  lessonList: {
    overflow: "hidden",
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    marginTop: 8
  },
  lessonItem: {
    minHeight: 68,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 12
  },
  lessonCopy: {
    flex: 1
  },
  lessonTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22
  },
  lessonMeta: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 14
  },
  sheetButton: {
    minHeight: 52,
    borderRadius: 7,
    backgroundColor: colors.navy,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 48
  },
  sheetButtonText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26
  },
  pressed: {
    opacity: 0.76
  }
});
