import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { entMandatorySubjects, generalSubjects, specializedSubjects } from "@/constants/subjects";
import { OptionCard } from "@/components/OptionCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";

export function ChooseSubjectsScreen() {
  const target = useOnboardingStore((state) => state.target);
  const selectedSubjects = useOnboardingStore((state) => state.selectedSubjects);
  const setSelectedSubjects = useOnboardingStore((state) => state.setSelectedSubjects);
  const saveSelectedSubjects = useOnboardingStore((state) => state.saveSelectedSubjects);
  const isSaving = useOnboardingStore((state) => state.isSaving);
  const [localSubjects, setLocalSubjects] = useState<string[]>(selectedSubjects);

  const isEnt = target === "ENT";
  const availableSubjects = useMemo(() => (isEnt ? specializedSubjects : generalSubjects), [isEnt]);
  const specializedSelection = localSubjects.filter((subject) => !entMandatorySubjects.includes(subject));

  useEffect(() => {
    if (isEnt) {
      const nextSubjects = Array.from(new Set([...entMandatorySubjects, ...specializedSelection])).slice(
        0,
        entMandatorySubjects.length + 2
      );
      setLocalSubjects(nextSubjects);
      setSelectedSubjects(nextSubjects);
    }
  }, [isEnt]);

  const toggleSubject = (subject: string) => {
    const isSelected = localSubjects.includes(subject);

    if (isEnt) {
      const nextSpecialized = isSelected
        ? specializedSelection.filter((item) => item !== subject)
        : [...specializedSelection, subject].slice(0, 2);
      const nextSubjects = [...entMandatorySubjects, ...nextSpecialized];
      setLocalSubjects(nextSubjects);
      setSelectedSubjects(nextSubjects);
      return;
    }

    const nextSubjects = isSelected
      ? localSubjects.filter((item) => item !== subject)
      : [...localSubjects, subject];
    setLocalSubjects(nextSubjects);
    setSelectedSubjects(nextSubjects);
  };

  const canContinue = isEnt ? specializedSelection.length === 2 : localSubjects.length > 0;

  const handleNext = async () => {
    await saveSelectedSubjects(localSubjects);
    router.push(routes.diagnosticTest);
  };

  return (
    <ScreenContainer
      title="Choose Subjects"
      subtitle={isEnt ? "Mandatory UNT subjects are locked. Select exactly 2 specialized subjects." : "Select one or more subjects."}
    >
      <StateSnapshot />

      {isEnt ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: "#101828", fontSize: 16, fontWeight: "800" }}>Mandatory Subjects</Text>
          {entMandatorySubjects.map((subject) => (
            <OptionCard key={subject} title={subject} subtitle="Required for UNT" selected disabled />
          ))}
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        <Text style={{ color: "#101828", fontSize: 16, fontWeight: "800" }}>
          {isEnt ? `Specialized Subjects (${specializedSelection.length}/2)` : "Available Subjects"}
        </Text>
        {availableSubjects.map((subject) => (
          <OptionCard
            key={subject}
            title={subject}
            selected={localSubjects.includes(subject)}
            disabled={isEnt && specializedSelection.length >= 2 && !localSubjects.includes(subject)}
            onPress={() => toggleSubject(subject)}
          />
        ))}
      </View>

      <PrimaryButton disabled={!canContinue} loading={isSaving} onPress={handleNext}>
        Next
      </PrimaryButton>
    </ScreenContainer>
  );
}
