// Проверяет доступность всех ботов каталога через их t.me-страницы.
//
// Как это работает: у живого хендла og:title содержит его отображаемое имя
// (например, "BotFather"), а у несуществующего — заглушку вида
// "Telegram: Contact @handle". Ошибки сети помечаются отдельно ("unreachable")
// и не считаются мёртвыми ботами.
//
// Запуск: node scripts/check-links.mjs [--out link-report.md]
// Выход: отчёт в Markdown (пустой файл/поток, если проблем нет), exit 0 всегда.
import { writeFileSync } from 'node:fs';
import { isMissingBotPage, loadBots } from './lib.mjs';

const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20000;
const BATCH_PAUSE_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(handle, attempt = 1) {
  const url = `https://t.me/${handle}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (link-checker; +https://github.com/wwewtech/vpn_telegram_2026)' },
    });
    if (!response.ok) return { handle, status: 'unreachable', detail: `HTTP ${response.status}` };
    const html = await response.text();
    if (isMissingBotPage(html, handle)) {
      return { handle, status: 'dead', detail: 'страница-заглушка «Contact» — хендл не существует' };
    }
    return { handle, status: 'ok' };
  } catch (error) {
    if (attempt < 2) {
      await sleep(2000);
      return fetchPage(handle, attempt + 1);
    }
    return { handle, status: 'unreachable', detail: String(error && error.message ? error.message : error) };
  }
}

async function checkAll(bots) {
  const results = [];
  for (let index = 0; index < bots.length; index += CONCURRENCY) {
    const batch = bots.slice(index, index + CONCURRENCY);
    const settled = await Promise.all(batch.map((bot) => fetchPage(bot.handle)));
    results.push(...settled);
    const done = Math.min(index + CONCURRENCY, bots.length);
    console.log(`Проверено ${done}/${bots.length}...`);
    if (done < bots.length) await sleep(BATCH_PAUSE_MS);
  }
  return results;
}

function renderReport(results, checkedAt) {
  const dead = results.filter((item) => item.status === 'dead');
  const unreachable = results.filter((item) => item.status === 'unreachable');
  if (dead.length === 0 && unreachable.length === 0) return '';
  const lines = [`## Автопроверка ссылок: ${checkedAt}`, ``, `Проверено ботов: ${results.length}. Подозрительных: ${dead.length}.`];
  if (dead.length > 0) {
    lines.push(
      ``,
      `### Возможно удалены (${dead.length})`,
      ``,
      `| Бот | Ссылка | Статус |`,
      `| --- | --- | --- |`,
      ...dead.map((item) => `| @${item.handle} | https://t.me/${item.handle} | ${item.detail} |`),
    );
  }
  if (unreachable.length > 0) {
    lines.push(
      ``,
      `### Не удалось проверить (${unreachable.length}) — нужен ручной взгляд, а не удаление`,
      ``,
      ...unreachable.map((item) => `- @${item.handle}: ${item.detail}`),
    );
  }
  lines.push(
    ``,
    `Это автоматический отчёт (еженедельный). Проверьте ботов вручную: если бот действительно мёртв — удалите запись из \`data/bots.json\` и выполните \`npm run fix\`.`,
  );
  return `${lines.join('\n')}\n`;
}

const bots = loadBots();
const results = await checkAll(bots);
const dead = results.filter((item) => item.status === 'dead');
const unreachable = results.filter((item) => item.status === 'unreachable');
const report = renderReport(results, new Date().toISOString().slice(0, 10));

const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && process.argv[outIndex + 1]) {
  writeFileSync(process.argv[outIndex + 1], report, 'utf8');
} else {
  process.stdout.write(report);
}

console.log(`Итог: проверено ${results.length}, мёртвых: ${dead.length}, недоступных: ${unreachable.length}.`);
