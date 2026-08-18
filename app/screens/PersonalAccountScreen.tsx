import { router } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";

export function PersonalAccountScreen() {
  return (
    <ScreenContainer title="Personal Account" subtitle="Profile and account settings placeholder.">
      <StateSnapshot />
      <PrimaryButton variant="secondary" onPress={() => router.back()}>
        Back
      </PrimaryButton>
    </ScreenContainer>
  );
}
