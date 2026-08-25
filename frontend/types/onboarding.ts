/**
 * Цель обучения в терминах экранов онбординга.
 *
 * Внутрь API уходит уже в виде `goal`/`exam_code` — перевод делает
 * `store/useOnboardingStore.ts` (TARGET_TO_GOAL, TARGET_TO_EXAM_CODE).
 */
export type UserTarget = "ENT" | "NIS" | "SUBJECTS" | "OLYMPIAD";

export type NullableUserTarget = UserTarget | null;
