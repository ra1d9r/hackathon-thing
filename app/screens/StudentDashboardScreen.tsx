import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";

const tasks = [
  {
    title: "Тригонометрия",
    meta: "30 мин • 15 вопросов",
    subject: "Математика",
    done: false
  },
  {
    title: "Абылай Хан\nSet 4",
    meta: "45 мин • 2 страницы",
    subject: "История Казахстана",
    done: false
  },
  {
    title: "Код на python",
    meta: "15 мин",
    subject: null,
    done: true
  }
];

const targetLabels = {
  ENT: "ЕНТ",
  NIS: "НИШ",
  SUBJECTS: "Предметы",
  OLYMPIAD: "Олимпиада"
} as const;

export function StudentDashboardScreen() {
  const target = useOnboardingStore((state) => state.target);
  const selectedSubjects = useOnboardingStore((state) => state.selectedSubjects);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.logo}>EduPrep</Text>
          <Pressable
            accessibilityLabel="Open personal account"
            accessibilityRole="button"
            onPress={() => router.push(routes.personalAccount)}
            style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
          >
            <Image
              source={{ uri: "https://i.pravatar.cc/96?img=12" }}
              style={styles.avatar}
            />
          </Pressable>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalTop}>
            <View>
              <Text style={styles.kicker}>ЦЕЛЬ</Text>
              <Text style={styles.goalValue}>{target ? targetLabels[target] : "ЕНТ"}</Text>
            </View>
            <View style={styles.daysBlock}>
              <Text style={styles.kicker}>ОСТАЛОСЬ</Text>
              <Text style={styles.daysValue}>14 дней</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.scoreRow}>
            <View>
              <Text style={styles.scoreLabel}>Ориентировочный балл</Text>
              <Text style={styles.scoreValue}>
                100 <Text style={styles.scoreTotal}>/ 140</Text>
              </Text>
            </View>
            <View style={styles.smallProgressTrack}>
              <View style={styles.smallProgressFill} />
            </View>
          </View>
          {selectedSubjects.length > 0 ? (
            <Text style={styles.subjectHint} numberOfLines={1}>
              {selectedSubjects.join(", ")}
            </Text>
          ) : null}
        </View>

        <View style={styles.focusCard}>
          <View style={styles.focusHeader}>
            <Ionicons name="radio-button-on-outline" size={22} color={colors.text} />
            <Text style={styles.focusTitle}>Сегодняшний фокус</Text>
          </View>
          <View style={styles.taskList}>
            {tasks.map((task) => (
              <TaskCard key={task.title} {...task} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

interface TaskCardProps {
  title: string;
  meta: string;
  subject: string | null;
  done: boolean;
}

function TaskCard({ title, meta, subject, done }: TaskCardProps) {
  return (
    <View style={[styles.taskCard, done && styles.taskCardDone]}>
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
    </View>
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
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    paddingBottom: 28
  },
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
  logo: {
    color: colors.blue,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29
  },
  avatarButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff"
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderColor: "#ffffff",
    borderWidth: 2
  },
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
  goalTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between"
  },
  kicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
    lineHeight: 16
  },
  goalValue: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 27
  },
  daysBlock: {
    alignItems: "flex-end"
  },
  daysValue: {
    color: colors.orange,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 27
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: 16,
    marginBottom: 15
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20
  },
  scoreLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.35,
    lineHeight: 16
  },
  scoreValue: {
    color: colors.teal,
    fontSize: 24,
    fontWeight: "500",
    lineHeight: 30
  },
  scoreTotal: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "500"
  },
  smallProgressTrack: {
    width: 96,
    height: 8,
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "#dadada"
  },
  smallProgressFill: {
    width: "84%",
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.teal
  },
  subjectHint: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16
  },
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
  focusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16
  },
  focusTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 28
  },
  taskList: {
    gap: 12
  },
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
  taskCardDone: {
    opacity: 0.58
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 2,
    borderColor: "#9aa3b4",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4
  },
  checkBoxDone: {
    borderColor: "#9a9a9a",
    backgroundColor: "#9a9a9a"
  },
  taskCopy: {
    flex: 1,
    paddingLeft: 12,
    paddingRight: 8
  },
  taskTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 24
  },
  taskTitleDone: {
    color: "#777777",
    textDecorationLine: "line-through"
  },
  taskMeta: {
    marginTop: 8,
    color: "#6b6b6b",
    fontSize: 15,
    lineHeight: 20
  },
  taskMetaDone: {
    color: "#777777"
  },
  subjectBadge: {
    maxWidth: 132,
    borderRadius: 3,
    backgroundColor: "#e9e7e7",
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  subjectBadgeText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  pressed: {
    opacity: 0.76
  }
});
