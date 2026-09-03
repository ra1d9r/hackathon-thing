import { Stack, router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Страница не найдена" }} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          <Text style={styles.code}>404</Text>
          <Text style={styles.title}>Такой страницы нет</Text>
          <Text style={styles.subtitle}>
            Ссылка устарела или в адресе опечатка. Вернитесь на главную — оттуда доступно всё.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/")}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>На главную</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f7f8fa" },
  root: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },
  code: { color: "#1e3a8a", fontSize: 56, fontWeight: "900" },
  title: { color: "#0f172a", fontSize: 22, fontWeight: "800" },
  subtitle: { color: "#64748b", fontSize: 15, lineHeight: 21, textAlign: "center" },
  button: {
    marginTop: 18,
    borderRadius: 12,
    backgroundColor: "#1e3a8a",
    paddingHorizontal: 26,
    paddingVertical: 13,
  },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.85 },
});
