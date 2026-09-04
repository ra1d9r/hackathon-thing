import type {
  CompleteOnboardingRequest,
  DiagnosticSummary,
  UpdateLearningProfileRequest,
} from '../../contracts/dto/onboarding.js';
import { isExamGoal, type LearningGoal } from '../../contracts/domain.js';
import { AppError } from '../../contracts/errors.js';
import { jsonObjectSchema, type JsonObject } from '../../contracts/json.js';
import { writeAudit } from '../../db/audit.js';
import type { Sql, SqlExecutor } from '../../db/sql.js';
import { curriculumScope, type ExamScope } from '../../domain/curriculum-scope.js';
import type { AuthUser } from '../../types/fastify.js';
import { findExam, listSubjectOptions } from '../catalog/service.js';
import { assembleDiagnostic, describeDiagnostic } from './diagnostic.js';

export interface ResolvedSelection {
  readonly examId: string | null;
  readonly examCode: string | null;
  readonly subjects: { id: string; code: string; name: string; isProfile: boolean }[];
  readonly examScope: ExamScope | null;
}

async function subjectIdsByCodes(
  sql: SqlExecutor,
  codes: readonly string[],
): Promise<{ id: string; code: string; name: string }[]> {
  if (codes.length === 0) {
    return [];
  }

  const rows = await sql<{ id: string; code: string; name_ru: string }[]>`
    select id, code, name_ru
      from public.subjects
     where code = any(${[...codes]}::text[]) and is_active
  `;

  const found = new Set(rows.map((row) => row.code));
  const missing = codes.filter((code) => !found.has(code));

  if (missing.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Некоторые предметы не найдены',
      details: { unknown_subjects: missing },
    });
  }

  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name_ru }));
}

export async function resolveSelection(
  sql: SqlExecutor,
  goal: LearningGoal,
  examCode: string | null,
  subjectCodes: readonly string[],
  grade: number,
): Promise<ResolvedSelection> {
  const unique = [...new Set(subjectCodes)];
  if (unique.length !== subjectCodes.length) {
    throw new AppError('VALIDATION_FAILED', { message: 'Предмет указан дважды' });
  }

  if (!isExamGoal(goal)) {
    if (examCode !== null) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'У цели «подтянуть предметы» экзамена нет',
      });
    }

    if (unique.length === 0) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'Выберите хотя бы один предмет',
      });
    }

    const subjects = await subjectIdsByCodes(sql, unique);
    return {
      examId: null,
      examCode: null,
      subjects: subjects.map((subject) => ({ ...subject, isProfile: true })),
      examScope: null,
    };
  }

  if (examCode === null) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Для этой цели нужно выбрать экзамен',
      details: { goal },
    });
  }

  const exam = await findExam(sql, examCode);
  if (exam.goal !== goal) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Экзамен не относится к выбранной цели',
      details: { goal, exam_code: examCode, exam_goal: exam.goal },
    });
  }

  if (
    exam.gradeMin !== null &&
    exam.gradeMax !== null &&
    (grade < exam.gradeMin || grade > exam.gradeMax)
  ) {
    throw new AppError('VALIDATION_FAILED', {
      message: `«${exam.title}» рассчитан на ${exam.gradeMin}–${exam.gradeMax} класс`,
      details: { goal, exam_code: examCode, grade, grade_min: exam.gradeMin, grade_max: exam.gradeMax },
    });
  }

  const options = await listSubjectOptions(sql, examCode);
  const allowedProfile = new Set(options.profile.map((option) => option.code));

  if (unique.length !== exam.profileSlotCount) {
    throw new AppError('VALIDATION_FAILED', {
      message: `Нужно выбрать профильных предметов: ${exam.profileSlotCount}`,
      details: { expected: exam.profileSlotCount, received: unique.length },
    });
  }

  const notAllowed = unique.filter((code) => !allowedProfile.has(code));
  if (notAllowed.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Эти предметы нельзя выбрать для данного экзамена',
      details: { not_allowed: notAllowed, allowed: [...allowedProfile] },
    });
  }

  if (options.profilePairs.length > 0) {
    const chosen = [...unique].sort().join('+');
    const known = options.profilePairs.some(
      (pair) => [...pair.codes].sort().join('+') === chosen,
    );

    if (!known) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'Такой комбинации профильных предметов на экзамене нет',
        details: {
          chosen: unique,
          allowed_pairs: options.profilePairs.map((pair) => pair.codes),
        },
      });
    }
  }

  const mandatoryCodes = options.mandatory.map((option) => option.code);
  const resolved = await subjectIdsByCodes(sql, [...mandatoryCodes, ...unique]);
  const profileSet = new Set(unique);

  const [examRow] = await sql<{ id: string }[]>`
    select id from public.exam_profiles where code = ${examCode}
  `;

  return {
    examId: examRow?.id ?? null,
    examCode,
    subjects: resolved.map((subject) => ({
      ...subject,
      isProfile: profileSet.has(subject.code),
    })),
    examScope: { gradeMin: exam.gradeMin, gradeMax: exam.gradeMax },
  };
}

async function replaceSubjects(
  sql: SqlExecutor,
  studentId: string,
  selection: ResolvedSelection,
): Promise<void> {
  const keep = selection.subjects.map((subject) => subject.id);

  await sql`
    update public.student_subjects
       set removed_at = now()
     where student_id = ${studentId}
       and removed_at is null
       and not (subject_id = any(${keep}::uuid[]))
  `;

  for (const subject of selection.subjects) {
    await sql`
      insert into public.student_subjects (student_id, subject_id, is_profile)
      values (${studentId}, ${subject.id}, ${subject.isProfile})
      on conflict (student_id, subject_id) do update set
        is_profile = excluded.is_profile,
        removed_at = null
    `;
  }
}

export interface OnboardingResult {
  readonly goal: LearningGoal;
  readonly examCode: string | null;
  readonly subjects: { code: string; name: string; is_profile: boolean }[];
  readonly diagnostic: DiagnosticSummary | null;
  readonly diagnosticUnavailableReason: 'not_enough_questions' | null;
}

export async function completeOnboarding(
  sql: Sql,
  user: AuthUser,
  input: CompleteOnboardingRequest,
  requestId: string,
): Promise<OnboardingResult> {
  return sql.begin(async (tx) => {
    await tx`select id from public.profiles where id = ${user.id} for update`;

    const [current] = await tx<{ onboarding_completed_at: Date | null }[]>`
      select onboarding_completed_at from public.student_profiles where student_id = ${user.id}
    `;

    if (current?.onboarding_completed_at != null) {
      throw new AppError('STATE_CONFLICT', {
        message: 'Первичный опрос уже пройден',
        details: { hint: 'изменить цель и предметы можно через PATCH /v1/me/learning-profile' },
      });
    }

    const selection = await resolveSelection(
      tx,
      input.goal,
      input.exam_code,
      input.subject_codes,
      input.grade,
    );

    await tx`update public.profiles set grade = ${input.grade} where id = ${user.id}`;

    await tx`
      insert into public.student_profiles (
        student_id, goal, target_exam_id, target_date, onboarding_completed_at
      ) values (
        ${user.id}, ${input.goal}::public.learning_goal, ${selection.examId},
        ${input.target_date}, now()
      )
      on conflict (student_id) do update set
        goal = excluded.goal,
        target_exam_id = excluded.target_exam_id,
        target_date = excluded.target_date,
        onboarding_completed_at = coalesce(public.student_profiles.onboarding_completed_at, now())
    `;

    await replaceSubjects(tx, user.id, selection);

    const answers: JsonObject = {
      goal: input.goal,
      exam_code: input.exam_code,
      grade: input.grade,
      subject_codes: [...input.subject_codes],
      ...(input.answers === null ? {} : { raw: jsonObjectSchema.parse(input.answers) }),
    };

    await tx`
      insert into public.onboarding_answers (student_id, answers)
      values (${user.id}, ${tx.json(answers)})
      on conflict (student_id) do update set
        answers = excluded.answers, completed_at = now()
    `;

    const assembled = await assembleDiagnostic(
      tx,
      user.id,
      input.grade,
      selection.subjects.map((subject) => subject.id),
      curriculumScope({
        goal: input.goal,
        grade: input.grade,
        exam: selection.examScope,
      }),
    );

    await writeAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'onboarding.completed',
      entityType: 'student_profile',
      entityId: user.id,
      summary: {
        goal: input.goal,
        exam_code: input.exam_code,
        subjects: selection.subjects.length,
        diagnostic_questions: assembled.diagnostic?.question_count ?? 0,
        diagnostic_unavailable: assembled.unavailableReason,
      },
      requestId,
    });

    return {
      goal: input.goal,
      examCode: selection.examCode,
      subjects: selection.subjects.map((subject) => ({
        code: subject.code,
        name: subject.name,
        is_profile: subject.isProfile,
      })),
      diagnostic: assembled.diagnostic,
      diagnosticUnavailableReason: assembled.unavailableReason,
    };
  });
}

export async function updateLearningProfile(
  sql: Sql,
  user: AuthUser,
  input: UpdateLearningProfileRequest,
  requestId: string,
): Promise<OnboardingResult> {
  const [current] = await sql<
    {
      goal: LearningGoal | null;
      exam_code: string | null;
      onboarding_completed_at: Date | null;
      grade: number;
    }[]
  >`
    select sp.goal, e.code as exam_code, sp.onboarding_completed_at, p.grade
      from public.student_profiles sp
      join public.profiles p on p.id = sp.student_id
      left join public.exam_profiles e on e.id = sp.target_exam_id
     where sp.student_id = ${user.id}
  `;

  if (current?.onboarding_completed_at == null) {
    throw new AppError('ONBOARDING_INCOMPLETE');
  }

  const goal = input.goal ?? current.goal;
  if (goal === null) {
    throw new AppError('VALIDATION_FAILED', { message: 'Цель обучения не задана' });
  }

  const examCode = input.exam_code === undefined ? current.exam_code : input.exam_code;

  const existingSubjects = await sql<{ code: string }[]>`
    select s.code
      from public.student_subjects ss
      join public.subjects s on s.id = ss.subject_id
     where ss.student_id = ${user.id} and ss.removed_at is null and ss.is_profile
  `;

  const subjectCodes = input.subject_codes ?? existingSubjects.map((row) => row.code);

  return sql.begin(async (tx) => {
    const selection = await resolveSelection(tx, goal, examCode, subjectCodes, current.grade);

    await tx`
      update public.student_profiles
         set goal = ${goal}::public.learning_goal,
             target_exam_id = ${selection.examId},
             target_date = coalesce(${input.target_date ?? null}, target_date)
       where student_id = ${user.id}
    `;

    await replaceSubjects(tx, user.id, selection);

    await writeAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'learning_profile.updated',
      entityType: 'student_profile',
      entityId: user.id,
      summary: { goal, exam_code: selection.examCode, subjects: selection.subjects.length },
      requestId,
    });

    const [diagnostic] = await tx<{ id: string }[]>`
      select id from public.assessments
       where student_id = ${user.id} and kind = 'diagnostic' and is_active
       limit 1
    `;

    return {
      goal,
      examCode: selection.examCode,
      subjects: selection.subjects.map((subject) => ({
        code: subject.code,
        name: subject.name,
        is_profile: subject.isProfile,
      })),
      diagnostic: diagnostic === undefined ? null : await describeDiagnostic(tx, diagnostic.id),
      diagnosticUnavailableReason: null,
    };
  });
}
