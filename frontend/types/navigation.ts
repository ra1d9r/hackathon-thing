import type { Href } from "expo-router";

export type RootRoute =
  | "/"
  | "/users-target-choose"
  | "/choose-subjects"
  | "/diagnostic-test"
  | "/diagnostic-results"
  | "/personal-account"
  | "/task-execution-workspace"
  | "/(tabs)"
  | "/(tabs)/learning"
  | "/(tabs)/progress";

export const routes = {
  main: "/" as Href,
  usersTargetChoose: "/users-target-choose" as Href,
  chooseSubjects: "/choose-subjects" as Href,
  diagnosticTest: "/diagnostic-test" as Href,
  diagnosticResults: "/diagnostic-results" as Href,
  tabsRoot: "/(tabs)" as Href,
  learning: "/(tabs)/learning" as Href,
  progress: "/(tabs)/progress" as Href,
  personalAccount: "/personal-account" as Href,
  taskExecutionWorkspace: "/task-execution-workspace" as Href
} as const;
