// Генерирует coverage.json (формат shields.io endpoint) для динамического бейджа.
// Запускается из CI (validate.yml) после прогона тестов с покрытием.
//
// Использование: node scripts/coverage-badge-json.mjs <процент> [выходной файл]
// Выходной файл по умолчанию: coverage.json в корне (CI пушит его в ветку coverage).
// README ссылается на shields.io endpoint, читающий raw.githubusercontent
// ветки coverage, — бейдж обновляется сам, main не трогается.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pctRaw = process.argv[2];
const outPath = process.argv[3] ?? path.join(ROOT, 'coverage.json');

if (pctRaw === undefined || !/^\d+(\.\d+)?$/.test(pctRaw)) {
  console.error('Использование: node scripts/coverage-badge-json.mjs <процент> [выходной файл]');
  process.exit(1);
}

const pct = parseFloat(pctRaw);
const pctLabel = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
const color = pct >= 90 ? 'brightgreen' : pct >= 80 ? 'green' : pct >= 70 ? 'yellow' : 'red';

const payload = {
  schemaVersion: 2,
  label: 'coverage',
  message: `${pctLabel}%`,
  color,
  cacheSeconds: 3600,
  namedLogo: 'node.js',
};

writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`coverage.json: ${pctLabel}% (${color}) -> ${outPath}`);
