import type { UserTarget } from "@/types/onboarding";

export interface UserProfile {
  id: string;
  name: string;
  avatarUrl: string;
  grade: string;
  target: UserTarget;
  selectedSubjects: Subject[];
  streakDays: number;
  totalPracticeCount: number;
  aiUsageCount: number;
}

export interface Subject {
  id: string;
  code: string;
  title: string;
  isMandatory?: boolean;
  iconName?: string;
}

export interface TaskItem {
  id: string;
  subjectId: string;
  subjectTitle: string;
  title: string;
  subtitle: string;
  durationMinutes: number;
  estimatedPoints?: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  progressPercentage: number;
  type: "LESSON" | "QUIZ" | "DRILL";
}

export interface LessonMaterial {
  id: string;
  taskId: string;
  title: string;
  paragraphs: string[];
  formulas?: string[];
  topics: {
    id: string;
    title: string;
    type: "video" | "reading" | "quiz";
    duration: string;
    isLocked: boolean;
  }[];
}

export interface QuizQuestion {
  id: string;
  taskId: string;
  questionText: string;
  options: { id: string; text: string; isCorrect?: boolean }[];
  explanation?: string;
}

export interface RoadmapNode {
  id: string;
  subjectId: string;
  title: string;
  masteryPercentage: number;
  status: "COMPLETED" | "ACTIVE" | "LOCKED";
  nextNodeId?: string;
  badgeText?: string;
}
