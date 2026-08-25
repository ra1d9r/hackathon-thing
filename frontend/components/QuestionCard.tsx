import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { AnswerPayload, QuestionView } from "@/hooks/useAttempt";

interface QuestionCardProps {
  question: QuestionView;
  answer: AnswerPayload | undefined;
  onChange: (answer: AnswerPayload) => void;
}

function plainText(md: string): string {
  return md.replace(/[#*_>`]/g, "").trim();
}

export function QuestionCard({ question, answer, onChange }: QuestionCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.subject}>{question.subject.name} · {question.topic.title}</Text>
      <Text style={styles.prompt}>{plainText(question.prompt_md)}</Text>

      {question.kind === "mcq_single" ? (
        <SingleChoice question={question} answer={answer} onChange={onChange} />
      ) : null}
      {question.kind === "mcq_multi" ? (
        <MultiChoice question={question} answer={answer} onChange={onChange} />
      ) : null}
      {question.kind === "numeric" ? (
        <NumericInput answer={answer} onChange={onChange} />
      ) : null}
      {question.kind === "free_text" ? (
        <FreeTextInput answer={answer} onChange={onChange} maxChars={question.max_chars} />
      ) : null}
    </View>
  );
}

function SingleChoice({ question, answer, onChange }: QuestionCardProps) {
  const selected = answer?.selected?.[0];
  return (
    <View style={styles.optionList}>
      {(question.options ?? []).map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === option.id }}
          onPress={() => onChange({ selected: [option.id] })}
          style={({ pressed }) => [styles.option, selected === option.id && styles.optionSelected, pressed && styles.pressed]}
        >
          <View style={[styles.radio, selected === option.id && styles.radioSelected]}>
            {selected === option.id ? <View style={styles.radioInner} /> : null}
          </View>
          <Text style={[styles.optionText, selected === option.id && styles.optionTextSelected]}>
            {plainText(option.text_md)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function MultiChoice({ question, answer, onChange }: QuestionCardProps) {
  const selected = new Set(answer?.selected ?? []);
  const toggle = (optionId: string) => {
    const next = new Set(selected);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    onChange({ selected: Array.from(next) });
  };

  return (
    <View style={styles.optionList}>
      {(question.options ?? []).map((option) => {
        const isSelected = selected.has(option.id);
        return (
          <Pressable
            key={option.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            onPress={() => toggle(option.id)}
            style={({ pressed }) => [styles.option, isSelected && styles.optionSelected, pressed && styles.pressed]}
          >
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{plainText(option.text_md)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NumericInput({ answer, onChange }: Pick<QuestionCardProps, "answer" | "onChange">) {
  return (
    <TextInput
      value={answer?.value !== undefined ? String(answer.value) : ""}
      onChangeText={(text) => {
        const normalized = text.replace(",", ".");
        const value = Number(normalized);
        if (normalized === "" || Number.isNaN(value)) {
          onChange({});
          return;
        }
        onChange({ value });
      }}
      keyboardType="numeric"
      placeholder="Введите число"
      style={styles.numericInput}
    />
  );
}

function FreeTextInput({
  answer,
  onChange,
  maxChars,
}: Pick<QuestionCardProps, "answer" | "onChange"> & { maxChars: number | null }) {
  return (
    <TextInput
      value={answer?.text ?? ""}
      onChangeText={(text) => onChange({ text })}
      placeholder="Развёрнутый ответ..."
      multiline
      numberOfLines={5}
      maxLength={maxChars ?? undefined}
      style={styles.freeTextInput}
    />
  );
}

const colors = {
  card: "#ffffff",
  text: "#101828",
  muted: "#667085",
  border: "#c5cede",
  blue: "#0057d9",
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 18,
    gap: 12,
  },
  subject: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  prompt: { color: colors.text, fontSize: 18, fontWeight: "700", lineHeight: 25 },
  optionList: { gap: 10, marginTop: 6 },
  option: {
    minHeight: 52,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
  },
  optionSelected: { borderColor: colors.blue, backgroundColor: "#f6f9ff" },
  optionText: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  optionTextSelected: { color: colors.blue },
  radio: { width: 22, height: 22, borderRadius: 11, borderColor: colors.border, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.blue },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderColor: colors.border, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  checkboxSelected: { borderColor: colors.blue, backgroundColor: colors.blue },
  checkMark: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  numericInput: {
    minHeight: 52,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    fontSize: 18,
    color: colors.text,
  },
  freeTextInput: {
    minHeight: 120,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    textAlignVertical: "top",
  },
  pressed: { opacity: 0.8 },
});
