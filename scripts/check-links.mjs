// Проверяет доступность всех ботов каталога через их t.me-страницы.
//
// Как это работает: у живого хендла og:title содержит его отображаемое имя
// (например, "BotFather"), а у несуществующего — заглушку вида
// "Telegram: Contact @handle". Ошибки сети помечаются отдельно ("unreachable")
// и не считаются мёртвыми ботами.
//
// Запуск: node scripts/check-links.mjs [--out link-report.md] [--no-fail] [--stamp-verified]
// Выход: отчёт в Markdown (пустой файл/поток, если проблем нет).
//        exit 1, если найдены мёртвые боты или сломался сам метод (отчёт уже записан);
//        --no-fail всегда возвращает 0.
//        Недоступные (unreachable) не считаются ошибкой — это сеть, а не мёртвый бот.
//
// --stamp-verified: живым ботам проставляется "verified": "YYYY-MM" (месяц проверки)
//        в data/bots.json, у мёртвых — снимается. Затем данные сортируются и README
//        пересобирается (npm run fix). В README появляется колонка «Проверено».
//
// Самопроверка метода (канарейка): перед стартом скрипт проверяет две заведомо известные
// страницы t.me — живую (BotFather) и несуществующую. Если t.me сменит разметку и метод
// перестанет их различать, проверка завершится ошибкой метода, а не молчаливым «все живы».
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DATA_PATH,
  applyVerified,
  isMissingBotPage,
  isTmeMarkupUnrecognized,
  isWellFormed,
  loadBots,
  serializeBots,
  sortBots,
} from './lib.mjs';

const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20000;
const BATCH_PAUSE_MS = 200;
const CANARY_DEAD = 'zzz_dead_bot_2026_xyz'; // не существует и не должен существовать
const CANARY_LIVE = 'BotFather'; // официальный бот Telegram, существует с 2015 года

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const USER_AGENT = 'Mozilla/5.0 (link-checker; +https://github.com/wwewtech/vpn_telegram_2026)';

async function fetchPage(handle, attempt = 1) {
  const url = `https://t.me/${handle}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
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

async function fetchTme(handle) {
  const response = await fetch(`https://t.me/${handle}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// Канарейка метода: живая страница должна распознаваться разметкой (og:title + og:description),
// мёртвая — распознаваться заглушкой «Contact». Любое отклонение = метод больше не надёжен.
async function checkCanary() {
  try {
    const liveHtml = await fetchTme(CANARY_LIVE);
    if (isTmeMarkupUnrecognized(liveHtml)) {
      return { ok: false, detail: `живая страница @${CANARY_LIVE} не распознана (нет og:title или og:description пуст)` };
    }
    if (isMissingBotPage(liveHtml, CANARY_LIVE)) {
      return { ok: false, detail: `живая страница @${CANARY_LIVE} ошибочно распознана как заглушка «Contact»` };
    }
  } catch (error) {
    return { ok: false, detail: `живая канарейка @${CANARY_LIVE}: ${String(error && error.message ? error.message : error)}` };
  }
  try {
    const deadHtml = await fetchTme(CANARY_DEAD);
    if (!isMissingBotPage(deadHtml, CANARY_DEAD)) {
      return { ok: false, detail: `несуществующий хендл @${CANARY_DEAD} не распознан как «Contact» (мёртвые боты будут считаться живыми)` };
    }
  } catch (error) {
    return { ok: false, detail: `мёртвая канарейка @${CANARY_DEAD}: ${String(error && error.message ? error.message : error)}` };
  }
  return { ok: true };
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

if (!isWellFormed(bots)) {
  console.error('Ошибка: в data/bots.json есть записи без строкового поля "handle" — запускайте npm run validate для деталей.');
  process.exit(1);
}

const canary = await checkCanary();
if (!canary.ok) {
  const message = `Самопроверка метода не пройдена: ${canary.detail}.`;
  console.error(`Ошибка метода: ${message}`);
  console.error('Разметка t.me, вероятно, изменилась — результаты проверки были бы недостоверны. Проверьте метод вручную.');
  const outIndex = process.argv.indexOf('--out');
  if (outIndex !== -1 && process.argv[outIndex + 1]) {
    writeFileSync(
      process.argv[outIndex + 1],
      `## Автопроверка ссылок: сбой метода\n\n${message}\nРазметка t.me, вероятно, изменилась — список ботов не проверялся, доверять прошлым результатам нельзя.\n`,
      'utf8',
    );
  } else {
    process.stdout.write(`## Автопроверка ссылок: сбой метода\n\n${message}\n`);
  }
  process.exit(1);
}

const results = await checkAll(bots);
const dead = results.filter((item) => item.status === 'dead');
const unreachable = results.filter((item) => item.status === 'unreachable');
const report = renderReport(results, new Date().toISOString().slice(0, 10));

// Отчёт записывается ДО stamp-блока: он зависит только от results, а stamp
// (запись данных + пересборка README) может упасть — при старом порядке
// падение пересборки оставляло CI без отчёта, и шаг Issue в workflow
// уходил в ветку «файл пуст → все ссылки доступны» — ложное «все живы»
// при фактически неизвестном состоянии и закрытие issue о мёртвых ботах.
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && process.argv[outIndex + 1]) {
  writeFileSync(process.argv[outIndex + 1], report, 'utf8');
} else {
  process.stdout.write(report);
}

// Автопроставление verified: только по итогам полной проверки, без мёртвых.
// При найденных мёртвых ботах данные не обновляем — сначала ручное решение по каждому.
// Порядок записи: data/bots.json → пересборка README (generate-readme.mjs синхронизирует
// и README_EN.md). Если пересборка упадёт, данные уже записаны, README отстанет —
// следующий npm run fix / validate это поймает и выправит, полуданных не возникнет
// (данные без README валидны, README без данных — нет). Отчёт к этому моменту
// уже записан — CI не останется без отчёта.
if (process.argv.includes('--stamp-verified') && dead.length === 0) {
  const checkedMonth = new Date().toISOString().slice(0, 7);
  const { bots: stamped, changed } = applyVerified(bots, results, checkedMonth);
  if (changed > 0) {
    writeFileSync(DATA_PATH, serializeBots(sortBots(stamped)), 'utf8');
    console.log(`verified: обновлено ${changed} записей (${checkedMonth}) — пересобираю README...`);
    execFileSync(process.execPath, [fileURLToPath(new URL('./generate-readme.mjs', import.meta.url))], { stdio: 'inherit' });
    console.log(`verified: data/bots.json и README обновлены (${changed} записей, ${checkedMonth}).`);
  } else {
    console.log(`verified: изменений нет — у всех живых ботов уже стоит ${checkedMonth}.`);
  }
}

console.log(`Итог: проверено ${results.length}, мёртвых: ${dead.length}, недоступных: ${unreachable.length}.`);
if (dead.length > 0 && !process.argv.includes('--no-fail')) {
  process.exitCode = 1;
}
