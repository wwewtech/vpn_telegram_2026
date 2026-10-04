// Генерирует таблицу ботов в README.md из data/bots.json.
//
// Запуск:
//   node scripts/generate-readme.mjs          — перегенерировать README.md;
//   node scripts/generate-readme.mjs --check  — проверить актуальность без записи (exit 1, если README устарел).
//
// Таблица находится между маркерами <!-- BOTS:START --> и <!-- BOTS:END -->.
// Бейдж updated-YYYY.MM обновляется автоматически в момент изменения таблицы.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README_PATH = path.join(ROOT, 'README.md');
const DATA_PATH = path.join(ROOT, 'data', 'bots.json');

const START = '<!-- BOTS:START -->';
const END = '<!-- BOTS:END -->';
const BADGE = /(updated-)(\d{4})\.(\d{2})(-brightgreen)/;

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function loadBots() {
  let data;
  try {
    data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  } catch (error) {
    fail(`не удалось прочитать data/bots.json: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    fail('data/bots.json должен быть непустым массивом объектов вида { "handle": "..." }');
  }
  return data;
}

function buildTable(bots) {
  const rows = bots.map(
    (bot, index) => `| ${index + 1} | @${bot.handle} | [t.me/${bot.handle}](https://t.me/${bot.handle}) |`,
  );
  return ['| # | Бот | Ссылка |', '| --- | --- | --- |', ...rows].join('\n');
}

const bots = loadBots();
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
  console.log(`OK: README.md актуален (${bots.length} ботов).`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  fail('README.md отличается от data/bots.json. Запустите: node scripts/generate-readme.mjs');
}

writeFileSync(README_PATH, updated, 'utf8');
console.log(`Готово: таблица перегенерирована (${bots.length} ботов).`);
