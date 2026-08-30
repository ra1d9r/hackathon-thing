import { create } from "zustand";

import { apiGet, apiPost } from "@/services/api";
import type { LearningGoal } from "@/store/useAuthStore";
import { useAuthStore } from "@/store/useAuthStore";
import type { UserTarget } from "@/types/onboarding";

const TARGET_TO_GOAL: Record<UserTarget, LearningGoal> = {
  ENT: "ent",
  NIS: "nis",
  SUBJECTS: "subjects",
};

const TARGET_TO_EXAM_CODE: Record<UserTarget, string | null> = {
  ENT: "ent",
  NIS: "nis",
  SUBJECTS: null,
};

export interface SubjectOption {
  code: string;
  name: string;
}

export interface SubjectOptionsResponse {
  goal: LearningGoal;
  exam: { code: string; title: string; profile_slot_count: number } | null;
  mandatory: SubjectOption[];
  profile: SubjectOption[];
  profile_pairs: { codes: [string, string]; titles: [string, string] }[];
}

export interface DiagnosticSummary {
  assessment_id: string;
  question_count: number;
  free_text_count: number;
  time_limit_sec: number;
  subjects: { code: string; name: string; question_count: number }[];
}

export interface CompleteOnboardingResponse {
  onboarding_completed: boolean;
  goal: LearningGoal;
  exam_code: string | null;
  subjects: { code: string; name: string; is_profile: boolean }[];
  diagnostic: DiagnosticSummary | null;
  diagnostic_unavailable_reason: "not_enough_questions" | null;
}

interface OnboardingState {
  target: UserTarget | null;
  selectedSubjects: string[];
  grade: number;
  subjectOptions: SubjectOptionsResponse | null;
  isSaving: boolean;
  isLoadingSubjects: boolean;
  error: string | null;
  diagnostic: DiagnosticSummary | null;

  setTarget: (target: UserTarget | null) => void;
  setGrade: (grade: number) => void;
  setSelectedSubjects: (subjects: string[]) => void;
  toggleSubject: (subject: string) => void;
  resetOnboarding: () => void;

  loadSubjectOptions: () => Promise<void>;
  completeOnboarding: () => Promise<CompleteOnboardingResponse>;
}

const uniqueSubjects = (subjects: string[]) => Array.from(new Set(subjects));

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  target: null,
  selectedSubjects: [],
  grade: 11,
  subjectOptions: null,
  isSaving: false,
  isLoadingSubjects: false,
  error: null,
  diagnostic: null,

  setTarget: (target) => set({ target, subjectOptions: null, selectedSubjects: [] }),
  setGrade: (grade) => set({ grade }),
  setSelectedSubjects: (selectedSubjects) => set({ selectedSubjects: uniqueSubjects(selectedSubjects) }),
  toggleSubject: (subject) =>
    set((state) => ({
      selectedSubjects: state.selectedSubjects.includes(subject)
        ? state.selectedSubjects.filter((item) => item !== subject)
        : [...state.selectedSubjects, subject],
    })),
  resetOnboarding: () =>
    set({
      target: null,
      selectedSubjects: [],
      subjectOptions: null,
      isSaving: false,
      isLoadingSubjects: false,
      error: null,
      diagnostic: null,
    }),

  loadSubjectOptions: async () => {
    const { target } = get();
    if (!target) return;

    set({ isLoadingSubjects: true, error: null });
    try {
      const goal = TARGET_TO_GOAL[target];
      const examCode = TARGET_TO_EXAM_CODE[target];
      const options = await apiGet<SubjectOptionsResponse>("/v1/catalog/subjects", {
        goal,
        ...(examCode ? { exam_code: examCode } : {}),
      });
      set({ subjectOptions: options });

      
      const mandatoryCodes = options.mandatory.map((subject) => subject.code);
      set((state) => ({
        selectedSubjects: uniqueSubjects([...mandatoryCodes, ...state.selectedSubjects]),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Не удалось загрузить предметы" });
    } finally {
      set({ isLoadingSubjects: false });
    }
  },

  completeOnboarding: async () => {
    const { target, selectedSubjects, subjectOptions, grade } = get();
    if (!target) throw new Error("Цель не выбрана");

    const mandatoryCodes = new Set(subjectOptions?.mandatory.map((subject) => subject.code) ?? []);
    const profileCodes = selectedSubjects.filter((code) => !mandatoryCodes.has(code));

    set({ isSaving: true, error: null });
    try {
      const response = await apiPost<CompleteOnboardingResponse>("/v1/onboarding/complete", {
        goal: TARGET_TO_GOAL[target],
        exam_code: TARGET_TO_EXAM_CODE[target],
        grade,
        target_date: null,
        subject_codes: profileCodes,
        answers: null,
      });

      set({ diagnostic: response.diagnostic });
      
      await useAuthStore.getState().refreshMe();
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось завершить онбординг";
      set({ error: message });
      throw error;
    } finally {
      set({ isSaving: false });
    }
  },
}));

export { TARGET_TO_GOAL, TARGET_TO_EXAM_CODE };
