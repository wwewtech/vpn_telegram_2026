// Статистика реестра смертности: выживаемость, диффы недель, погибшие.
//
// Запуск:
//   node scripts/liveness-stats.mjs            — сводка по всем снапшотам
//   node scripts/liveness-stats.mjs --markdown — то же в Markdown (для релизов/README)
//
// Данные: data/liveness/YYYY-MM-DD.json (создаёт еженедельный linkcheck).
// Скрипт только читает — писать может только linkcheck (единая точка входа данных).
import { computeLivenessStats, loadSnapshots, renderDeathRegistry } from './lib.mjs';

const snapshots = loadSnapshots();

if (snapshots.length === 0) {
  console.log('Снапшотов пока нет: data/liveness/ пуст. Первый снапшот создаст ближайший прогон linkcheck.');
  process.exit(0);
}

const stats = computeLivenessStats(snapshots);
const markdown = process.argv.includes('--markdown');

if (markdown) {
  console.log(`### Реестр живости: ${stats.snapshots} наблюдений`);
  console.log('');
  console.log('| Дата | Живые | Мёртвые | Недоступные |');
  console.log('| --- | --- | --- | --- |');
  for (const w of stats.weekly) {
    console.log(`| ${w.date} | ${w.ok} | ${w.dead} | ${w.unreachable} |`);
  }
  console.log('');
  console.log('#### Реестр погибших');
  console.log('');
  console.log(renderDeathRegistry(stats));
  process.exit(0);
}

console.log(`Снапшотов: ${stats.snapshots} (${snapshots[0].date} — ${snapshots[snapshots.length - 1].date})`);
console.log('');
console.log('По прогонам:');
for (const w of stats.weekly) {
  console.log(`  ${w.date}: ok=${w.ok} dead=${w.dead} unreachable=${w.unreachable}`);
}
console.log('');
if (stats.deaths.length === 0) {
  console.log('Погибших нет — все живы.');
} else {
  console.log(`Реестр погибших (${stats.deaths.length}):`);
  for (const d of stats.deaths) {
    const lived = d.firstSeen ? `${d.firstSeen} — ${d.diedOn}` : `до ${d.diedOn}`;
    console.log(`  @${d.handle}: наблюдался ${lived}`);
  }
}
