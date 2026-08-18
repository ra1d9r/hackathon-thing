import { router } from "expo-router";
import { Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { routes } from "@/types/navigation";

export function TaskExecutionWorkspaceScreen() {
  return (
    <ScreenContainer title="Task Workspace" subtitle="Placeholder for lessons, quizzes, and exercises.">
      <StateSnapshot />
      <View style={{ gap: 8, borderRadius: 8, backgroundColor: "#ffffff", padding: 16 }}>
        <Text style={{ color: "#101828", fontSize: 18, fontWeight: "800" }}>Active Task</Text>
        <Text style={{ color: "#526070", fontSize: 15, lineHeight: 22 }}>
          Task execution UI and answer handling can be added here.
        </Text>
      </View>
      <PrimaryButton onPress={() => router.replace(routes.learning)}>Complete Task</PrimaryButton>
    </ScreenContainer>
  );
}
