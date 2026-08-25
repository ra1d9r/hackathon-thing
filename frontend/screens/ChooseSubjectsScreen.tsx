import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { OptionCard } from "@/components/OptionCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";

/**
 * Выбор профильных предметов — по данным `GET /v1/catalog/subjects`.
 *
 * Обязательные предметы уже подставлены в `selectedSubjects` на предыдущем
 * шаге (`loadSubjectOptions`); здесь ученик выбирает ровно `profile_slot_count`
 * профильных — правило и число задаёт backend, а не эта форма.
 */
export function ChooseSubjectsScreen() {
  const subjectOptions = useOnboardingStore((state) => state.subjectOptions);
  const selectedSubjects = useOnboardingStore((state) => state.selectedSubjects);
  const toggleSubject = useOnboardingStore((state) => state.toggleSubject);
  const isLoadingSubjects = useOnboardingStore((state) => state.isLoadingSubjects);
  const isSaving = useOnboardingStore((state) => state.isSaving);
  const error = useOnboardingStore((state) => state.error);
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);
  const [localError, setLocalError] = useState<string | null>(null);

  const mandatoryCodes = useMemo(
    () => new Set(subjectOptions?.mandatory.map((subject) => subject.code) ?? []),
    [subjectOptions],
  );
  const profileSelection = selectedSubjects.filter((code) => !mandatoryCodes.has(code));
  const slotCount = subjectOptions?.exam?.profile_slot_count ?? 0;
  const hasProfileSlots = slotCount > 0;

  const canContinue = hasProfileSlots
    ? profileSelection.length === slotCount
    : selectedSubjects.length > 0;

  const toggleProfileSubject = (code: string) => {
    if (hasProfileSlots && !selectedSubjects.includes(code) && profileSelection.length >= slotCount) {
      return;
    }
    toggleSubject(code);
  };

  const handleNext = async () => {
    setLocalError(null);
    try {
      const response = await completeOnboarding();
      if (response.diagnostic_unavailable_reason) {
        // Онбординг всё равно завершён — идём сразу на панель.
        router.replace(routes.tabsRoot);
        return;
      }
      router.push(routes.diagnosticTest);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Не удалось завершить онбординг");
    }
  };

  if (isLoadingSubjects || !subjectOptions) {
    return (
      <ScreenContainer title="Выбор предметов">
        <ActivityIndicator color="#1f6feb" />
        {error ? <Text style={{ color: "#c31717" }}>{error}</Text> : null}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      title="Выбор предметов"
      subtitle={
        hasProfileSlots
          ? `Обязательные предметы закреплены. Выберите ровно ${slotCount} профильных.`
          : "Выберите один или несколько предметов."
      }
    >
      {subjectOptions.mandatory.length > 0 ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: "#101828", fontSize: 16, fontWeight: "800" }}>Обязательные предметы</Text>
          {subjectOptions.mandatory.map((subject) => (
            <OptionCard key={subject.code} title={subject.name} subtitle="Обязательный предмет" selected disabled />
          ))}
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        <Text style={{ color: "#101828", fontSize: 16, fontWeight: "800" }}>
          {hasProfileSlots ? `Профильные предметы (${profileSelection.length}/${slotCount})` : "Доступные предметы"}
        </Text>
        {subjectOptions.profile.map((subject) => (
          <OptionCard
            key={subject.code}
            title={subject.name}
            selected={selectedSubjects.includes(subject.code)}
            disabled={hasProfileSlots && profileSelection.length >= slotCount && !selectedSubjects.includes(subject.code)}
            onPress={() => toggleProfileSubject(subject.code)}
          />
        ))}
      </View>

      {(localError ?? error) ? <Text style={{ color: "#c31717", fontSize: 14 }}>{localError ?? error}</Text> : null}

      <PrimaryButton disabled={!canContinue} loading={isSaving} onPress={handleNext}>
        Далее
      </PrimaryButton>
    </ScreenContainer>
  );
}
