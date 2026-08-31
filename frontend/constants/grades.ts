

export const MIN_GRADE = 5;
export const MAX_GRADE = 11;

export const ALL_GRADES: number[] = Array.from(
  { length: MAX_GRADE - MIN_GRADE + 1 },
  (_, index) => MIN_GRADE + index,
);

export const SELECTABLE_GRADES: number[] = [5, 6, 7, 8, 9, 10, 11];

export const DEFAULT_GRADE = 11;

export function isSelectableGrade(grade: number | null | undefined): boolean {
  return grade !== null && grade !== undefined && SELECTABLE_GRADES.includes(grade);
}

export function isKnownGrade(grade: number | null | undefined): boolean {
  return grade !== null && grade !== undefined && grade >= MIN_GRADE && grade <= MAX_GRADE;
}

export function formatGrade(grade: number | null | undefined): string {
  return isKnownGrade(grade) ? `${grade} класс` : "—";
}
