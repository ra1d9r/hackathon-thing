import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";

const answers = [
  "12",
  "18",
  "24",
  "36"
];

const targetLabels = {
  ENT: "ЕНТ",
  NIS: "НИШ",
  SUBJECTS: "Школьные предметы",
  OLYMPIAD: "Олимпиада"
} as const;

export function DiagnosticTestScreen() {
  const target = useOnboardingStore((state) => state.target);
  const selectedSubjects = useOnboardingStore((state) => state.selectedSubjects);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  const subjectSummary = useMemo(() => {
    if (selectedSubjects.length === 0) {
      return "Индивидуальная диагностика";
    }

    return selectedSubjects.slice(0, 3).join(", ") + (selectedSubjects.length > 3 ? ` +${selectedSubjects.length - 3}` : "");
  }, [selectedSubjects]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>EduPrep</Text>
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
              <Text style={styles.statusValue}>{target ? targetLabels[target] : "Не выбрана"}</Text>
              <Text style={styles.statusMeta}>{subjectSummary}</Text>
            </View>
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressText}>Вопрос 1 из 10</Text>
            <Text style={styles.progressText}>10%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>

          <View style={styles.questionCard}>
            <View style={styles.questionIcon}>
              <Ionicons name="help-circle" size={24} color={colors.blue} />
            </View>
            <Text style={styles.questionTitle}>Решите пример</Text>
            <Text style={styles.questionText}>Если 3x + 6 = 60, чему равно значение x?</Text>

            <View style={styles.answerList}>
              {answers.map((answer) => (
                <AnswerOption
                  key={answer}
                  label={answer}
                  selected={selectedAnswer === answer}
                  onPress={() => setSelectedAnswer(answer)}
                />
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <FooterButton icon="chevron-back" label="Previous" onPress={() => router.back()} variant="ghost" />
          <FooterButton
            icon="chevron-forward"
            label="Complete Test"
            onPress={() => router.push(routes.diagnosticResults)}
            disabled={!selectedAnswer}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

interface AnswerOptionProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function AnswerOption({ label, selected, onPress }: AnswerOptionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.answerOption, selected && styles.answerSelected, pressed && styles.pressed]}
    >
      <View style={[styles.answerMarker, selected && styles.answerMarkerSelected]}>
        {selected ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
      </View>
      <Text style={[styles.answerText, selected && styles.answerTextSelected]}>{label}</Text>
    </Pressable>
  );
}

interface FooterButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "ghost";
  disabled?: boolean;
}

function FooterButton({ label, onPress, icon, variant = "primary", disabled = false }: FooterButtonProps) {
  const isGhost = variant === "ghost";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerButton,
        isGhost ? styles.footerButtonGhost : styles.footerButtonPrimary,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      {icon ? <Ionicons name={icon} size={22} color={isGhost ? colors.text : "#ffffff"} /> : null}
      <Text style={[styles.footerButtonText, isGhost ? styles.footerButtonGhostText : styles.footerButtonPrimaryText]}>{label}</Text>
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
  iconBackground: "#ecf2ff"
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
    justifyContent: "center",
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
  scroll: {
    flex: 1
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16
  },
  titleBlock: {
    alignItems: "center",
    marginBottom: 28,
    paddingHorizontal: 8
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31,
    textAlign: "center"
  },
  subtitle: {
    maxWidth: 326,
    marginTop: 8,
    color: colors.muted,
    fontSize: 17,
    lineHeight: 25,
    textAlign: "center"
  },
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
    marginBottom: 20
  },
  statusIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: colors.iconBackground
  },
  statusCopy: {
    flex: 1
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  statusValue: {
    marginTop: 2,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26
  },
  statusMeta: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8
  },
  progressText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  progressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "#e9edf5",
    marginBottom: 24
  },
  progressFill: {
    width: "10%",
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.blue
  },
  questionCard: {
    width: "100%",
    minHeight: 424,
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 22
  },
  questionIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: colors.iconBackground,
    marginBottom: 18
  },
  questionTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 28
  },
  questionText: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 17,
    lineHeight: 25
  },
  answerList: {
    marginTop: 24,
    gap: 12
  },
  answerOption: {
    minHeight: 54,
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14
  },
  answerSelected: {
    borderColor: colors.blue,
    backgroundColor: "#f6f9ff"
  },
  answerMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center"
  },
  answerMarkerSelected: {
    borderColor: colors.blue,
    backgroundColor: colors.blue
  },
  answerText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  answerTextSelected: {
    color: colors.blue
  },
  footer: {
    minHeight: 80,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.background,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 10
  },
  footerButton: {
    minHeight: 42,
    minWidth: 92,
    borderRadius: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4
  },
  footerButtonPrimary: {
    backgroundColor: colors.navy,
    paddingHorizontal: 18
  },
  footerButtonGhost: {
    backgroundColor: "transparent",
    minWidth: 80,
    paddingHorizontal: 0
  },
  footerButtonText: {
    fontSize: 12,
    fontWeight: "800"
  },
  footerButtonPrimaryText: {
    color: "#ffffff"
  },
  footerButtonGhostText: {
    color: colors.text
  },
  pressed: {
    opacity: 0.78
  },
  disabled: {
    opacity: 0.48
  }
});
