import { router } from "expo-router";
import { Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { routes } from "@/types/navigation";

export function DiagnosticTestScreen() {
  return (
    <ScreenContainer title="Diagnostic Test" subtitle="Placeholder test interface for the selected path.">
      <StateSnapshot />
      <View style={{ gap: 10, borderRadius: 8, backgroundColor: "#ffffff", padding: 16 }}>
        <Text style={{ color: "#101828", fontSize: 18, fontWeight: "800" }}>Question 1</Text>
        <Text style={{ color: "#526070", fontSize: 15, lineHeight: 22 }}>
          This area is ready for the real diagnostic question renderer.
        </Text>
      </View>
      <PrimaryButton onPress={() => router.push(routes.diagnosticResults)}>Complete Test</PrimaryButton>
    </ScreenContainer>
  );
}
