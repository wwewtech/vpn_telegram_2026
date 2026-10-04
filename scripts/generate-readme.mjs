// Генерирует таблицу ботов в README.md из data/bots.json.
//
// Запуск:
//   node scripts/generate-readme.mjs          — перегенерировать README.md;
//   node scripts/generate-readme.mjs --check  — проверить актуальность без записи (exit 1, если README устарел).
//
// Таблица находится между маркерами <!-- BOTS:START --> и <!-- BOTS:END -->,
// всегда отсортирована строго по алфавиту и собирается только из data/bots.json:
// любые ручные правки таблицы (включая реферальные параметры) будут перезаписаны.
// Бейдж updated-YYYY.MM обновляется автоматически в момент изменения таблицы.
import { readFileSync, writeFileSync } from 'node:fs';
import { BADGE, END, README_PATH, START, loadBots, sortBots } from './lib.mjs';

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function buildTable(bots) {
  const rows = bots.map(
    (bot, index) => `| ${index + 1} | @${bot.handle} | [t.me/${bot.handle}](https://t.me/${bot.handle}) |`,
  );
  return ['| # | Бот | Ссылка |', '| --- | --- | --- |', ...rows].join('\n');
}

let bots;
try {
  bots = sortBots(loadBots());
} catch (error) {
  fail(error.message);
}

for (const bot of bots) {
  if (bot === null || typeof bot !== 'object' || typeof bot.handle !== 'string') {
    fail('в data/bots.json есть записи без строкового поля "handle" — запустите npm run validate, чтобы увидеть детали');
  }
}

const table = buildTable(bots);
const source = readFileSync(README_PATH, 'utf8').replace(/\r\n/g, '\n');
const startIndex = source.indexOf(START);
const endIndex = source.indexOf(END);
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  fail('в README.md не найдены маркеры <!-- BOTS:START --> / <!-- BOTS:END -->');
}

const regionStart = startIndex + START.length;
const oldRegion = source.slice(regionStart, endIndex);
const newRegion = `\n${table}\n`;

let updated = source;
if (oldRegion !== newRegion) {
  updated = source.slice(0, regionStart) + newRegion + source.slice(endIndex);

  const now = new Date();
  const stamp = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  updated = updated.replace(BADGE, (match, prefix, year, month, suffix) => {
    if (`${year}.${month}` !== stamp) {
      console.log(`Бейдж updated: ${year}.${month} -> ${stamp}`);
    }
    return `${prefix}${stamp}${suffix}`;
  });
}

if (updated === source) {
  console.log(`OK: README.md актуален (${bots.length} ботов, сортировка по алфавиту).`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  fail('README.md отличается от data/bots.json. Запустите: npm run fix');
}

writeFileSync(README_PATH, updated, 'utf8');
console.log(`Готово: таблица перегенерирована и отсортирована по алфавиту (${bots.length} ботов).`);
