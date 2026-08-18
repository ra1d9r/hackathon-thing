import { Text, View } from "react-native";

import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";

export function DynamicRoadmapScreen() {
  return (
    <ScreenContainer title="Dynamic Roadmap" subtitle="Progress and adaptive roadmap placeholder.">
      <StateSnapshot />
      <View style={{ gap: 8, borderRadius: 8, backgroundColor: "#ffffff", padding: 16 }}>
        <Text style={{ color: "#101828", fontSize: 17, fontWeight: "800" }}>Roadmap Progress</Text>
        <Text style={{ color: "#526070", fontSize: 15, lineHeight: 22 }}>
          Roadmap milestones, mastery levels, and progress charts can be integrated here.
        </Text>
      </View>
    </ScreenContainer>
  );
}
