import { buildApp } from './app.js';
import { EnvValidationError, getEnv, loadDotEnv } from './env.js';

async function main(): Promise<void> {
  loadDotEnv();

  const env = getEnv();
  const app = await buildApp({ env });

  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, 'получен сигнал остановки');

    app
      .close()
      .then(() => {
        app.log.info('сервис остановлен');
        process.exit(0);
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'ошибка при остановке');
        process.exit(1);
      });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('unhandledRejection', (reason: unknown) => {
    app.log.error({ err: reason }, 'необработанное отклонение промиса');
  });

  await app.listen({ host: env.HOST, port: env.PORT });

  app.log.info(
    {
      env: env.NODE_ENV,
      openapi: `${env.API_BASE_URL}/v1/openapi.json`,
      docs: env.NODE_ENV === 'production' ? null : `${env.API_BASE_URL}/v1/docs`,
    },
    'Tlek backend запущен',
  );
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(78);
  }

  console.error(error);
  process.exit(1);
});
