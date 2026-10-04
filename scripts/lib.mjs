// Общие утилиты для скриптов каталога: пути, чтение данных, сортировка, сериализация.
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
