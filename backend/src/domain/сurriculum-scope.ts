import { MAX_GRADE, MIN_GRADE, type LearningGoal } from '../contracts/domain.js';


export interface ExamScope {
  readonly gradeMin: number | null;
  readonly gradeMax: number | null;
}

export interface ScopeInput {
  readonly goal: LearningGoal;
  readonly grade: number;
  readonly exam?: ExamScope | null;
}

export interface CurriculumScope {
  readonly gradeMin: number;
  readonly gradeMax: number;
  readonly reason: string;
}

function clampGrade(value: number): number {
  return Math.min(MAX_GRADE, Math.max(MIN_GRADE, Math.round(value)));
}

export function curriculumScope(input: ScopeInput): CurriculumScope {
  const grade = clampGrade(input.grade);
  const examMin = input.exam?.gradeMin ?? null;
  const examMax = input.exam?.gradeMax ?? null;

  if (input.goal === 'subjects') {
    return { gradeMin: grade, gradeMax: grade, reason: 'класс ученика' };
  }

  if (examMin !== null && examMax !== null) {
    const min = clampGrade(examMin);
    const max = clampGrade(examMax);

    const reachable = Math.max(min, Math.min(max, grade));

    return {
      gradeMin: min,
      gradeMax: reachable,
      reason: reachable === max ? 'программа экзамена' : 'программа экзамена до класса ученика',
    };
  }

  return {
    gradeMin: clampGrade(grade - 1),
    gradeMax: grade,
    reason: 'класс ученика и предыдущий',
  };
}

export function topicInScope(
  topic: { readonly gradeMin: number; readonly gradeMax: number },
  scope: CurriculumScope,
): boolean {
  return topic.gradeMin <= scope.gradeMax && topic.gradeMax >= scope.gradeMin;
}

export const MAX_TOPICS_IN_CONTEXT = 60;
