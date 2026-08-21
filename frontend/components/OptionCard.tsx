import { Pressable, StyleSheet, Text, View } from "react-native";

interface OptionCardProps {
  title: string;
  subtitle?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export function OptionCard({ title, subtitle, selected = false, disabled = false, onPress }: OptionCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        disabled && styles.disabled,
        pressed && styles.pressed
      ]}
    >
      <View style={[styles.indicator, selected && styles.indicatorSelected]}>
        {selected ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dee8",
    backgroundColor: "#ffffff",
    padding: 14
  },
  selected: {
    borderColor: "#1f6feb",
    backgroundColor: "#eef4ff"
  },
  disabled: {
    opacity: 0.68
  },
  pressed: {
    opacity: 0.82
  },
  indicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#aab4c0",
    alignItems: "center",
    justifyContent: "center"
  },
  indicatorSelected: {
    borderColor: "#1f6feb",
    backgroundColor: "#1f6feb"
  },
  check: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800"
  },
  copy: {
    flex: 1,
    gap: 4
  },
  title: {
    color: "#101828",
    fontSize: 16,
    fontWeight: "700"
  },
  subtitle: {
    color: "#667085",
    fontSize: 14,
    lineHeight: 19
  }
});
