import type { Env } from '../env.js';
import { createModelCaller } from './client.js';
import { withLimits } from './limits.js';
import type { ModelCaller } from './types.js';

export interface AiRuntime {
  readonly caller: ModelCaller;
  
  readonly dailyQuota: number;
}

export function createAiRuntime(env: Env): AiRuntime | null {
  if (!env.AI_ENABLED || env.AI_API_KEY === undefined) {
    return null;
  }

  return {
    caller: withLimits(createModelCaller(env), env),
    dailyQuota: env.AI_DAILY_QUOTA_PER_STUDENT,
  };
}
