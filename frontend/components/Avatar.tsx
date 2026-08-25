import { Image, StyleSheet, Text, View } from "react-native";

/**
 * Аватар с инициалами вместо картинки-заглушки.
 *
 * Раньше во всех трёх местах стоял внешний `i.pravatar.cc` — чужой сервис,
 * который в офлайне и без интернета просто не грузится, а у всех учеников
 * показывал одно и то же лицо.
 */

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** Цвет фона подложки под инициалами. */
  tone?: "blue" | "light";
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
}

export function Avatar({ uri, name, size = 40, tone = "blue" }: AvatarProps) {
  const radius = size / 2;
  const frame = { width: size, height: size, borderRadius: radius };

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, frame]} accessibilityIgnoresInvertColors />;
  }

  return (
    <View style={[styles.fallback, frame, tone === "light" ? styles.light : styles.blue]}>
      <Text style={[styles.initials, tone === "light" ? styles.initialsDark : null, { fontSize: size * 0.4 }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: "#e6ecf7" },
  fallback: { alignItems: "center", justifyContent: "center" },
  blue: { backgroundColor: "#274779" },
  light: { backgroundColor: "#dfe8ff" },
  initials: { color: "#ffffff", fontWeight: "800" },
  initialsDark: { color: "#274779" },
});
