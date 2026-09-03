import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DEFAULT_GRADE, SELECTABLE_GRADES } from "@/constants/grades";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";
import { errorText } from "@/services/errors";

export function RegisterScreen() {
  const register = useAuthStore((state) => state.register);
  const isBusy = useAuthStore((state) => state.isBusy);
  const params = useLocalSearchParams<{ role?: string; email?: string }>();

  const isTeacher = params.role === "teacher";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(params.email ?? "");
  const [password, setPassword] = useState("");
  const [grade, setGrade] = useState(DEFAULT_GRADE);
  const [localError, setLocalError] = useState<string | null>(null);

  const canSubmit =
    displayName.trim().length > 0 && email.trim().length > 3 && password.length >= 8 && !isBusy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLocalError(null);
    try {
      await register({
        email: email.trim().toLowerCase(),
        password,
        display_name: displayName.trim(),
        role: isTeacher ? "teacher" : "student",

        ...(isTeacher ? {} : { grade }),
      });
      router.replace(isTeacher ? routes.teacherRoot : routes.usersTargetChoose);
    } catch (error) {
      setLocalError(errorText(error, "Не удалось зарегистрироваться"));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>Tlek</Text>
          <Text style={styles.title}>Регистрация</Text>
          <Text style={styles.subtitle}>
            {isTeacher
              ? "Аккаунт учителя. Регистрация доступна по одобренной заявке организации."
              : "Создайте аккаунт ученика, чтобы начать подготовку."}
          </Text>

          <View style={styles.form}>
            <Field label="Имя">
              <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Айгерим" style={styles.input} />
            </Field>
            <Field label="Email">
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                style={styles.input}
              />
            </Field>
            <Field label="Пароль">
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                placeholder="Не менее 8 символов"
                style={styles.input}
              />
            </Field>
            {isTeacher ? null : (
            <Field label="Класс">
              <View style={styles.gradeRow}>
                {SELECTABLE_GRADES.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: grade === value }}
                    onPress={() => setGrade(value)}
                    style={[styles.gradeChip, grade === value && styles.gradeChipActive]}
                  >
                    <Text style={[styles.gradeChipText, grade === value && styles.gradeChipTextActive]}>{value}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            )}

            {localError ? <Text style={styles.error}>{localError}</Text> : null}

            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={({ pressed }) => [styles.button, (!canSubmit || pressed) && styles.buttonDisabled]}
            >
              {isBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Зарегистрироваться</Text>}
            </Pressable>

            <Pressable accessibilityRole="button" onPress={() => router.push(routes.login)}>
              <Text style={styles.link}>Уже есть аккаунт? Войти</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const colors = {
  background: "#fbfaf9",
  text: "#222326",
  muted: "#536382",
  border: "#c7d0e0",
  blue: "#0057d9",
  navy: "#274779",
  danger: "#c31717",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40 },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900" },
  title: { marginTop: 32, color: colors.text, fontSize: 30, fontWeight: "900" },
  subtitle: { marginTop: 8, color: colors.muted, fontSize: 16, lineHeight: 22 },
  form: { marginTop: 32, gap: 18 },
  field: { gap: 8 },
  fieldLabel: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
  },
  gradeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  gradeChip: {
    minWidth: 44,
    minHeight: 40,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  gradeChipActive: { borderColor: colors.blue, backgroundColor: "#eef4ff" },
  gradeChipText: { color: colors.text, fontSize: 15, fontWeight: "800" },
  gradeChipTextActive: { color: colors.blue },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 50,
    borderRadius: 8,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  link: { marginTop: 4, color: colors.blue, fontSize: 14, fontWeight: "700", textAlign: "center" },
});
