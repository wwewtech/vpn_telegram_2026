// Генерирует таблицу ботов в README.md из data/bots.json.
//
// Запуск:
//   node scripts/generate-readme.mjs          — перегенерировать README.md (+ синхронизировать README_EN.md);
//   node scripts/generate-readme.mjs --check  — проверить актуальность без записи (exit 1, если README устарел).
//
// Таблица находится между маркерами <!-- BOTS:START --> и <!-- BOTS:END -->,
// всегда отсортирована строго по алфавиту и собирается только из data/bots.json:
// любые ручные правки таблицы (включая реферальные параметры) будут перезаписаны.
// Бейдж updated-YYYY.MM обновляется автоматически в момент изменения таблицы.
// README_EN.md таблицы не содержит, но его бейдж updated и метки вида «200+ bots»
// синхронизируются вместе с README.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  README_EN_PATH,
  README_PATH,
  extractBadgeStamp,
  isWellFormed,
  loadBots,
  renderUpdatedReadme,
  renderUpdatedReadmeEn,
  sortBots,
} from './lib.mjs';

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

// Непустота handle: isWellFormed пропускает пустую строку (typeof string), а
// buildTable генерировал мусор "| 1 | @ | [t.me/](https://t.me/) |" в оба README
// молча, с exit 0 (воспроизведено). validate ловит это через HANDLE_RE, но
// генератор обязан падать сам — до порчи файлов.
const emptyHandle = bots.find((bot) => bot.handle === '');
if (emptyHandle !== undefined) {
  fail('в data/bots.json есть запись с пустым handle — файлы README не перезаписаны. Запустите npm run validate.');
}

const source = readFileSync(README_PATH, 'utf8').replace(/\r\n/g, '\n');

let result;
try {
  result = renderUpdatedReadme(source, bots, new Date());
} catch (error) {
  fail(error.message);
}

const checkMode = process.argv.includes('--check');

// AD4 (раунд 19): отложенные ошибки режима --check. Раньше RU-блок звал fail()
// сразу, и скрипт умирал ДО английской проверки: дрейф README_EN.md
// маскировался русским сообщением. Разработчик чинил README.md, прогонял
// `npm run fix`, и CI падал повторно — уже на EN. Два статус-кво на одну
// правку данных. Теперь оба расхождения собираются и печатаются одним
// fail() в конце, а файлы в режиме --check не пишутся вовсе.
const checkFailures = [];

if (result.changed) {
  if (checkMode) {
    checkFailures.push('README.md отличается от data/bots.json. Запустите: npm run fix');
  } else {
    const before = extractBadgeStamp(source);
    const after = extractBadgeStamp(result.updated);
    if (before && after && before !== after) {
      console.log(`Бейдж updated: ${before} -> ${after}`);
    }
    writeFileSync(README_PATH, result.updated, 'utf8');
    console.log(`Готово: таблица перегенерирована и отсортирована по алфавиту (${bots.length} ботов).`);
  }
} else {
  console.log(`OK: README.md актуален (${bots.length} ботов, сортировка по алфавиту).`);
}

// Синхронизация README_EN.md: бейдж updated (значение — из основного README) и метки вида «200+ bots».
// stamp берём из result.updated — в режиме --check файл не пишется, но
// «каким он должен быть» content уже посчитан, и бейдж из него корректен.
const stamp = extractBadgeStamp(result.updated);
if (!stamp) {
  fail('в README.md не найден или повреждён бейдж updated-YYYY.MM — проверьте строку с бейджем «Updated»');
}
const enPresent = existsSync(README_EN_PATH);
const enSource = enPresent ? readFileSync(README_EN_PATH, 'utf8').replace(/\r\n/g, '\n') : '';
const enResult = renderUpdatedReadmeEn(enSource, bots, stamp, enPresent);
if (enResult.changed) {
  if (checkMode) {
    checkFailures.push('README_EN.md не синхронизирован с data/bots.json. Запустите: npm run fix');
  } else {
    writeFileSync(README_EN_PATH, enResult.updated, 'utf8');
    console.log('README_EN.md синхронизирован: бейдж updated и число ботов обновлены.');
  }
} else if (enPresent) {
  console.log('OK: README_EN.md актуален.');
}

if (checkFailures.length > 0) {
  fail(checkFailures.join(' | '));
}
