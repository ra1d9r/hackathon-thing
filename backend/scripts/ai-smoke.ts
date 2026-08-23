import { randomUUID } from 'node:crypto';

import { createModelCaller } from '../src/ai/client.js';
import { withLimits } from '../src/ai/limits.js';
import { gradeFreeText } from '../src/ai/ops/grading.js';
import { EnvValidationError, getEnv, loadDotEnv } from '../src/env.js';

async function main(): Promise<void> {
  loadDotEnv();
  const env = getEnv();

  if (env.AI_API_KEY === undefined) {
    console.error('AI_API_KEY не задан — проверять нечего.');
    process.exitCode = 78;
    return;
  }

  console.log(`Модель: ${env.AI_MODEL}`);
  console.log(`Формат ответа: ${env.AI_RESPONSE_FORMAT}\n`);

  const caller = withLimits(createModelCaller(env), env);
  const questionId = randomUUID();
  const startedAt = Date.now();

  const outcome = await gradeFreeText(caller, [
    {
      questionId,
      promptMd:
        'В коробке 5 белых и 3 чёрных шара. Наугад вынимают один. Найдите вероятность, ' +
        'что он белый, и объясните ход решения.',
      rubricMd:
        'Полный балл (3): получено 5/8 и объяснено, что это отношение благоприятных ' +
        'исходов к общему числу. Частичный (2): верный ответ без объяснения. ' +
        'Частичный (1): верно указано общее число шаров. Ноль: ответ неверен.',
      points: 3,
      expectedPoints: ['вероятность равна 5/8', 'всего шаров 8'],
      answerText:
        'Всего шаров 8, из них белых 5. Значит вероятность равна 5/8, то есть 0,625. ' +
        'Это отношение числа благоприятных исходов к общему числу исходов.',
    },
  ]);

  for (const call of outcome.calls) {
    console.log(
      `вызов ${call.attemptNo}: ok=${String(call.ok)} ` +
        `http=${String(call.httpStatus)} stop=${String(call.stopReason)} ` +
        `токены ${String(call.usage?.input)}/${String(call.usage?.output)} ` +
        `кэш ${String(call.usage?.cacheRead)} ` +
        `${String(call.latencyMs)} мс` +
        (call.errorCode === null ? '' : `  ошибка=${call.errorCode}`),
    );
  }

  if (outcome.answers === null) {
    console.error(`\nОценка не получена: ${outcome.failure ?? ''} — ${outcome.reason ?? ''}`);
    process.exitCode = 1;
    return;
  }

  const [answer] = outcome.answers;
  if (answer === undefined) {
    console.error('\nМодель не вернула ни одной оценки.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nБаллов из 3: ${answer.pointsAwarded}`);
  console.log(`Верно: ${String(answer.isCorrect)}`);
  console.log(`Уверенность: ${answer.confidence}`);
  console.log(`Пониженное доверие: ${String(answer.lowTrust)}`);
  console.log(`Обратная связь: ${answer.feedbackMd}`);
  console.log(`\nВсего: ${String(Date.now() - startedAt)} мс`);
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(78);
  }
  console.error(error);
  process.exit(1);
});
