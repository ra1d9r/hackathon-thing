/**
 * Классы.
 *
 * Backend принимает 5–11 (`backend/src/contracts/domain.ts`, MIN_GRADE/MAX_GRADE),
 * поэтому профиль обязан корректно показывать любой класс из этого диапазона —
 * например, у ученика, заведённого учителем.
 *
 * Выбрать при регистрации и в профиле можно только 7–11: диагностика, роадмап
 * и материалы собраны под старшую школу.
 */

export const MIN_GRADE = 5;
export const MAX_GRADE = 11;

export const ALL_GRADES: number[] = Array.from(
  { length: MAX_GRADE - MIN_GRADE + 1 },
  (_, index) => MIN_GRADE + index,
);

export const SELECTABLE_GRADES: number[] = [7, 8, 9, 10, 11];

export const DEFAULT_GRADE = 11;

export function isSelectableGrade(grade: number | null | undefined): boolean {
  return grade !== null && grade !== undefined && SELECTABLE_GRADES.includes(grade);
}

export function isKnownGrade(grade: number | null | undefined): boolean {
  return grade !== null && grade !== undefined && grade >= MIN_GRADE && grade <= MAX_GRADE;
}

/** «9 класс» / «—», если класс не задан или вне диапазона. */
export function formatGrade(grade: number | null | undefined): string {
  return isKnownGrade(grade) ? `${grade} класс` : "—";
}
