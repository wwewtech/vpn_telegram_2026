// Проверяет data/bots.json, README.md и README_EN.md:
// - формат записей: объект { "handle": "..." } без лишних полей;
// - хендлы Telegram: 5-32 символа, A-Z, a-z, 0-9, _ (пустая строка тоже ловится);
// - дубликаты (хендлы Telegram нечувствительны к регистру);
// - строгая сортировка списка по алфавиту;
// - отсутствие ссылок с параметрами (реферальные, UTM, ?start=) в ОБОИХ README;
// - ровно одна пара маркеров таблицы в ОБОИХ README.
//
// README_EN проверяется с рождения таблицы в нём (PR #122): раньше он был
// оглавлением без ссылок, теперь содержит полный каталог — и реферальная
// ссылка в нём так же недопустима, как в русской версии.
//
// Запуск: node scripts/validate.mjs
import { readFileSync } from 'node:fs';
import { README_EN_PATH, README_PATH, collectProblems, loadBots } from './lib.mjs';

let bots;
try {
  bots = loadBots();
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exit(1);
}

const problems = [];
for (const [label, filePath] of [['README.md', README_PATH], ['README_EN.md', README_EN_PATH]]) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    // README_EN.md необязателен (легаси-конфигурация без него), README.md — обязателен.
    if (filePath === README_EN_PATH) continue;
    console.error(`Ошибка: не удалось прочитать ${label}: ${error.message}`);
    process.exit(1);
  }
  for (const problem of collectProblems(bots, text)) {
    problems.push(`${label}: ${problem}`);
  }
}

if (problems.length > 0) {
  console.error(`Проверка не пройдена — ${problems.length} проблем(ы):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `OK: ${bots.length} ботов — формат корректен, дублей нет, список отсортирован по алфавиту, ссылок с параметрами нет (RU и EN).`,
);
