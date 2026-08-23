import type { Sql } from '../db/sql.js';

export const JOB_CHANNEL = 'ai_job_done';

export const SAFETY_POLL_MS = 2_000;

type Waiter = () => void;

export class JobNotifyHub {
  private readonly waiters = new Map<string, Set<Waiter>>();
  private unlisten: (() => Promise<void>) | null = null;
  private starting: Promise<void> | null = null;

  get listening(): boolean {
    return this.unlisten !== null;
  }

  async start(sql: Sql): Promise<void> {
    if (this.unlisten !== null) {
      return;
    }

    this.starting ??= sql
      .listen(JOB_CHANNEL, (payload) => {
        this.release(payload);
      })
      .then((meta) => {
        this.unlisten = async () => {
          await meta.unlisten();
        };
      })
      .finally(() => {
        this.starting = null;
      });

    await this.starting;
  }

  async stop(): Promise<void> {
    const unlisten = this.unlisten;
    this.unlisten = null;

    for (const [jobId, waiters] of this.waiters) {
      for (const waiter of waiters) {
        waiter();
      }
      this.waiters.delete(jobId);
    }

    if (unlisten !== null) {
      await unlisten();
    }
  }

  private release(jobId: string): void {
    const waiters = this.waiters.get(jobId);
    if (waiters === undefined) {
      return;
    }
    this.waiters.delete(jobId);
    for (const waiter of waiters) {
      waiter();
    }
  }

  async wait(jobId: string, timeoutMs: number): Promise<boolean> {
    if (timeoutMs <= 0) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const waiter: Waiter = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.remove(jobId, waiter);
        resolve(true);
      };

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.remove(jobId, waiter);
        resolve(false);
      }, timeoutMs);

      timer.unref();

      const existing = this.waiters.get(jobId);
      if (existing === undefined) {
        this.waiters.set(jobId, new Set([waiter]));
      } else {
        existing.add(waiter);
      }
    });
  }

  private remove(jobId: string, waiter: Waiter): void {
    const waiters = this.waiters.get(jobId);
    if (waiters === undefined) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.waiters.delete(jobId);
    }
  }
}
