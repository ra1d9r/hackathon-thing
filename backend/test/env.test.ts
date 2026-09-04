import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseEnv, requireEnv } from '../src/env.js';

describe('parseEnv', () => {
  it('подставляет значения по умолчанию для пустого окружения', () => {
    const env = parseEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.WORKER_ENABLED).toBe(true);
  });

  it('приводит числовые переменные к числам', () => {
    const env = parseEnv({ PORT: '8080', RATE_LIMIT_MAX: '42' });

    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_MAX).toBe(42);
  });

  it('разбирает список источников CORS и игнорирует пустые элементы', () => {
    const env = parseEnv({ CORS_ORIGINS: 'http://a.test, http://b.test ,,' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('превращает незаполненные необязательные переменные в undefined', () => {
    const env = parseEnv({ SUPABASE_URL: '', AI_API_KEY: '   ' });

    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.AI_API_KEY).toBeUndefined();
  });

  it('падает при некорректном порте и перечисляет все проблемы сразу', () => {
    let caught: unknown;
    try {
      parseEnv({ PORT: '99999', MIN_CLIENT_VERSION: 'не-версия', NODE_ENV: 'staging' });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    if (caught instanceof EnvValidationError) {
      expect(caught.issues).toHaveLength(3);
      expect(caught.issues.join(' ')).toContain('PORT');
      expect(caught.issues.join(' ')).toContain('MIN_CLIENT_VERSION');
      expect(caught.issues.join(' ')).toContain('NODE_ENV');
    }
  });

  it('отвергает нечисловой адрес API', () => {
    expect(() => parseEnv({ API_BASE_URL: 'не ссылка' })).toThrow(EnvValidationError);
  });

  it('возвращает замороженный объект — конфигурацию нельзя менять на ходу', () => {
    const env = parseEnv({});
    expect(Object.isFrozen(env)).toBe(true);
  });
});

describe('requireEnv', () => {
  it('возвращает значение, когда переменная задана', () => {
    const env = parseEnv({ AI_API_KEY: 'ключ' });
    expect(requireEnv(env, 'AI_API_KEY', 'AI-слой')).toBe('ключ');
  });

  it('падает с понятным сообщением, когда переменная нужна, но не задана', () => {
    const env = parseEnv({});

    expect(() => requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY', 'доступ к базе')).toThrow(
      /доступ к базе/,
    );
  });
});
