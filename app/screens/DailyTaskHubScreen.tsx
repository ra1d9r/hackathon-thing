import { router } from "expo-router";
import { Text, View } from "react-native";

import { OptionCard } from "@/components/OptionCard";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { routes } from "@/types/navigation";

const tasks = ["Warm-up Quiz", "Concept Practice", "Adaptive Challenge"];

export function DailyTaskHubScreen() {
  return (
    <ScreenContainer title="Daily Task Hub" subtitle="Tap any task card to open the task workspace.">
      <StateSnapshot />
      <View style={{ gap: 12 }}>
        <Text style={{ color: "#101828", fontSize: 16, fontWeight: "800" }}>Daily Tasks</Text>
        {tasks.map((task) => (
          <OptionCard
            key={task}
            title={task}
            subtitle="Placeholder task card"
            onPress={() => router.push(routes.taskExecutionWorkspace)}
          />
        ))}
      </View>
    </ScreenContainer>
  );
}
