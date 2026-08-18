import type { PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";

interface PrimaryButtonProps extends PropsWithChildren {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  style?: ViewStyle;
}

export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  style
}: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style
      ]}
    >
      {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={[styles.label, styles[`${variant}Label`]]}>{children}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  primary: {
    backgroundColor: "#1f6feb"
  },
  secondary: {
    backgroundColor: "#eef4ff",
    borderColor: "#b9cdf8",
    borderWidth: 1
  },
  ghost: {
    backgroundColor: "transparent"
  },
  disabled: {
    opacity: 0.48
  },
  pressed: {
    opacity: 0.82
  },
  label: {
    fontSize: 16,
    fontWeight: "700"
  },
  primaryLabel: {
    color: "#ffffff"
  },
  secondaryLabel: {
    color: "#174ea6"
  },
  ghostLabel: {
    color: "#1f6feb"
  }
});
