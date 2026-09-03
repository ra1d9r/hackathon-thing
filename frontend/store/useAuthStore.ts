import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type NativeEventSubscription } from "react-native";
import { create } from "zustand";

import { apiGet, apiPost, setAuthTokenProvider, setUnauthorizedHandler } from "@/services/api";
import { refreshSession, signInWithPassword, type SupabaseSession } from "@/services/supabaseAuth";

const STORAGE_KEY = "tlek.session.v1";

export type LearningGoal = "ent" | "nis" | "subjects";

export interface StudentInfo {
  goal: LearningGoal | null;
  target_exam_code: string | null;
  target_date: string | null;
  onboarding_completed_at: string | null;
  passed_diagnostics: boolean;
  diagnostic_attempt_id: string | null;
  diagnostic_available: boolean;
  diagnostic_draft: {
    attempt_id: string;
    assessment_id: string;
    status: "in_progress";
    started_at: string;
    submitted_at: string | null;
    answered_count: number;
    total_count: number;
  } | null;
  subjects: { code: string; name: string; is_profile: boolean }[];
  class_name: string | null;
  streak_days: number;
  questions_answered: number;
  ai_usage_count: number;
}

export interface MeResponse {
  user_id: string;
  public_id: string;
  role: "student" | "teacher";
  display_name: string;
  grade: number | null;
  locale: string;
  timezone: string;
  avatar_url: string | null;
  created_at: string;
  requires_onboarding: boolean;
  student: StudentInfo | null;
}

export interface RegisterPayload {
  email: string;
  password: string;
  display_name: string;
  role: "student" | "teacher";
  grade?: number;
}

interface PersistedSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface AuthState {
  status: "bootstrapping" | "signed_out" | "signed_in";
  session: PersistedSession | null;
  me: MeResponse | null;
  error: string | null;
  isBusy: boolean;

  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;

  setMe: (me: MeResponse) => void;
  clearError: () => void;
}

async function persist(session: PersistedSession | null): Promise<void> {
  if (session === null) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function fromSupabaseSession(session: SupabaseSession): PersistedSession {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  };
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

export const useAuthStore = create<AuthState>((set, get) => {
  setAuthTokenProvider(() => get().session?.access_token ?? null);

  setUnauthorizedHandler(() => {
    void (async () => {
      const session = get().session;
      if (!session) return;

      try {
        const next = fromSupabaseSession(await refreshSession(session.refresh_token));
        await persist(next);
        set({ session: next });
      } catch {
        await get().logout();
      }
    })();
  });

  function scheduleRefresh(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      void maybeRefresh();
    }, 60_000);

    if (appStateSubscription === null) {
      appStateSubscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void maybeRefresh();
      });
    }
  }

  async function maybeRefresh(): Promise<void> {
    const session = get().session;
    if (!session) return;
    const fiveMinutes = 5 * 60_000;
    if (session.expires_at - Date.now() > fiveMinutes) return;

    try {
      const next = fromSupabaseSession(await refreshSession(session.refresh_token));
      await persist(next);
      set({ session: next });
    } catch {
      await get().logout();
    }
  }

  async function establishSession(session: PersistedSession): Promise<void> {
    await persist(session);
    set({ session });
    scheduleRefresh();

    const me = await apiGet<MeResponse>("/v1/me");
    set({ me, status: "signed_in" });
  }

  return {
    status: "bootstrapping",
    session: null,
    me: null,
    error: null,
    isBusy: false,

    async bootstrap() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          set({ status: "signed_out" });
          return;
        }

        const stored = JSON.parse(raw) as PersistedSession;

        const session =
          stored.expires_at - Date.now() < 5 * 60_000
            ? fromSupabaseSession(await refreshSession(stored.refresh_token))
            : stored;

        await establishSession(session);
      } catch {
        await persist(null);
        set({ status: "signed_out", session: null, me: null });
      }
    },

    async login(email, password) {
      set({ isBusy: true, error: null });
      try {
        const session = fromSupabaseSession(await signInWithPassword(email, password));
        await establishSession(session);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "Не удалось войти" });
        throw error;
      } finally {
        set({ isBusy: false });
      }
    },

    async register(payload) {
      set({ isBusy: true, error: null });
      try {
        await apiPost("/v1/auth/register", payload, { skipAuth: true });
        const session = fromSupabaseSession(await signInWithPassword(payload.email, payload.password));
        await establishSession(session);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "Не удалось зарегистрироваться" });
        throw error;
      } finally {
        set({ isBusy: false });
      }
    },

    async logout() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      await persist(null);
      set({ status: "signed_out", session: null, me: null, error: null });
    },

    async refreshMe() {
      const me = await apiGet<MeResponse>("/v1/me");
      set({ me });
    },

    setMe(me) {
      set({ me });
    },

    clearError() {
      set({ error: null });
    },
  };
});
