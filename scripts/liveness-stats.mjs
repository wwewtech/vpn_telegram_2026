// Статистика реестра смертности: выживаемость, диффы недель, погибшие.
//
// Запуск:
//   node scripts/liveness-stats.mjs            — сводка по всем снапшотам
//   node scripts/liveness-stats.mjs --markdown — то же в Markdown (для релизов/README)
//
// Данные: data/liveness/YYYY-MM-DD.json (создаёт еженедельный linkcheck)
// + data/liveness/seed-deaths.json (W3: ранние смерти до 26.10.2026 —
// реестр из одних снапшотов слеп к krona_vps_bot и любым ботам, умершим
// до начала наблюдений). Скрипт только читает — писать может только linkcheck.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLivenessStats, loadSnapshots, renderDeathRegistry } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = path.join(ROOT, 'data', 'liveness', 'seed-deaths.json');

const snapshots = loadSnapshots();
const stats = computeLivenessStats(snapshots);

// W3: слияние с сидом ранних смертей (дубликаты по хендлу не добавляются дважды)
const seeded = new Set(stats.deaths.map((d) => d.handle.toLowerCase()));
if (existsSync(SEED_PATH)) {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  for (const [handle, info] of Object.entries(seed)) {
    if (handle.startsWith('_')) continue; // служебные ключи
    if (seeded.has(handle.toLowerCase())) continue;
    stats.deaths.push({
      handle,
      diedOn: info.diedOn,
      firstSeen: info.firstSeen ?? null,
      ...(info.note ? { note: info.note } : {}),
    });
    seeded.add(handle.toLowerCase());
  }
  stats.deaths.sort((a, b) => a.handle.toLowerCase().localeCompare(b.handle.toLowerCase()));
}

if (snapshots.length === 0) {
  console.log('Снапшотов пока нет: data/liveness/ пуст. Первый снапшот создаст ближайший прогон linkcheck.');
  console.log('');
}

const markdown = process.argv.includes('--markdown');

if (markdown) {
  if (snapshots.length > 0) {
    console.log(`### Реестр живости: ${stats.snapshots} наблюдений`);
    console.log('');
    console.log('| Дата | Живые | Мёртвые | Недоступные |');
    console.log('| --- | --- | --- | --- |');
    for (const w of stats.weekly) {
      console.log(`| ${w.date} | ${w.ok} | ${w.dead} | ${w.unreachable} |`);
    }
    console.log('');
  }
  console.log('#### Реестр погибших');
  console.log('');
  console.log(renderDeathRegistry(stats));
  process.exit(0);
}

if (snapshots.length > 0) {
  console.log(`Снапшотов: ${stats.snapshots} (${snapshots[0].date} — ${snapshots[snapshots.length - 1].date})`);
  console.log('');
  console.log('По прогонам:');
  for (const w of stats.weekly) {
    console.log(`  ${w.date}: ok=${w.ok} dead=${w.dead} unreachable=${w.unreachable}`);
  }
  console.log('');
}
if (stats.deaths.length === 0) {
  console.log('Погибших нет — все живы.');
} else {
  console.log(`Реестр погибших (${stats.deaths.length}):`);
  for (const d of stats.deaths) {
    const lived = d.firstSeen ? `${d.firstSeen} — ${d.diedOn}` : `до ${d.diedOn}`;
    console.log(`  @${d.handle}: наблюдался ${lived}${d.note ? ` (${d.note})` : ''}`);
  }
}
