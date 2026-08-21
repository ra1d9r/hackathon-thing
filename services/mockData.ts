import type { LessonMaterial, QuizQuestion, RoadmapNode, Subject, TaskItem, UserProfile } from "@/types/app";

export const subjects: Subject[] = [
  { id: "history-kz", code: "HISTORY_KZ", title: "История Казахстана", isMandatory: true, iconName: "business" },
  { id: "reading", code: "READING", title: "Грамотность чтения", isMandatory: true, iconName: "book-outline" },
  { id: "math-literacy", code: "MATH_LITERACY", title: "Математическая грамотность", isMandatory: true, iconName: "calculator-outline" },
  { id: "math", code: "MATH", title: "Математика", iconName: "calculator-outline" },
  { id: "cs", code: "CS", title: "Информатика", iconName: "desktop-outline" },
  { id: "physics", code: "PHYSICS", title: "Физика", iconName: "planet-outline" },
  { id: "chemistry", code: "CHEMISTRY", title: "Химия", iconName: "flask-outline" },
  { id: "biology", code: "BIOLOGY", title: "Биология", iconName: "leaf-outline" },
  { id: "logic", code: "LOGIC", title: "Логика и аналитика", iconName: "git-network-outline" },
  { id: "natural", code: "NATURAL", title: "Естествознание", iconName: "earth-outline" },
  { id: "kazakh", code: "KAZAKH", title: "Казахский язык", iconName: "text-outline" },
  { id: "russian", code: "RUSSIAN", title: "Русский язык", iconName: "text-outline" },
  { id: "english", code: "ENGLISH", title: "Английский язык", iconName: "language-outline" }
];

export const subjectGroups = {
  ENT_MANDATORY: subjects.filter((subject) => subject.isMandatory),
  ENT_SPECIALIZED: subjects.filter((subject) => ["math", "cs", "physics", "chemistry", "biology"].includes(subject.id)),
  NIS: subjects.filter((subject) => ["math", "logic", "natural", "kazakh", "russian", "english"].includes(subject.id)),
  OLYMPIAD: subjects.filter((subject) => ["math", "cs", "physics", "chemistry", "biology"].includes(subject.id)),
  SUBJECTS: subjects
};

export const targetChooseOptions = [
  {
    target: "SUBJECTS" as const,
    title: "Подтянуть знания по выбранным предметам",
    description: "Сфокусируйтесь на улучшении оценок и понимания конкретных школьных дисциплин.",
    iconName: "book-outline"
  },
  {
    target: "ENT" as const,
    title: "Подготовка к ЕНТ",
    description: "Комплексная программа подготовки к Единому национальному тестированию.",
    iconName: "school"
  },
  {
    target: "OLYMPIAD" as const,
    title: "Олимпиада",
    description: "Углубленное изучение предметов для участия и победы в предметных олимпиадах.",
    iconName: "trophy"
  },
  {
    target: "NIS" as const,
    title: "Экзамен в НИШ",
    description: "Специализированная подготовка к вступительным экзаменам в Назарбаев Интеллектуальные школы.",
    iconName: "business"
  }
];

export const currentUser: UserProfile = {
  id: "STU-89241",
  name: "Aibar Serikov",
  avatarUrl: "https://i.pravatar.cc/160?img=12",
  grade: "Класс 11 А",
  target: "ENT",
  selectedSubjects: [subjects[2], subjects[0], subjects[3], subjects[4]],
  streakDays: 7,
  totalPracticeCount: 128,
  aiUsageCount: 34
};

export const dailyTasks: TaskItem[] = [
  {
    id: "quadratic",
    subjectId: "math",
    subjectTitle: "МАТЕМАТИКА",
    title: "Квадратные уравнения & Дискриминант",
    subtitle: "Изучи формулы и реши задачи",
    durationMinutes: 15,
    estimatedPoints: 5,
    status: "NOT_STARTED",
    progressPercentage: 0,
    type: "LESSON"
  },
  {
    id: "history-khanate",
    subjectId: "history-kz",
    subjectTitle: "ИСТОРИЯ",
    title: "Казахское ханство: ключевые даты",
    subtitle: "Повтори события и закрепи факты",
    durationMinutes: 10,
    status: "IN_PROGRESS",
    progressPercentage: 50,
    type: "DRILL"
  },
  {
    id: "reading-analysis",
    subjectId: "reading",
    subjectTitle: "ЧТЕНИЕ",
    title: "Анализ текста и выводы",
    subtitle: "Тренировка завершена",
    durationMinutes: 8,
    status: "COMPLETED",
    progressPercentage: 100,
    type: "QUIZ"
  }
];

export const roadmapNodes: RoadmapNode[] = [
  { id: "quadratic-node", subjectId: "math-literacy", title: "Квадратные уравнения", masteryPercentage: 100, status: "COMPLETED", nextNodeId: "trig-node", badgeText: "100% Выполнено" },
  { id: "trig-node", subjectId: "math-literacy", title: "Тригонометрия", masteryPercentage: 45, status: "ACTIVE", nextNodeId: "log-node", badgeText: "Начни задание" },
  { id: "physics-base-node", subjectId: "physics", title: "Физика Основа", masteryPercentage: 15, status: "ACTIVE" },
  { id: "log-node", subjectId: "math-literacy", title: "Логарифмы", masteryPercentage: 0, status: "LOCKED" }
];

export const lessonMaterials: LessonMaterial[] = [
  {
    id: "material-quadratic",
    taskId: "quadratic",
    title: "Понимание дискриминанта",
    paragraphs: [
      "Дискриминант помогает быстро понять, сколько решений имеет квадратное уравнение. Он вычисляется по коэффициентам уравнения ax² + bx + c = 0.",
      "Чем увереннее ты работаешь с дискриминантом, тем быстрее решаешь задачи на корни, графики и прикладные модели."
    ],
    formulas: ["Δ = b² - 4ac"],
    topics: [
      { id: "topic-circle", title: "1. Intro to Unit Circle", type: "video", duration: "5 mins", isLocked: false },
      { id: "topic-identities", title: "2. Sine & Cosine Identities", type: "reading", duration: "10 mins", isLocked: false },
      { id: "topic-drill", title: "3. Practice Drill", type: "quiz", duration: "5 mins", isLocked: true }
    ]
  }
];

export const quizQuestions: QuizQuestion[] = [
  {
    id: "q1",
    taskId: "quadratic",
    questionText: "1. Какой дискриминант у уравнения x² - 5x + 6 = 0?",
    options: [{ id: "a", text: "1", isCorrect: true }, { id: "b", text: "5" }, { id: "c", text: "12" }, { id: "d", text: "25" }]
  },
  {
    id: "q2",
    taskId: "quadratic",
    questionText: "2. Если Δ > 0, сколько корней имеет квадратное уравнение?",
    options: [{ id: "a", text: "Нет корней" }, { id: "b", text: "Один корень" }, { id: "c", text: "Два корня", isCorrect: true }, { id: "d", text: "Бесконечно много" }]
  },
  {
    id: "q3",
    taskId: "quadratic",
    questionText: "3. Какая формула используется для дискриминанта?",
    options: [{ id: "a", text: "a² + b²" }, { id: "b", text: "b² - 4ac", isCorrect: true }, { id: "c", text: "2a + b" }, { id: "d", text: "c² - ab" }]
  }
];

export const subjectProgress = [
  { label: "Математическая грамотность", value: 85, color: "#2b63f1" },
  { label: "История Казахстана", value: 70, color: "#5f84e8" },
  { label: "Физика", value: 42, color: "#c91f1f", important: true },
  { label: "Математика", value: 30, color: "#c91f1f", important: true },
  { label: "Грамотность чтения", value: 16, color: "#c91f1f", important: true }
];

export const gradeChartData = [
  { value: 2, label: "Д1" },
  { value: 4, label: "Д2" },
  { value: 5, label: "Д3" },
  { value: 7, label: "Д4" },
  { value: 9, label: "Д5" }
];
