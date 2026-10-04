// Проверяет data/bots.json: формат записей, дубликаты (Telegram-хендлы нечувствительны к регистру),
// ограничения хендлов Telegram (5-32 символа: A-Z, a-z, 0-9, _).
//
// Запуск: node scripts/validate.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = path.join(ROOT, 'data', 'bots.json');

const HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;

let bots;
try {
  bots = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
} catch (error) {
  console.error(`Ошибка: не удалось прочитать data/bots.json: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(bots) || bots.length === 0) {
  console.error('Ошибка: data/bots.json должен быть непустым массивом объектов вида { "handle": "..." }.');
  process.exit(1);
}

const problems = [];
const seen = new Map();

bots.forEach((bot, index) => {
  const position = `bots[${index}]`;
  if (typeof bot !== 'object' || bot === null || Array.isArray(bot)) {
    problems.push(`${position}: запись должна быть объектом вида { "handle": "..." }`);
    return;
  }
  if (typeof bot.handle !== 'string') {
    problems.push(`${position}: поле "handle" обязательно и должно быть строкой`);
    return;
  }
  if (!HANDLE_RE.test(bot.handle)) {
    problems.push(`${position}: хендл "@${bot.handle}" не похож на username Telegram (5-32 символа: A-Z, a-z, 0-9, _)`);
  }
  const key = bot.handle.toLowerCase();
  if (seen.has(key)) {
    problems.push(`${position}: дубликат "@${bot.handle}" (уже есть запись №${seen.get(key)})`);
  } else {
    seen.set(key, index + 1);
  }
});

if (problems.length > 0) {
  console.error(`Проверка не пройдена — ${problems.length} проблем(ы):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`OK: ${bots.length} ботов, формат корректен, дублей нет.`);
