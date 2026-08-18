import { create } from "zustand";

import type { OnboardingStore, UserTarget } from "@/types/onboarding";

const simulateApiCall = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 450);
  });

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  target: null,
  selectedSubjects: [],
  isSaving: false,
  error: null,

  setTarget: (target) => set({ target }),
  setSelectedSubjects: (selectedSubjects) => set({ selectedSubjects }),
  toggleSubject: (subject) =>
    set((state) => {
      const exists = state.selectedSubjects.includes(subject);
      return {
        selectedSubjects: exists
          ? state.selectedSubjects.filter((item) => item !== subject)
          : [...state.selectedSubjects, subject]
      };
    }),
  resetOnboarding: () =>
    set({
      target: null,
      selectedSubjects: [],
      isSaving: false,
      error: null
    }),

  saveUserTarget: async (target: UserTarget) => {
    set({ isSaving: true, error: null });
    try {
      await simulateApiCall();
      set({ target, isSaving: false });
    } catch {
      set({ error: "Failed to save target", isSaving: false });
    }
  },

  saveSelectedSubjects: async (selectedSubjects: string[]) => {
    set({ isSaving: true, error: null });
    try {
      await simulateApiCall();
      set({ selectedSubjects, isSaving: false });
    } catch {
      set({ error: "Failed to save subjects", isSaving: false });
    }
  }
}));
