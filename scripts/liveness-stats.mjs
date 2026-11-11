// Статистика реестра смертности: выживаемость, диффы недель, погибшие.
//
// Запуск:
//   node scripts/liveness-stats.mjs            — сводка по всем снапшотам
//   node scripts/liveness-stats.mjs --markdown — то же в Markdown (для релизов/README)
//
// Данные: data/liveness/YYYY-MM-DD.json (создаёт еженедельный linkcheck)
// + data/liveness/seed-deaths.json (W3: смерти, которые снапшоты не видят —
// и ранние, до начала наблюдений 26.10.2026, и поздние: бот умер после
// baseline и удалён из каталога, поэтому он просто отсутствует в следующих
// снапшотах, а «отсутствие» реестр смертью не считает. Сид покрывает оба
// случая). Скрипт только читает — писать может только linkcheck.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLivenessStats, loadSnapshots, renderDeathRegistry } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = path.join(ROOT, 'data', 'liveness', 'seed-deaths.json');

const snapshots = loadSnapshots();
const stats = computeLivenessStats(snapshots);

// W3: слияние с сидом смертей, невидимых из снапшотов (дубликаты по хендлу
// не добавляются дважды).
// X3 (раунд 16): сид не добавляет «умершего», если он ЖИВ в снапшотах — сценарий:
// krona ре-регистрируют, подают заявку, бот в каталоге; снапшоты говорят ok,
// а сид упрямо говорил бы «умер 19.10». Воскрешение сильнее сида.
const seeded = new Set(stats.deaths.map((d) => d.handle.toLowerCase()));
// X3: живые по снапшотам (не-dead) — воскрешение сильнее сида
const aliveNow = new Set();
for (const [handle, last] of stats.lastStatus) {
  if (last.status !== 'dead') aliveNow.add(handle.toLowerCase());
}
// AC2 (раунд 19): stats.lastStatus (computeLivenessStats) индексируется
// ТОЧНЫМ регистром хендла из снапшота, а handle сида — из JSON, где регистр
// может отличаться (krona_vps_bot vs Krona_VPS_Bot). Раньше здесь стоял
// stats.lastStatus.get(handle) — при расхождении регистра Map.get вернул
// undefined, и предупреждение печатало «ЖИВ (undefined)»: выглядело как баг
// реестра вместо опечатки в данных. Ищем по нижнему регистру.
const lastStatusByLowerHandle = new Map(
  [...stats.lastStatus].map(([handle, last]) => [handle.toLowerCase(), last]),
);
// AC4 (раунд 20) + исправление: граница между «воскрешение» и «смертью
// после baseline» — дата последнего наблюдения САМОГО бота (берётся ниже из
// lastStatusByLowerHandle), а НЕ глобальная дата последнего снапшота. Бот мог
// выпасть из каталога и из всех поздних снапшотов: его собственное последнее
// наблюдение — раннее (например, ok 26.10), а снапшоты продолжались до 10.11.
// Сравнение с глобальной датой объявляло воскрешением бота, который умер
// 06.11, и тихо выкидывало его смерть из реестра.
if (existsSync(SEED_PATH)) {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  for (const [handle, info] of Object.entries(seed)) {
    if (handle.startsWith('_')) continue; // служебные ключи
    // AA2 (раунд 19): сид не валидировался никак — опечатка в поле (dieOn вместо
    // diedOn) уезжала в реестр молча как undefined. Теперь каждая запись сида
    // проверяется громко, до попадания в реестр.
    if (!info || typeof info !== 'object' || typeof info.diedOn !== 'string' || !DATE_RE.test(info.diedOn)) {
      console.error(`Ошибка: seed-deaths.json["@${handle}"] — поле diedOn обязательно и должно быть датой YYYY-MM-DD`);
      process.exit(1);
    }
    if (info.firstSeen !== undefined && (typeof info.firstSeen !== 'string' || !DATE_RE.test(info.firstSeen))) {
      console.error(`Ошибка: seed-deaths.json["@${handle}"] — firstSeen должен быть датой YYYY-MM-DD`);
      process.exit(1);
    }
    const key = handle.toLowerCase();
    if (seeded.has(key)) continue;
    if (aliveNow.has(key)) {
      // AC4 (раунд 20): «жив в снапшотах» — два разных сценария, и раньше оба
      // молча теряли запись. Если смерть из сида случилась ДО последнего
      // наблюдения ЭТОГО БОТА, бот потом вернулся в каталог — воскрешение
      // сильнее сида, запись честно пропускаем. Но если смерть ПОСЛЕ его
      // последнего наблюдения, это ровно наш случай BearLunaVpnBot: бот жил
      // в 26.10, умер и был удалён из каталога, поэтому в следующих снапшотах
      // его просто нет, а «отсутствие» реестр смертью не читается. Такую
      // смерть надо записать — и предупредить, что хендл в снапшотах живой.
      // Граница — собственное последнее наблюдение бота (lastStatusByLowerHandle),
      // а не глобальная дата последнего снапшота: иначе бот, выпавший из
      // каталога до конца периода наблюдений, выглядел бы «воскресшим».
      const ownLast = lastStatusByLowerHandle.get(key);
      const ownLastDate = ownLast?.date ?? null;
      const diedBeforeLastObservation = ownLastDate !== null && info.diedOn < ownLastDate;
      if (diedBeforeLastObservation) {
        console.warn(`⚠ Сид: @${handle} числится умершим (${info.diedOn}), но в снапшотах ЖИВ (${ownLastDate}) — реестр показывает воскрешение, сид пропущен.`);
        continue;
      }
      console.warn(`⚠ Сид: @${handle} умер (${info.diedOn}) после последнего наблюдения (${ownLastDate ?? 'нет наблюдений'}) и в поздних снапшотах не виден — вероятно, удалён из каталога; запись внесена.`);
    }
    stats.deaths.push({
      handle,
      diedOn: info.diedOn,
      firstSeen: info.firstSeen ?? null,
      ...(info.note ? { note: info.note } : {}),
    });
    seeded.add(key);
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
