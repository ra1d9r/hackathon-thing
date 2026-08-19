import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { routes } from "@/types/navigation";

type TaskStatus = "active" | "inProgress" | "completed";

interface LearningTask {
  id: string;
  subject: string;
  duration: string;
  title: string;
  subtitle: string;
  status: TaskStatus;
  progress?: number;
}

const avatarUrl = "https://i.pravatar.cc/96?img=12";

const baseTasks: LearningTask[] = [
  {
    id: "quadratic",
    subject: "МАТЕМАТИКА",
    duration: "15 мин",
    title: "Квадратные уравнения & Дискриминант",
    subtitle: "Изучи формулы и реши задачи",
    status: "active"
  },
  {
    id: "history",
    subject: "ИСТОРИЯ",
    duration: "10 мин",
    title: "Казахское ханство: ключевые даты",
    subtitle: "Повтори события и закрепи факты",
    status: "inProgress",
    progress: 0.5
  },
  {
    id: "reading",
    subject: "ЧТЕНИЕ",
    duration: "8 мин",
    title: "Анализ текста и выводы",
    subtitle: "Тренировка завершена",
    status: "completed"
  }
];

export function DailyTaskHubScreen() {
  const params = useLocalSearchParams<{ completedTask?: string }>();
  const tasks = baseTasks.map((task) =>
    task.id === params.completedTask ? { ...task, status: "completed" as const } : task
  );
  const completedCount = tasks.filter((task) => task.status === "completed").length;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>EduPrep</Text>
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.focusCard}>
            <View style={styles.focusHeader}>
              <View>
                <Text style={styles.focusTitle}>Сегодняшний фокус</Text>
                <Text style={styles.focusDate}>Вторник, авг 18</Text>
              </View>
              <View style={styles.streakPill}>
                <Ionicons name="flame" size={15} color="#c84b16" />
                <Text style={styles.streakText}>X дней подряд</Text>
              </View>
            </View>

            <View style={styles.focusProgressHeader}>
              <Text style={styles.progressCaption}>{completedCount} из {tasks.length} выполнено</Text>
              <Text style={styles.progressCaption}>{Math.round((completedCount / tasks.length) * 100)}%</Text>
            </View>
            <View style={styles.focusProgressTrack}>
              <View style={[styles.focusProgressFill, { width: `${(completedCount / tasks.length) * 100}%` }]} />
            </View>
          </View>

          <View style={styles.taskList}>
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function TaskCard({ task }: { task: LearningTask }) {
  const isCompleted = task.status === "completed";
  const isInProgress = task.status === "inProgress";

  const openTask = () => {
    if (!isCompleted) {
      router.push(routes.taskExecutionWorkspace);
    }
  };

  return (
    <View style={[styles.taskCard, isCompleted && styles.taskCardCompleted]}>
      <View style={styles.taskMetaRow}>
        <View style={[styles.subjectBadge, isCompleted && styles.subjectBadgeCompleted]}>
          <Text style={[styles.subjectBadgeText, isCompleted && styles.subjectBadgeTextCompleted]}>{task.subject}</Text>
        </View>
        <View style={styles.durationPill}>
          <Ionicons name="time-outline" size={13} color="#c84b16" />
          <Text style={styles.durationText}>{task.duration}</Text>
        </View>
      </View>

      <View style={styles.taskBodyRow}>
        <View style={styles.taskCopy}>
          <Text style={[styles.taskTitle, isCompleted && styles.taskTitleCompleted]}>{task.title}</Text>
          <Text style={[styles.taskSubtitle, isCompleted && styles.taskSubtitleCompleted]}>{task.subtitle}</Text>
        </View>
        {isCompleted ? (
          <View style={styles.doneBadge}>
            <Ionicons name="checkmark" size={18} color="#ffffff" />
          </View>
        ) : null}
      </View>

      {isInProgress ? (
        <View style={styles.cardProgressTrack}>
          <View style={[styles.cardProgressFill, { width: `${(task.progress ?? 0) * 100}%` }]} />
        </View>
      ) : null}

      {!isCompleted ? (
        <Pressable
          accessibilityRole="button"
          onPress={openTask}
          style={({ pressed }) => [
            styles.taskButton,
            isInProgress ? styles.secondaryButton : styles.primaryButton,
            pressed && styles.pressed
          ]}
        >
          <Text style={[styles.taskButtonText, isInProgress ? styles.secondaryButtonText : styles.primaryButtonText]}>
            {isInProgress ? "Продолжить" : "Начать"}
          </Text>
          <Ionicons name="arrow-forward" size={15} color={isInProgress ? colors.navy : "#ffffff"} />
        </Pressable>
      ) : null}
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
  green: "#16a34a",
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
    color: "#0057d9",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderColor: "#ffffff",
    borderWidth: 2
  },
  scroll: {
    flex: 1
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 22
  },
  focusCard: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 18
  },
  focusHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14
  },
  focusTitle: {
    color: colors.text,
    fontSize: 23,
    fontWeight: "900",
    lineHeight: 29
  },
  focusDate: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19
  },
  streakPill: {
    minHeight: 30,
    borderRadius: 15,
    backgroundColor: "#fdeee7",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10
  },
  streakText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: "800"
  },
  focusProgressHeader: {
    marginTop: 22,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  progressCaption: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  focusProgressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "#e8e8e8",
    marginTop: 8
  },
  focusProgressFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.blue
  },
  taskList: {
    marginTop: 22,
    gap: 16
  },
  taskCard: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 16
  },
  taskCardCompleted: {
    backgroundColor: "#f2f2f2",
    opacity: 0.78
  },
  taskMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  subjectBadge: {
    borderRadius: 3,
    backgroundColor: "#e9f1ff",
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  subjectBadgeCompleted: {
    backgroundColor: "#e3e3e3"
  },
  subjectBadgeText: {
    color: "#0057d9",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4
  },
  subjectBadgeTextCompleted: {
    color: "#7a7d85"
  },
  durationPill: {
    borderRadius: 3,
    backgroundColor: "#fde5d7",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  durationText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: "800"
  },
  taskBodyRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  taskCopy: {
    flex: 1
  },
  taskTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26
  },
  taskTitleCompleted: {
    color: "#7a7d85",
    textDecorationLine: "line-through"
  },
  taskSubtitle: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21
  },
  taskSubtitleCompleted: {
    color: "#8d9098"
  },
  doneBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green
  },
  cardProgressTrack: {
    height: 7,
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "#e5e5e5",
    marginTop: 16
  },
  cardProgressFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.blue
  },
  taskButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    borderRadius: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 18,
    marginTop: 16
  },
  primaryButton: {
    backgroundColor: colors.navy
  },
  secondaryButton: {
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff"
  },
  taskButtonText: {
    fontSize: 14,
    fontWeight: "900"
  },
  primaryButtonText: {
    color: "#ffffff"
  },
  secondaryButtonText: {
    color: colors.navy
  },
  pressed: {
    opacity: 0.76
  }
});
