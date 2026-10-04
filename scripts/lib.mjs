// Общие утилиты для скриптов каталога: пути, чтение данных, сортировка,
// сериализация, сборка таблицы, проверки и обновление README.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const README_PATH = path.join(ROOT, 'README.md');
export const DATA_PATH = path.join(ROOT, 'data', 'bots.json');

export const START = '<!-- BOTS:START -->';
export const END = '<!-- BOTS:END -->';
export const BADGE = /(updated-)(\d{4})\.(\d{2})(-brightgreen)/;

export const HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;
export const VERIFIED_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const REF_LINK_RE = /https?:\/\/t\.me\/[^\s)\]]*\?[^\s)\]]*/;

export function loadBots() {
  let data;
  try {
    data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`не удалось прочитать data/bots.json: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('data/bots.json должен быть непустым массивом объектов вида { "handle": "..." }');
  }
  return data;
}

function handleOf(bot) {
  if (bot === null || typeof bot !== 'object') return '';
  return typeof bot.handle === 'string' ? bot.handle : '';
}

// Строгое правило сортировки: по хендлу без учёта регистра, при равенстве — по исходному написанию.
export function compareBots(a, b) {
  const left = handleOf(a).toLowerCase();
  const right = handleOf(b).toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  const rawLeft = handleOf(a);
  const rawRight = handleOf(b);
  if (rawLeft === rawRight) return 0;
  return rawLeft < rawRight ? -1 : 1;
}

export function sortBots(bots) {
  return [...bots].sort(compareBots);
}

// Канонический формат файла: один объект в строке, ключи и значения сохраняются как есть.
export function serializeBots(bots) {
  const lines = bots.map((bot) => {
    if (bot === null || typeof bot !== 'object' || Array.isArray(bot)) {
      return `  ${JSON.stringify(bot)}`;
    }
    const fields = Object.entries(bot).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    return `  { ${fields.join(', ')} }`;
  });
  return `[\n${lines.join(',\n')}\n]\n`;
}

// og:title со страницы t.me/<handle> ("BotFather" у живых, "Telegram: Contact @x" у мёртвых).
export function extractOgTitle(html) {
  const match = String(html).match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  return match ? match[1].trim() : '';
}

// Страница t.me/<handle> принадлежит несуществующему юзернейму, если og:title имеет вид
// "Telegram: Contact @handle" — точное сравнение (без учёта регистра) с запрошенным хендлом.
export function isMissingBotPage(html, handle) {
  const expected = `telegram: contact @${String(handle).toLowerCase()}`;
  return extractOgTitle(html).toLowerCase() === expected;
}

export function isWellFormed(bots) {
  return bots.every(
    (bot) => bot !== null && typeof bot === 'object' && !Array.isArray(bot) && typeof bot.handle === 'string',
  );
}

// Таблица README: нумерация и ссылки собираются только из хендла — реферальных параметров не бывает.
// Колонка «Проверено» появляется, когда хотя бы у одной записи заполнено поле "verified".
export function buildTable(bots) {
  const withVerified = bots.some((bot) => typeof bot.verified === 'string');
  const rows = bots.map((bot, index) => {
    const link = `[t.me/${bot.handle}](https://t.me/${bot.handle})`;
    if (!withVerified) return `| ${index + 1} | @${bot.handle} | ${link} |`;
    const verified = typeof bot.verified === 'string' ? bot.verified : '—';
    return `| ${index + 1} | @${bot.handle} | ${verified} | ${link} |`;
  });
  const header = withVerified ? '| # | Бот | Проверено | Ссылка |' : '| # | Бот | Ссылка |';
  const separator = withVerified ? '| --- | --- | --- | --- |' : '| --- | --- | --- |';
  return [header, separator, ...rows].join('\n');
}

function findRegion(source) {
  const startIndex = source.indexOf(START);
  const endIndex = source.indexOf(END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null;
  return { regionStart: startIndex + START.length, regionEnd: endIndex };
}

// Обновляет таблицу между маркерами и бейдж updated-YYYY.MM. Чистая функция, файлы не пишет.
export function renderUpdatedReadme(source, bots, date = new Date()) {
  const region = findRegion(source);
  if (!region) {
    throw new Error('в README.md не найдены маркеры <!-- BOTS:START --> / <!-- BOTS:END -->');
  }
  const newRegion = `\n${buildTable(bots)}\n`;
  const oldRegion = source.slice(region.regionStart, region.regionEnd);
  if (oldRegion === newRegion) {
    return { updated: source, changed: false };
  }
  let updated = source.slice(0, region.regionStart) + newRegion + source.slice(region.regionEnd);
  const stamp = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
  updated = updated.replace(BADGE, (match, prefix, year, month, suffix) => `${prefix}${stamp}${suffix}`);
  return { updated, changed: true };
}

// Все проверки data/bots.json и README.md: возвращает список проблем (пустой список = всё хорошо).
export function collectProblems(bots, readmeText) {
  const problems = [];
  const seen = new Map();
  let wellFormed = true;

  bots.forEach((bot, index) => {
    const position = `bots[${index}]`;
    if (typeof bot !== 'object' || bot === null || Array.isArray(bot)) {
      problems.push(`${position}: запись должна быть объектом вида { "handle": "..." }`);
      wellFormed = false;
      return;
    }
    const extraKeys = Object.keys(bot).filter((key) => key !== 'handle' && key !== 'verified');
    if (extraKeys.length > 0) {
      problems.push(`${position}: неизвестные поля: ${extraKeys.join(', ')} (допустимы только "handle" и "verified")`);
      wellFormed = false;
    }
    if (bot.verified !== undefined && (typeof bot.verified !== 'string' || !VERIFIED_RE.test(bot.verified))) {
      problems.push(`${position}: поле "verified" должно быть строкой формата YYYY-MM (например, "2026-10")`);
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

  const refLink = readmeText.match(REF_LINK_RE);
  if (refLink) {
    problems.push(`в README.md найдена ссылка с параметрами (реферальные и трекинговые запрещены): ${refLink[0]}`);
  }

  return problems;
}
