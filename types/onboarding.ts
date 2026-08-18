export type UserTarget = "ENT" | "NIS" | "SUBJECTS" | "OLYMPIAD";

export type NullableUserTarget = UserTarget | null;

export interface OnboardingState {
  target: NullableUserTarget;
  selectedSubjects: string[];
  isSaving: boolean;
  error: string | null;
}

export interface OnboardingActions {
  setTarget: (target: NullableUserTarget) => void;
  setSelectedSubjects: (subjects: string[]) => void;
  toggleSubject: (subject: string) => void;
  resetOnboarding: () => void;
  saveUserTarget: (target: UserTarget) => Promise<void>;
  saveSelectedSubjects: (subjects: string[]) => Promise<void>;
}

export type OnboardingStore = OnboardingState & OnboardingActions;
