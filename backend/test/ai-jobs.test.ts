import { describe, expect, it } from 'vitest';

import {
  MAX_CONCURRENT_WAITERS,
  WaiterGate,
} from '../src/modules/ai-jobs/service.js';

describe('счётчик отложенных запросов', () => {
  it('пускает до предела и не дальше', () => {
    const gate = new WaiterGate(2);

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.inFlight).toBe(2);
  });

  it('освобождённое место снова доступно', () => {
    const gate = new WaiterGate(1);

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.release();

    expect(gate.inFlight).toBe(0);
    expect(gate.tryAcquire()).toBe(true);
  });

  it('лишнее освобождение не уводит счётчик в минус', () => {
    const gate = new WaiterGate(1);

    gate.release();
    gate.release();

    expect(gate.inFlight).toBe(0);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
  });

  it('предел по умолчанию задан и не бесконечен', () => {
    expect(MAX_CONCURRENT_WAITERS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_CONCURRENT_WAITERS)).toBe(true);
  });
});
