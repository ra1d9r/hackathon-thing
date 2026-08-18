import { StyleSheet, Text, View } from "react-native";

import { useOnboardingStore } from "@/store/useOnboardingStore";

export function StateSnapshot() {
  const target = useOnboardingStore((state) => state.target);
  const selectedSubjects = useOnboardingStore((state) => state.selectedSubjects);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Current State</Text>
      <Text style={styles.value}>Target: {target ?? "Not selected"}</Text>
      <Text style={styles.value}>
        Subjects: {selectedSubjects.length > 0 ? selectedSubjects.join(", ") : "None"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dee8",
    backgroundColor: "#ffffff",
    padding: 14
  },
  title: {
    color: "#101828",
    fontSize: 15,
    fontWeight: "800"
  },
  value: {
    color: "#475467",
    fontSize: 14,
    lineHeight: 20
  }
});
