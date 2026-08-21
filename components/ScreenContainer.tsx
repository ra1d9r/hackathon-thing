import type { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface ScreenContainerProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
}

export function ScreenContainer({ title, subtitle, children }: ScreenContainerProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f7f9fc"
  },
  content: {
    flexGrow: 1,
    gap: 18,
    padding: 20
  },
  header: {
    gap: 8
  },
  title: {
    color: "#101828",
    fontSize: 28,
    fontWeight: "800"
  },
  subtitle: {
    color: "#526070",
    fontSize: 16,
    lineHeight: 22
  }
});
