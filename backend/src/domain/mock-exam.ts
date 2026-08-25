

export type SlotKind = 'mandatory' | 'profile';

export interface BlueprintSection {
  readonly slotKind: SlotKind;
  readonly slotIndex: number;
  
  readonly subjectId: string | null;
  readonly maxPoints: number;
  
  readonly questionCount: number | null;
}

export interface MockCandidate {
  readonly questionId: string;
  readonly subjectId: string;
  readonly topicId: string;
  readonly difficulty: number;
  readonly points: number;
}

export interface AssembledSection {
  readonly slotKind: SlotKind;
  readonly slotIndex: number;
  readonly subjectId: string;
  readonly questionIds: readonly string[];
  
  readonly requested: number | null;
}

export interface AssembledMock {
  readonly sections: readonly AssembledSection[];
  readonly questionIds: readonly string[];
  
  readonly shortfall: readonly {
    readonly slotKind: SlotKind;
    readonly slotIndex: number;
    readonly subjectId: string;
    readonly requested: number;
    readonly available: number;
  }[];
}

export interface AssembleInput {
  readonly sections: readonly BlueprintSection[];
  
  readonly candidates: ReadonlyMap<string, readonly MockCandidate[]>;
  
  readonly profileSubjectIds: readonly string[];
  
  readonly seed: string;
}

function shuffleKey(seed: string, questionId: string): number {
  let hash = 2_166_136_261;
  const source = `${seed}:${questionId}`;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) / 2 ** 32;
}

function pickSection(
  candidates: readonly MockCandidate[],
  requested: number | null,
  seed: string,
): MockCandidate[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      a.difficulty - b.difficulty ||
      shuffleKey(seed, a.questionId) - shuffleKey(seed, b.questionId) ||
      a.questionId.localeCompare(b.questionId),
  );

  if (requested === null || ordered.length <= requested) {
    return ordered;
  }

  
  
  const step = ordered.length / requested;
  const picked: MockCandidate[] = [];
  const taken = new Set<number>();

  for (let index = 0; index < requested; index += 1) {
    let position = Math.min(ordered.length - 1, Math.floor(index * step));
    while (taken.has(position) && position < ordered.length - 1) {
      position += 1;
    }
    if (taken.has(position)) {
      continue;
    }
    taken.add(position);
    const candidate = ordered[position];
    if (candidate !== undefined) {
      picked.push(candidate);
    }
  }

  return picked;
}

export function assembleMock(input: AssembleInput): AssembledMock {
  const sections: AssembledSection[] = [];
  const shortfall: {
    slotKind: SlotKind;
    slotIndex: number;
    subjectId: string;
    requested: number;
    available: number;
  }[] = [];
  const questionIds: string[] = [];
  const used = new Set<string>();

  const ordered = [...input.sections].sort(
    (a, b) =>
      (a.slotKind === 'mandatory' ? 0 : 1) - (b.slotKind === 'mandatory' ? 0 : 1) ||
      a.slotIndex - b.slotIndex,
  );

  for (const section of ordered) {
    const subjectId =
      section.subjectId ?? input.profileSubjectIds[section.slotIndex - 1] ?? null;

    if (subjectId === null) {
      continue;
    }

    
    
    
    const pool = (input.candidates.get(subjectId) ?? []).filter(
      (candidate) => !used.has(candidate.questionId),
    );

    const picked = pickSection(pool, section.questionCount, input.seed);
    for (const candidate of picked) {
      used.add(candidate.questionId);
      questionIds.push(candidate.questionId);
    }

    sections.push({
      slotKind: section.slotKind,
      slotIndex: section.slotIndex,
      subjectId,
      questionIds: picked.map((candidate) => candidate.questionId),
      requested: section.questionCount,
    });

    if (section.questionCount !== null && picked.length < section.questionCount) {
      shortfall.push({
        slotKind: section.slotKind,
        slotIndex: section.slotIndex,
        subjectId,
        requested: section.questionCount,
        available: picked.length,
      });
    }
  }

  return { sections, questionIds, shortfall };
}

export interface SectionOutcome {
  readonly slotKind: SlotKind;
  readonly slotIndex: number;
  readonly subjectId: string;
  readonly pointsEarned: number;
  readonly pointsPossible: number;
  
  readonly maxPoints: number;
}

export interface ScaledSection extends SectionOutcome {
  
  readonly scaled: number;
}

export function scaleSections(outcomes: readonly SectionOutcome[]): ScaledSection[] {
  return outcomes.map((outcome) => ({
    ...outcome,
    scaled:
      outcome.pointsPossible <= 0
        ? 0
        : Math.round((outcome.pointsEarned / outcome.pointsPossible) * outcome.maxPoints * 100) /
          100,
  }));
}

export function totalScaledScore(sections: readonly ScaledSection[]): number {
  return Math.round(sections.reduce((sum, section) => sum + section.scaled, 0) * 100) / 100;
}
