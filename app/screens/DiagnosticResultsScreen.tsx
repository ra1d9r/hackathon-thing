import { router } from "expo-router";
import { Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { routes } from "@/types/navigation";

export function DiagnosticResultsScreen() {
  return (
    <ScreenContainer title="Diagnostic Results" subtitle="Summary placeholder before entering the student workspace.">
      <StateSnapshot />
      <View style={{ gap: 8, borderRadius: 8, backgroundColor: "#ffffff", padding: 16 }}>
        <Text style={{ color: "#101828", fontSize: 36, fontWeight: "900" }}>78%</Text>
        <Text style={{ color: "#526070", fontSize: 15 }}>Estimated readiness score</Text>
      </View>
      <PrimaryButton onPress={() => router.replace(routes.tabsRoot)}>Go to Dashboard</PrimaryButton>
    </ScreenContainer>
  );
}
