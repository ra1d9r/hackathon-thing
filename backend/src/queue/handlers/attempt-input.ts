import { z } from 'zod';

import { PermanentJobError } from '../types.js';

const attemptInputSchema = z.object({ attempt_id: z.uuid() });

export function requireAttemptId(input: unknown): string {
  const parsed = attemptInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new PermanentJobError('во входе операции нет идентификатора попытки', 'BAD_INPUT');
  }

  return parsed.data.attempt_id;
}
