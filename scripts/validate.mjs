// Проверяет data/bots.json и README.md:
// - формат записей: объект { "handle": "..." } без лишних полей;
// - хендлы Telegram: 5-32 символа, A-Z, a-z, 0-9, _;
// - дубликаты (хендлы Telegram нечувствительны к регистру);
// - строгая сортировка списка по алфавиту;
// - отсутствие ссылок с параметрами (реферальные, UTM, ?start=) в README.md.
//
// Запуск: node scripts/validate.mjs
import { readFileSync } from 'node:fs';
import { HANDLE_RE, README_PATH, loadBots, sortBots } from './lib.mjs';

const problems = [];

let bots;
try {
  bots = loadBots();
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exit(1);
}

const seen = new Map();
let wellFormed = true;

bots.forEach((bot, index) => {
  const position = `bots[${index}]`;
  if (typeof bot !== 'object' || bot === null || Array.isArray(bot)) {
    problems.push(`${position}: запись должна быть объектом вида { "handle": "..." }`);
    wellFormed = false;
    return;
  }
  const extraKeys = Object.keys(bot).filter((key) => key !== 'handle');
  if (extraKeys.length > 0) {
    problems.push(`${position}: неизвестные поля: ${extraKeys.join(', ')} (допустимо только "handle")`);
    wellFormed = false;
  }
  if (typeof bot.handle !== 'string') {
    problems.push(`${position}: поле "handle" обязательно и должно быть строкой`);
    wellFormed = false;
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

if (wellFormed) {
  const sorted = sortBots(bots);
  const outOfOrder = bots.findIndex((bot, index) => bot !== sorted[index]);
  if (outOfOrder !== -1) {
    problems.push(
      `список не отсортирован по алфавиту: на позиции №${outOfOrder + 1} стоит "@${bots[outOfOrder].handle}", ` +
        `ожидается "@${sorted[outOfOrder].handle}". Запустите: npm run fix`,
    );
  }
}

const readme = readFileSync(README_PATH, 'utf8');
const refLink = readme.match(/https?:\/\/t\.me\/[^\s)\]]*\?[^\s)\]]*/);
if (refLink) {
  problems.push(`в README.md найдена ссылка с параметрами (реферальные и трекинговые запрещены): ${refLink[0]}`);
}

if (problems.length > 0) {
  console.error(`Проверка не пройдена — ${problems.length} проблем(ы):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `OK: ${bots.length} ботов — формат корректен, дублей нет, список отсортирован по алфавиту, ссылок с параметрами нет.`,
);
