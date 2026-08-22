import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export const REQUEST_ID_HEADER = 'x-request-id';

async function requestContextPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader(REQUEST_ID_HEADER)) {
      reply.header(REQUEST_ID_HEADER, request.id);
    }
  });
}

export default fp(requestContextPlugin, {
  name: 'request-context',
  fastify: '5.x',
});
