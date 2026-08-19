import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useLessonWorkspace } from "@/hooks/useData";

export function TaskExecutionWorkspaceScreen() {
  const insets = useSafeAreaInsets();
  const { material, questions, isLoading, error, submitQuiz } = useLessonWorkspace("quadratic");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [aiOpen, setAiOpen] = useState(false);
  const question = questions[questionIndex];
  const selectedOption = question ? selectedOptions[question.id] : undefined;

  const completeTask = async () => {
    await submitQuiz(selectedOptions);
    router.replace({ pathname: "/(tabs)/learning", params: { completedTask: "quadratic" } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Математика</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: 112 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? <ActivityIndicator color={colors.blue} /> : null}
          {error ? <Text style={styles.emptyText}>{error}</Text> : null}

          {!isLoading && !error ? (
            <>
              <View style={styles.stepper}>
                <View style={[styles.stepBadge, styles.stepBadgeActive]}>
                  <Text style={[styles.stepText, styles.stepTextActive]}>1. Материалы</Text>
                </View>
                <View style={styles.stepLine} />
                <View style={styles.stepBadge}>
                  <Text style={styles.stepText}>2. Проверка знаний</Text>
                </View>
              </View>

              <View style={styles.materialCard}>
                <Text style={styles.cardTitle}>{material?.title ?? "Материал не найден"}</Text>
                {material?.paragraphs.map((paragraph) => (
                  <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>
                ))}

                {material?.formulas?.map((formula) => (
                  <View key={formula} style={styles.formulaBox}>
                    <Text style={styles.formula}>{formula}</Text>
                  </View>
                ))}

                <View style={styles.bullets}>
                  <Bullet text="Δ > 0: уравнение имеет два разных корня." />
                  <Bullet text="Δ = 0: уравнение имеет один корень." />
                  <Bullet text="Δ < 0: действительных корней нет." />
                </View>
              </View>

              <Pressable accessibilityRole="button" onPress={() => setAiOpen(true)} style={({ pressed }) => [styles.aiBanner, pressed && styles.pressed]}>
                <View style={styles.aiIcon}>
                  <Ionicons name="bulb-outline" size={23} color="#c84b16" />
                </View>
                <View style={styles.aiCopy}>
                  <Text style={styles.aiTitle}>Есть вопросы? Спроси AI</Text>
                  <Text style={styles.aiText}>Получите подсказку без готового ответа.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>

              <View style={styles.quizCard}>
                <Text style={styles.cardTitle}>Проверка знаний</Text>
                {question ? (
                  <>
                    <Text style={styles.questionText}>{question.questionText}</Text>
                    <View style={styles.optionsList}>
                      {question.options.map((option) => (
                        <OptionRow
                          key={option.id}
                          label={option.text}
                          selected={selectedOption === option.id}
                          onPress={() => setSelectedOptions((current) => ({ ...current, [question.id]: option.id }))}
                        />
                      ))}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setQuestionIndex((current) => (current + 1) % questions.length)}
                      disabled={!selectedOption}
                      style={({ pressed }) => [styles.nextButton, !selectedOption && styles.disabled, pressed && styles.pressed]}
                    >
                      <Text style={styles.nextButtonText}>Next Question</Text>
                      <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.emptyText}>Вопросы пока не добавлены.</Text>
                )}
              </View>
            </>
          ) : null}
        </ScrollView>

        <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Pressable accessibilityRole="button" onPress={completeTask} style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}>
            <Text style={styles.submitButtonText}>Complete & Submit Task</Text>
          </Pressable>
        </View>

        <AIModal visible={aiOpen} onClose={() => setAiOpen(false)} />
      </View>
    </SafeAreaView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.optionRow, selected && styles.optionRowSelected, pressed && styles.pressed]}>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioInner} /> : null}</View>
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function AIModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalLayer}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.aiSheet}>
          <View style={styles.dragHandle} />
          <View style={styles.aiSheetHeader}>
            <Text style={styles.aiSheetTitle}>AI подсказка</Text>
            <Pressable accessibilityLabel="Close AI assistant" accessibilityRole="button" onPress={onClose}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.aiSheetText}>
            Начни с определения коэффициентов a, b и c. Затем подставь их в формулу Δ = b² - 4ac и сравни результат с нулём.
          </Text>
        </View>
      </View>
    </Modal>
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
  orange: "#c84b16"
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  header: { height: 58, borderBottomColor: "#e1e4ea", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  headerSpacer: { width: 44 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 18, gap: 18 },
  stepper: { flexDirection: "row", alignItems: "center" },
  stepBadge: { minHeight: 34, borderRadius: 17, borderColor: colors.border, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, backgroundColor: colors.card },
  stepBadgeActive: { borderColor: colors.blue, backgroundColor: "#e9f1ff" },
  stepText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  stepTextActive: { color: colors.blue },
  stepLine: { flex: 1, height: 1, backgroundColor: colors.border },
  materialCard: { borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, padding: 18 },
  cardTitle: { color: colors.text, fontSize: 22, fontWeight: "900", lineHeight: 29 },
  paragraph: { marginTop: 12, color: colors.muted, fontSize: 16, lineHeight: 24 },
  formulaBox: { minHeight: 78, borderRadius: 8, borderColor: "#b9cdf8", borderWidth: 1, backgroundColor: "#eef4ff", alignItems: "center", justifyContent: "center", marginTop: 18 },
  formula: { color: colors.navy, fontSize: 28, fontWeight: "900" },
  bullets: { gap: 10, marginTop: 18 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bulletDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blue, marginTop: 8 },
  bulletText: { flex: 1, color: colors.muted, fontSize: 15, lineHeight: 22 },
  aiBanner: { minHeight: 82, borderRadius: 10, borderColor: "#f0d4b8", borderWidth: 1, backgroundColor: "#fff7ed", flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  aiIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#fde5d7" },
  aiCopy: { flex: 1 },
  aiTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  aiText: { marginTop: 3, color: colors.muted, fontSize: 14, lineHeight: 19 },
  quizCard: { borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, padding: 18 },
  questionText: { marginTop: 14, color: colors.text, fontSize: 17, fontWeight: "700", lineHeight: 24 },
  optionsList: { gap: 10, marginTop: 18 },
  optionRow: { minHeight: 52, borderRadius: 8, borderColor: colors.border, borderWidth: 1, backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  optionRowSelected: { borderColor: colors.blue, backgroundColor: "#f6f9ff" },
  radio: { width: 22, height: 22, borderRadius: 11, borderColor: colors.border, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.blue },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  optionText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  optionTextSelected: { color: colors.blue },
  nextButton: { alignSelf: "flex-start", minHeight: 40, borderRadius: 7, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, marginTop: 18 },
  nextButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  stickyBar: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 10 },
  submitButton: { minHeight: 52, borderRadius: 8, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  submitButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  modalLayer: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.22)" },
  aiSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  dragHandle: { width: 48, height: 5, borderRadius: 3, alignSelf: "center", backgroundColor: colors.border, marginBottom: 16 },
  aiSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  aiSheetTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  aiSheetText: { marginTop: 12, color: colors.muted, fontSize: 16, lineHeight: 24 },
  emptyText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.76 }
});
