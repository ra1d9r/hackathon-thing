import { ContentValidationError, loadContent, type LoadReport } from '../src/content/loader.js';
import { createSqlClient, DEFAULT_WORKER_STATEMENT_TIMEOUT_MS } from '../src/db/sql.js';
import { EnvValidationError, getEnv, loadDotEnv } from '../src/env.js';



function printReport(report: LoadReport, checkOnly: boolean): void {
  console.log(checkOnly ? 'Проверено (в базу ничего не записано):' : 'Загружено:');
  console.log(`  предметов        ${report.subjects}`);
  console.log(`  тем              ${report.topics}`);
  console.log(`  связей тем       ${report.prerequisites}`);
  console.log(`  целей            ${report.goals}`);
  console.log(`  экзаменов        ${report.exams}`);
  console.log(`  уроков           ${report.lessons}`);
  console.log(`  вопросов         ${report.questions}`);
  console.log(`  пробников        ${report.mocks}`);

  if (report.retired > 0) {
    console.log(
      `\n  снято с публикации: ${report.retired} — этих вопросов больше нет в файлах.` +
        '\n  Пройденные попытки с ними по-прежнему читаются, в новые тесты они не попадут.',
    );
  }

  if (report.placeholders.length === 0) {
    return;
  }

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`ЗАГОТОВКИ (${report.placeholders.length}) — это временное содержимое.`);
  console.log('Система на нём работает целиком, но учебной ценности в нём нет.');
  console.log('─'.repeat(72));

  for (const placeholder of report.placeholders) {
    console.log(`\n  supabase/content/${placeholder.file}`);
    console.log(`    ${placeholder.note}`);
  }

  console.log('\nЧек-лист замены: supabase/content/PLACEHOLDERS.md');
  console.log('─'.repeat(72));
}

async function main(): Promise<void> {
  loadDotEnv();

  const checkOnly = process.argv.includes('--check');

  const sql = createSqlClient(getEnv(), {
    statementTimeoutMs: DEFAULT_WORKER_STATEMENT_TIMEOUT_MS,
    maxConnections: 1,
  });

  try {
    if (!checkOnly) {
      printReport(await loadContent(sql), false);
      return;
    }

    
    
    
    const reserved = await sql.reserve();

    try {
      await reserved.unsafe('begin');
      const report = await loadContent(reserved);
      await reserved.unsafe('rollback');
      printReport(report, true);
    } catch (error: unknown) {
      await reserved.unsafe('rollback').catch(() => undefined);
      throw error;
    } finally {
      reserved.release();
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ContentValidationError || error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(78);
  }
  console.error(error);
  process.exit(1);
});
