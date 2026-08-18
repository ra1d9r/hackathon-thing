import { router } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { routes } from "@/types/navigation";

export function MainScreen() {
  return (
    <ScreenContainer title="Learning App" subtitle="Frontend navigation and onboarding boilerplate.">
      <StateSnapshot />
      <PrimaryButton onPress={() => router.push(routes.usersTargetChoose)}>Start Learning</PrimaryButton>
    </ScreenContainer>
  );
}
