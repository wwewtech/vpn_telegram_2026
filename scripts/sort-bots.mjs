// Сортирует data/bots.json строго по алфавиту (по хендлу, без учёта регистра).
// Запуск: node scripts/sort-bots.mjs (или npm run sort). Скрипт идемпотентен.
import { readFileSync, writeFileSync } from 'node:fs';
import { DATA_PATH, isWellFormed, loadBots, serializeBots, sortBots } from './lib.mjs';

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

let bots;
try {
  bots = loadBots();
} catch (error) {
  fail(error.message);
}

// Форма записей проверяется ДО сортировки: битый handle (например, не строка)
// иначе молча сортировался бы как пустой и молча переписывался бы в файл —
// с потерей исходных данных и exit code 0. Сейчас такой случай падает loudly,
// как в generate-readme.mjs и check-links.mjs.
if (!isWellFormed(bots)) {
  fail(
    'в data/bots.json есть записи без строкового поля "handle" — файл не тронут. ' +
      'Запустите npm run validate для деталей.',
  );
}

const sorted = sortBots(bots);
const current = readFileSync(DATA_PATH, 'utf8').replace(/\r\n/g, '\n');
const next = serializeBots(sorted);

if (current === next) {
  console.log(`OK: data/bots.json уже отсортирован по алфавиту (${bots.length} ботов).`);
  process.exit(0);
}

const moved = bots.filter((bot, index) => bot !== sorted[index]).length;
writeFileSync(DATA_PATH, next, 'utf8');
console.log(`data/bots.json отсортирован по алфавиту: ${bots.length} ботов, перемещено записей: ${moved}.`);
