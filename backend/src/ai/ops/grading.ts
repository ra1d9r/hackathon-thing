import { gradingEnvelopeSchema, gradingResultSchema } from '../../contracts/ai/grading.js';
import { toResponseSchema } from '../../contracts/ai/envelope.js';
import { clamp, roundTo } from '../../contracts/domain.js';
import {
  contradictsExpectedNumbers,
  scanForInjection,
  SUSPICIOUS_TRUST_FACTOR,
  wrapUntrusted,
} from '../guard.js';
import { operationBlock, schemaBlock, systemCoreBlock } from '../prompt.js';
import { callAndValidate, type CallLogEntry, type ModelFailureReason } from '../validate.js';
import type { ModelCaller, PromptBlock } from '../types.js';
const TEMPERATURE = 0;

const MAX_TOKENS = 6_000;

const RESPONSE_SCHEMA = toResponseSchema(gradingResultSchema, 'grading_result');

export interface GradingCandidate {
  readonly questionId: string;
  readonly promptMd: string;
  readonly rubricMd: string | null;
  readonly points: number;
  readonly expectedPoints: readonly string[];
  readonly answerText: string;
}

export interface GradedAnswer {
  readonly questionId: string;
  readonly pointsAwarded: number;
  readonly isCorrect: boolean;
  readonly feedbackMd: string;
  readonly confidence: number;
  
  readonly lowTrust: boolean;
}

export interface GradingOutcome {
  
  readonly answers: readonly GradedAnswer[] | null;
  
  readonly calls: readonly CallLogEntry[];
  
  readonly failure: ModelFailureReason | null;
  readonly reason: string | null;
  
  readonly repairedBecause: string | null;
  readonly suspiciousCount: number;
  readonly lowTrustCount: number;
}

function buildBlocks(candidates: readonly GradingCandidate[]): PromptBlock[] {
  const tasks = candidates.map((candidate, index) =>
    [
      `### Ответ ${index + 1}`,
      `question_id: ${candidate.questionId}`,
      `Максимум баллов: ${candidate.points}`,
      '',
      'Задание:',
      candidate.promptMd,
      '',
      'Критерии оценивания:',
      candidate.rubricMd ?? 'Критерии не заданы — оценивай по существу задания.',
      '',
      'Ответ ученика:',
      wrapUntrusted('student_answer', candidate.questionId, candidate.answerText),
    ].join('\n'),
  );

  return [
    systemCoreBlock(),
    schemaBlock(RESPONSE_SCHEMA),
    operationBlock(
      [
        'ЗАДАЧА: оцени свободные ответы ученика.',
        '',
        'Для каждого ответа верни долю от максимума (score_ratio от 0 до 1),',
        'признак правильности, краткую обратную связь и свою уверенность.',
        'Баллы не считай — их посчитает система, умножив долю на цену вопроса.',
        'Обратная связь: 1–3 предложения, по-русски, что верно и что поправить.',
        '',
        `Ответов: ${candidates.length}. Верни ровно столько же элементов,`,
        'с теми же question_id, что перечислены ниже.',
        '',
        ...tasks,
      ].join('\n'),
    ),
  ];
}

export async function gradeFreeText(
  caller: ModelCaller,
  candidates: readonly GradingCandidate[],
): Promise<GradingOutcome> {
  if (candidates.length === 0) {
    return {
      answers: [],
      calls: [],
      failure: null,
      reason: null,
      repairedBecause: null,
      suspiciousCount: 0,
      lowTrustCount: 0,
    };
  }

  const blocks = buildBlocks(candidates);

  const outcome = await callAndValidate({
    caller,
    schema: gradingEnvelopeSchema,
    request: {
      opType: 'free_text_grading',
      blocks,
      schema: RESPONSE_SCHEMA,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    },
  });

  if (!outcome.ok) {
    return {
      answers: null,
      calls: outcome.calls,
      failure: outcome.reason,
      reason: outcome.message,
      repairedBecause: null,
      suspiciousCount: 0,
      lowTrustCount: 0,
    };
  }

  const byId = new Map(candidates.map((candidate) => [candidate.questionId, candidate]));
  const seen = new Set<string>();
  const answers: GradedAnswer[] = [];

  let suspiciousCount = 0;
  let lowTrustCount = 0;

  for (const graded of outcome.data.answers) {
    const candidate = byId.get(graded.question_id);

    
    
    if (candidate === undefined || seen.has(graded.question_id)) {
      continue;
    }
    seen.add(graded.question_id);

    const injection = scanForInjection(candidate.answerText);
    const ratio = clamp(graded.score_ratio, 0, 1);

    
    
    const diverged = contradictsExpectedNumbers(
      candidate.answerText,
      candidate.expectedPoints,
      ratio,
    );

    if (injection.suspicious) {
      suspiciousCount += 1;
    }

    const lowTrust = diverged || injection.suspicious;
    if (lowTrust) {
      lowTrustCount += 1;
    }

    answers.push({
      questionId: graded.question_id,
      pointsAwarded: roundTo(ratio * candidate.points, 2),
      isCorrect: graded.is_correct,
      feedbackMd: graded.feedback_md,
      
      
      confidence: roundTo(
        clamp(graded.confidence * (lowTrust ? SUSPICIOUS_TRUST_FACTOR : 1), 0, 1),
        2,
      ),
      lowTrust,
    });
  }

  return {
    answers,
    calls: outcome.calls,
    failure: null,
    reason: null,
    repairedBecause: outcome.repairedBecause,
    suspiciousCount,
    lowTrustCount,
  };
}
