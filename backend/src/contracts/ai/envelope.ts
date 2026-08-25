import { z } from 'zod';

import type { JsonObject } from '../json.js';
import { isJsonObject } from '../json.js';




export const AI_CONTRACT_VERSION = 1;

export function aiEnvelope<Schema extends z.ZodType>(
  data: Schema,
): z.ZodObject<{
  op: z.ZodDefault<z.ZodString>;
  contract_version: z.ZodDefault<z.ZodLiteral<typeof AI_CONTRACT_VERSION>>;
  insufficient_context: z.ZodDefault<z.ZodBoolean>;
  data: Schema;
  notes: z.ZodOptional<z.ZodString>;
}> {
  return z
    .object({
      
      
      
      op: z.string().default(''),
      contract_version: z.literal(AI_CONTRACT_VERSION).default(AI_CONTRACT_VERSION),
      
      insufficient_context: z.boolean().default(false),
      data,
      notes: z.string().max(1000).optional(),
    })
    .strict();
}


export function toResponseSchema(schema: z.ZodType, name: string): {
  name: string;
  schema: JsonObject;
} {
  const generated: unknown = z.toJSONSchema(schema, { io: 'output' });

  if (!isJsonObject(generated)) {
    throw new TypeError(`не удалось построить JSON-schema для операции ${name}`);
  }

  return { name, schema: generated };
}
