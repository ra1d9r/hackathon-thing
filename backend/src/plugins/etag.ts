import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyReply {
    sendCached(payload: unknown, options?: CacheOptions): FastifyReply;
  }
}

export interface CacheOptions {
  readonly maxAgeSec?: number;
}

const DEFAULT_MAX_AGE_SEC = 30;

export function weakEtag(payload: unknown): string {
  const serialized = JSON.stringify(payload, (key, value: unknown) =>
    key === 'computed_at' ? undefined : value,
  );

  return `W/"${createHash('sha1').update(serialized).digest('base64url')}"`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function matches(header: string | undefined, etag: string): boolean {
  if (header === undefined) {
    return false;
  }

  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag);
}

async function etagPlugin(app: FastifyInstance): Promise<void> {
  app.decorateReply('sendCached', function sendCached(
    this: FastifyReply,
    payload: unknown,
    options: CacheOptions = {},
  ): FastifyReply {
    const etag = weakEtag(payload);
    const maxAge = options.maxAgeSec ?? DEFAULT_MAX_AGE_SEC;

    void this.header('etag', etag);
    void this.header('cache-control', `private, max-age=${maxAge}, must-revalidate`);

    if (matches(firstHeader(this.request.headers['if-none-match']), etag)) {
      return this.status(304).send();
    }

    return this.send(payload);
  });
}

export default fp(etagPlugin, {
  name: 'etag',
  fastify: '5.x',
});
