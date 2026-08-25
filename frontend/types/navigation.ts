import type { Href } from "expo-router";

/** Все адреса приложения в одном месте — строки в компонентах не разъезжаются. */
export const routes = {
  main: "/" as Href,
  login: "/login" as Href,
  register: "/register" as Href,
  usersTargetChoose: "/users-target-choose" as Href,
  chooseSubjects: "/choose-subjects" as Href,
  diagnosticTest: "/diagnostic-test" as Href,
  diagnosticResults: "/diagnostic-results" as Href,
  tabsRoot: "/(tabs)/dashboard" as Href,
  learning: "/(tabs)/learning" as Href,
  progress: "/(tabs)/progress" as Href,
  personalAccount: "/personal-account" as Href,
  taskExecutionWorkspace: "/task-execution-workspace" as Href
} as const;
