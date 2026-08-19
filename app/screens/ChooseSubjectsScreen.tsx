import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { OptionCard } from "@/components/OptionCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { subjectGroups } from "@/services/mockData";
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
  const mandatorySubjects = useMemo(() => subjectGroups.ENT_MANDATORY, []);
  const entMandatorySubjects = useMemo(() => mandatorySubjects.map((subject) => subject.title), [mandatorySubjects]);
  const availableSubjects = useMemo(() => {
    if (isEnt) return subjectGroups.ENT_SPECIALIZED;
    if (target === "OLYMPIAD") return subjectGroups.OLYMPIAD;
    return subjectGroups.SUBJECTS.filter((subject, index, items) => items.findIndex((item) => item.id === subject.id) === index);
  }, [isEnt, target]);
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
          {mandatorySubjects.map((subject) => (
            <OptionCard key={subject.id} title={subject.title} subtitle="Required for UNT" selected disabled />
          ))}
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        <Text style={{ color: "#101828", fontSize: 16, fontWeight: "800" }}>
          {isEnt ? `Specialized Subjects (${specializedSelection.length}/2)` : "Available Subjects"}
        </Text>
        {availableSubjects.map((subject, index) => (
          <OptionCard
            key={subject.id || `${subject.title}-${index}`}
            title={subject.title}
            selected={localSubjects.includes(subject.title)}
            disabled={isEnt && specializedSelection.length >= 2 && !localSubjects.includes(subject.title)}
            onPress={() => toggleSubject(subject.title)}
          />
        ))}
      </View>

      <PrimaryButton disabled={!canContinue} loading={isSaving} onPress={handleNext}>
        Next
      </PrimaryButton>
    </ScreenContainer>
  );
}
