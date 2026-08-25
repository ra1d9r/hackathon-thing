

import { normalizeTimeZone } from '../contracts/domain.js';

export function resolveTimeZone(timezone: string | null | undefined): string {
  if (timezone === null || timezone === undefined) {
    return 'UTC';
  }

  return normalizeTimeZone(timezone) ?? 'UTC';
}

export function localDate(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: resolveTimeZone(timezone) }).format(now);
}
