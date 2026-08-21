import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
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
