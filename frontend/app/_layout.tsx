import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";

const PUBLIC_SEGMENTS = new Set(["login", "register"]);

const ONBOARDING_SEGMENTS = new Set([
  "users-target-choose",
  "choose-subjects",
  "diagnostic-test",
  "diagnostic-results",
]);

const DIAGNOSTIC_SEGMENTS = new Set(["diagnostic-test", "diagnostic-results"]);

function useAuthGuard(): void {
  const status = useAuthStore((state) => state.status);
  const me = useAuthStore((state) => state.me);
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key) return;
    if (status === "bootstrapping") return;

    const first: string | undefined = segments[0];
    const isPublic = first === undefined || PUBLIC_SEGMENTS.has(first);

    if (status === "signed_out") {
      if (!isPublic) router.replace(routes.main);
      return;
    }

    const needsOnboarding = me?.requires_onboarding !== false;
    const needsDiagnostic =
      !needsOnboarding &&
      me?.student?.passed_diagnostics !== true &&
      me?.student?.diagnostic_available === true;
    const target = needsOnboarding
      ? routes.usersTargetChoose
      : needsDiagnostic
        ? routes.diagnosticTest
        : routes.tabsRoot;

    if (first === undefined || first === "login" || first === "register") {
      router.replace(target);
      return;
    }

    if (needsOnboarding && !ONBOARDING_SEGMENTS.has(first)) {
      router.replace(routes.usersTargetChoose);
      return;
    }

    if (needsDiagnostic && !DIAGNOSTIC_SEGMENTS.has(first)) {
      router.replace(routes.diagnosticTest);
      return;
    }

    if (!needsOnboarding && ONBOARDING_SEGMENTS.has(first)) {
      if (first === "users-target-choose") router.replace(routes.tabsRoot);
    }
  }, [status, me, segments, router, navigationState?.key]);
}

export default function RootLayout() {
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {status === "bootstrapping" ? <SplashScreen /> : <AppStack />}
    </SafeAreaProvider>
  );
}

function AppStack() {
  useAuthGuard();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#fbfaf9" } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="users-target-choose" />
      <Stack.Screen name="choose-subjects" />
      <Stack.Screen name="diagnostic-test" />
      <Stack.Screen name="diagnostic-results" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="personal-account" />
      <Stack.Screen name="task-execution-workspace" />
    </Stack>
  );
}

function SplashScreen() {
  return (
    <View style={styles.splash}>
      <Text style={styles.splashLogo}>Tlek</Text>
      <ActivityIndicator size="large" color="#0057d9" />
    </View>
  );
}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={styles.splash}>
      <Text style={styles.splashLogo}>Tlek</Text>
      <Text style={styles.errorTitle}>Что-то пошло не так</Text>
      <Text style={styles.errorBody}>{error.message}</Text>
      <Text style={styles.retry} onPress={() => void retry()}>
        Попробовать снова
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
    backgroundColor: "#fbfaf9",
  },
  splashLogo: { color: "#0057d9", fontSize: 34, fontWeight: "900", letterSpacing: 1 },
  errorTitle: { color: "#222326", fontSize: 20, fontWeight: "800", textAlign: "center" },
  errorBody: { color: "#536382", fontSize: 15, lineHeight: 21, textAlign: "center" },
  retry: { color: "#0057d9", fontSize: 16, fontWeight: "800", marginTop: 8 },
});
