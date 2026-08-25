import type { Env } from '../env.js';
import type { SqlExecutor } from '../db/sql.js';
import { ModelError, type ModelCaller, type ModelRequest, type ModelResponse } from './types.js';



class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    next?.();
  }
}


class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
  ) {
    this.tokens = capacity;
  }

  
  take(): number {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.lastRefill = now;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 60_000) * this.perMinute);

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }

    return Math.ceil(((1 - this.tokens) / this.perMinute) * 60_000);
  }
}


export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  
  allows(): boolean {
    if (this.openedAt === null) {
      return true;
    }
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      
      
      this.openedAt = null;
      this.failures = this.threshold - 1;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = Date.now();
    }
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}


export function withLimits(caller: ModelCaller, env: Env): ModelCaller {
  const semaphore = new Semaphore(env.AI_MAX_CONCURRENCY);
  const bucket = new TokenBucket(env.AI_RPM, env.AI_RPM);
  const breaker = new CircuitBreaker(env.AI_BREAKER_FAILURES, env.AI_BREAKER_COOLDOWN_MS);

  return {
    modelFor: (opType) => caller.modelFor(opType),

    async call(request: ModelRequest): Promise<ModelResponse> {
      if (!breaker.allows()) {
        throw new ModelError('transient', 'провайдер недоступен, предохранитель разомкнут', {
          code: 'CIRCUIT_OPEN',
        });
      }

      const wait = bucket.take();
      if (wait > 0) {
        await delay(wait);
      }

      await semaphore.acquire();

      try {
        const response = await caller.call(request);
        breaker.recordSuccess();
        return response;
      } catch (error: unknown) {
        
        
        if (!ModelError.is(error) || error.kind !== 'refusal') {
          breaker.recordFailure();
        }
        throw error;
      } finally {
        semaphore.release();
      }
    },
  };
}


export async function quotaExceeded(
  sql: SqlExecutor,
  studentId: string | null,
  limit: number,
): Promise<boolean> {
  if (studentId === null) {
    return false;
  }

  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from public.ai_jobs
     where student_id = ${studentId}
       and created_at >= date_trunc('day', now())
       and status in ('succeeded','running','queued','awaiting_retry')
  `;

  return (row?.n ?? 0) > limit;
}
