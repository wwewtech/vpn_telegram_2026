// Проверяет data/bots.json и README.md:
// - формат записей: объект { "handle": "..." } без лишних полей;
// - хендлы Telegram: 5-32 символа, A-Z, a-z, 0-9, _;
// - дубликаты (хендлы Telegram нечувствительны к регистру);
// - строгая сортировка списка по алфавиту;
// - отсутствие ссылок с параметрами (реферальные, UTM, ?start=) в README.md.
//
// Запуск: node scripts/validate.mjs
import { readFileSync } from 'node:fs';
import { README_PATH, collectProblems, loadBots } from './lib.mjs';

let bots;
try {
  bots = loadBots();
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exit(1);
}

const readme = readFileSync(README_PATH, 'utf8');
const problems = collectProblems(bots, readme);

if (problems.length > 0) {
  console.error(`Проверка не пройдена — ${problems.length} проблем(ы):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `OK: ${bots.length} ботов — формат корректен, дублей нет, список отсортирован по алфавиту, ссылок с параметрами нет.`,
);
