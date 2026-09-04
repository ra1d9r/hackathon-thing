import { describe, expect, it } from 'vitest';

import {
  AppError,
  ERROR_CODES,
  buildErrorEnvelope,
  errorEnvelopeSchema,
  isErrorCode,
} from '../src/contracts/errors.js';
import { stableStringify } from '../src/contracts/json.js';

describe('таблица кодов ошибок', () => {
  it('у каждого кода валидный HTTP-статус', () => {
    for (const [code, spec] of Object.entries(ERROR_CODES)) {
      expect(spec.status, code).toBeGreaterThanOrEqual(400);
      expect(spec.status, code).toBeLessThan(600);
    }
  });

  it('у каждого кода непустое сообщение для пользователя', () => {
    for (const [code, spec] of Object.entries(ERROR_CODES)) {
      expect(spec.message.length, code).toBeGreaterThan(0);
    }
  });

  it('серверные ошибки повторяемы, клиентские — нет', () => {
    for (const [code, spec] of Object.entries(ERROR_CODES)) {
      if (spec.status >= 500) {
        expect(spec.retryable, `${code} должен быть повторяемым`).toBe(true);
      }
    }
  });

  it('повторяемыми среди 4xx считаются только исчерпание лимита и сбой разбора ответа ИИ', () => {
    const retryable4xx = Object.entries(ERROR_CODES)
      .filter(([, spec]) => spec.status < 500 && spec.retryable)
      .map(([code]) => code)
      .sort();

    expect(retryable4xx).toEqual(['AI_OUTPUT_INVALID', 'AI_QUOTA_EXCEEDED', 'RATE_LIMITED']);
  });

  it('распознаёт известные и неизвестные коды', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('НЕТ_ТАКОГО')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
  });
});

describe('AppError', () => {
  it('берёт статус и повторяемость из таблицы', () => {
    const error = new AppError('ATTEMPT_ALREADY_SUBMITTED');

    expect(error.status).toBe(409);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(ERROR_CODES.ATTEMPT_ALREADY_SUBMITTED.message);
    expect(AppError.is(error)).toBe(true);
  });

  it('позволяет переопределить сообщение и передать детали', () => {
    const error = new AppError('VALIDATION_FAILED', {
      message: 'Не выбран предмет',
      details: { field: 'subjects' },
    });

    expect(error.message).toBe('Не выбран предмет');
    expect(error.details).toEqual({ field: 'subjects' });
  });

  it('сохраняет причину, не показывая её наружу', () => {
    const cause = new Error('соединение разорвано');
    const error = new AppError('DB_UNAVAILABLE', { cause });

    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('соединение разорвано');
  });

  it('отличает себя от обычной ошибки', () => {
    expect(AppError.is(new Error('обычная'))).toBe(false);
    expect(AppError.is(null)).toBe(false);
  });
});

describe('конверт ошибки', () => {
  it('соответствует схеме и содержит идентификатор запроса', () => {
    const envelope = buildErrorEnvelope(new AppError('RATE_LIMITED'), 'req-1');

    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      request_id: 'req-1',
    });
  });

  it('не включает поле details, когда деталей нет', () => {
    const envelope = buildErrorEnvelope(new AppError('NOT_FOUND'), 'req-2');
    expect('details' in envelope.error).toBe(false);
  });

  it('включает детали, когда они переданы', () => {
    const envelope = buildErrorEnvelope(
      new AppError('VALIDATION_FAILED', { details: { field: 'grade' } }),
      'req-3',
    );

    expect(envelope.error.details).toEqual({ field: 'grade' });
  });
});

describe('stableStringify', () => {
  it('даёт одинаковую строку для объектов, различающихся порядком ключей', () => {
    const left = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const right = stableStringify({ a: { c: 3, d: 2 }, b: 1 });

    expect(left).toBe(right);
  });

  it('сохраняет порядок элементов массива', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('корректно обрабатывает null и вложенность', () => {
    expect(stableStringify({ a: null, b: [{ y: 1, x: 2 }] })).toBe('{"a":null,"b":[{"x":2,"y":1}]}');
  });
});
