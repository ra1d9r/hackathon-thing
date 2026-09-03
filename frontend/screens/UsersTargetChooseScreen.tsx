import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuthStore } from "@/store/useAuthStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";
import type { UserTarget } from "@/types/onboarding";

interface TargetOption {
  title: string;
  description: string;
  value: UserTarget;
  icon: keyof typeof Ionicons.glyphMap;
}

const targetOptions: TargetOption[] = [
  {
    title: "Подтянуть знания по выбранным предметам",
    description: "Сфокусируйтесь на улучшении оценок и понимания конкретных школьных дисциплин.",
    value: "SUBJECTS",
    icon: "book-outline"
  },
  {
    title: "Подготовка к ЕНТ",
    description: "Комплексная программа подготовки к Единому национальному тестированию.",
    value: "ENT",
    icon: "school"
  },
  {
    title: "Экзамен в НИШ",
    description: "Специализированная подготовка к вступительным экзаменам в Назарбаев Интеллектуальные школы.",
    value: "NIS",
    icon: "business"
  }
];

export function UsersTargetChooseScreen() {
  const me = useAuthStore((state) => state.me);
  const logout = useAuthStore((state) => state.logout);
  const selectedTarget = useOnboardingStore((state) => state.target);
  const isSavingTarget = useOnboardingStore((state) => state.isSaving);
  const isLoadingSubjects = useOnboardingStore((state) => state.isLoadingSubjects);
  const isSaving = isSavingTarget || isLoadingSubjects;
  const error = useOnboardingStore((state) => state.error);
  const setTarget = useOnboardingStore((state) => state.setTarget);
  const setGrade = useOnboardingStore((state) => state.setGrade);
  const loadSubjectOptions = useOnboardingStore((state) => state.loadSubjectOptions);
  const [pendingTarget, setPendingTarget] = useState<UserTarget | null>(selectedTarget);

  useEffect(() => {
    if (me?.grade) setGrade(me.grade);
  }, [me?.grade, setGrade]);

  const isNisEligible = me?.grade === 5 || me?.grade === 6;

  const handleSelectTarget = (target: UserTarget) => {
    if (target === "NIS" && !isNisEligible) return;
    setPendingTarget(target);
    setTarget(target);
  };

  const handleNext = async () => {
    if (!pendingTarget || isSaving) return;
    await loadSubjectOptions();
    // Список предметов приходит с сервера. Если он не загрузился, следующий
    // экран показал бы бесконечный спиннер — остаёмся здесь и показываем ошибку.
    if (useOnboardingStore.getState().subjectOptions === null) return;
    router.push(routes.chooseSubjects);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>Tlek</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Что вы хотите подготовить?</Text>
            <Text style={styles.subtitle}>Выберите вашу основную цель для индивидуальной настройки программы.</Text>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.cards}>
            {targetOptions.map((target) => {
              const locked = target.value === "NIS" && !isNisEligible;
              return (
                <TargetCard
                  key={target.value}
                  option={target}
                  selected={pendingTarget === target.value}
                  disabled={isSaving || locked}
                  hint={locked ? "Доступно ученикам 5–6 класса" : null}
                  onPress={() => handleSelectTarget(target.value)}
                />
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <FooterButton icon="log-out-outline" label="Выйти" onPress={() => void logout()} variant="ghost" />
          <FooterButton
            icon={isSaving ? undefined : "chevron-forward"}
            label="Далее"
            onPress={handleNext}
            disabled={!pendingTarget || isSaving}
            loading={isSaving}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

interface TargetCardProps {
  option: TargetOption;
  selected: boolean;
  disabled: boolean;
  hint: string | null;
  onPress: () => void;
}

function TargetCard({ option, selected, disabled, hint, onPress }: TargetCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.iconBox}>
        <Ionicons name={option.icon} size={24} color={colors.blue} />
      </View>
      <Text style={styles.cardTitle}>{option.title}</Text>
      <Text style={styles.cardDescription}>{option.description}</Text>
      {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
    </Pressable>
  );
}

interface FooterButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}

function FooterButton({ label, onPress, icon, variant = "primary", disabled = false, loading = false }: FooterButtonProps) {
  const isGhost = variant === "ghost";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerButton,
        isGhost ? styles.footerButtonGhost : styles.footerButtonPrimary,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={22} color={isGhost ? colors.text : "#ffffff"} /> : null}
          <Text style={[styles.footerButtonText, isGhost ? styles.footerButtonGhostText : styles.footerButtonPrimaryText]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  text: "#242528",
  muted: "#515565",
  border: "#c5cede",
  borderActive: "#1f5fd5",
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
    marginBottom: 32,
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
  errorText: {
    color: "#c31717",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16
  },
  cards: {
    width: "100%",
    gap: 24
  },
  card: {
    width: "100%",
    minHeight: 192,
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 22
  },
  cardSelected: {
    borderColor: colors.borderActive,
    borderWidth: 2,
    backgroundColor: "#fbfdff"
  },
  iconBox: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: colors.iconBackground,
    marginBottom: 18
  },
  cardTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 28
  },
  cardDescription: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22
  },
  cardHint: {
    marginTop: 10,
    color: "#c84b16",
    fontSize: 13,
    fontWeight: "700"
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
