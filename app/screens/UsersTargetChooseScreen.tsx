import { router } from "expo-router";
import { View } from "react-native";

import { nisSubjects } from "@/constants/subjects";
import { OptionCard } from "@/components/OptionCard";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { routes } from "@/types/navigation";
import type { UserTarget } from "@/types/onboarding";

const targets: Array<{ label: string; description: string; value: UserTarget }> = [
  { label: "UNT (ЕНТ)", description: "National testing path with mandatory and specialized subjects.", value: "ENT" },
  { label: "NIS (НИШ)", description: "Predefined NIS diagnostic subject set.", value: "NIS" },
  { label: "Improve Knowledge", description: "Choose any subjects for general improvement.", value: "SUBJECTS" },
  { label: "Olympiad", description: "Flexible subject selection for olympiad preparation.", value: "OLYMPIAD" }
];

export function UsersTargetChooseScreen() {
  const selectedTarget = useOnboardingStore((state) => state.target);
  const isSaving = useOnboardingStore((state) => state.isSaving);
  const saveUserTarget = useOnboardingStore((state) => state.saveUserTarget);
  const saveSelectedSubjects = useOnboardingStore((state) => state.saveSelectedSubjects);

  const handleSelectTarget = async (target: UserTarget) => {
    await saveUserTarget(target);

    if (target === "NIS") {
      await saveSelectedSubjects(nisSubjects);
      router.push(routes.diagnosticTest);
      return;
    }

    await saveSelectedSubjects([]);
    router.push(routes.chooseSubjects);
  };

  return (
    <ScreenContainer title="Choose Your Target" subtitle="Select the track that matches the student goal.">
      <StateSnapshot />
      <View style={{ gap: 12 }}>
        {targets.map((target) => (
          <OptionCard
            key={target.value}
            title={target.label}
            subtitle={target.description}
            selected={selectedTarget === target.value}
            disabled={isSaving}
            onPress={() => handleSelectTarget(target.value)}
          />
        ))}
      </View>
    </ScreenContainer>
  );
}
