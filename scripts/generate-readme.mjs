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
import { BADGE, README_PATH, isWellFormed, loadBots, renderUpdatedReadme, sortBots } from './lib.mjs';

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

let bots;
try {
  bots = sortBots(loadBots());
} catch (error) {
  fail(error.message);
}

if (!isWellFormed(bots)) {
  fail('в data/bots.json есть записи без строкового поля "handle" — запустите npm run validate, чтобы увидеть детали');
}

const source = readFileSync(README_PATH, 'utf8').replace(/\r\n/g, '\n');

let result;
try {
  result = renderUpdatedReadme(source, bots, new Date());
} catch (error) {
  fail(error.message);
}

if (!result.changed) {
  console.log(`OK: README.md актуален (${bots.length} ботов, сортировка по алфавиту).`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  fail('README.md отличается от data/bots.json. Запустите: npm run fix');
}

const before = source.match(BADGE);
const after = result.updated.match(BADGE);
if (before && after && before[0] !== after[0]) {
  console.log(`Бейдж updated: ${before[2]}.${before[3]} -> ${after[2]}.${after[3]}`);
}

writeFileSync(README_PATH, result.updated, 'utf8');
console.log(`Готово: таблица перегенерирована и отсортирована по алфавиту (${bots.length} ботов).`);
