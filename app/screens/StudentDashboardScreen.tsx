import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/ScreenContainer";
import { StateSnapshot } from "@/components/StateSnapshot";
import { routes } from "@/types/navigation";

export function StudentDashboardScreen() {
  return (
    <ScreenContainer title="Student Dashboard" subtitle="Main learning overview placeholder.">
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Today</Text>
        <Pressable
          accessibilityLabel="Open personal account"
          accessibilityRole="button"
          onPress={() => router.push(routes.personalAccount)}
          style={styles.avatarButton}
        >
          <Ionicons name="person-outline" size={22} color="#1f6feb" />
        </Pressable>
      </View>
      <StateSnapshot />
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Learning Plan</Text>
        <Text style={styles.panelBody}>Dashboard widgets and recommendations can be integrated here.</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  sectionTitle: {
    color: "#101828",
    fontSize: 18,
    fontWeight: "800"
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef4ff",
    borderColor: "#b9cdf8",
    borderWidth: 1
  },
  panel: {
    gap: 8,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    padding: 16
  },
  panelTitle: {
    color: "#101828",
    fontSize: 17,
    fontWeight: "800"
  },
  panelBody: {
    color: "#526070",
    fontSize: 15,
    lineHeight: 22
  }
});
