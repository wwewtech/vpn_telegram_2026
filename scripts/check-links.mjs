// Проверяет доступность всех ботов каталога через их t.me-страницы.
//
// Как это работает: у живого хендла og:title содержит его отображаемое имя
// (например, "BotFather"), а у несуществующего — заглушку вида
// "Telegram: Contact @handle". Ошибки сети помечаются отдельно ("unreachable")
// и не считаются мёртвыми ботами.
//
// Запуск: node scripts/check-links.mjs [--out link-report.md] [--no-fail] [--stamp-verified]
// Выход: отчёт в Markdown (пустой файл/поток, если проблем нет).
//        exit 1, если найдены мёртвые боты или сломался сам метод (отчёт уже записан);
//        --no-fail всегда возвращает 0.
//        Недоступные (unreachable) не считаются ошибкой — это сеть, а не мёртвый бот.
//
// --stamp-verified: живым ботам проставляется "verified": "YYYY-MM" (месяц проверки)
//        в data/bots.json, у мёртвых — снимается. Затем данные сортируются и README
//        пересобирается (npm run fix). В README появляется колонка «Проверено».
//
// Самопроверка метода (канарейка): перед стартом скрипт проверяет две заведомо известные
// страницы t.me — живую (BotFather) и несуществующую. Если t.me сменит разметку и метод
// перестанет их различать, проверка завершится ошибкой метода, а не молчаливым «все живы».
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_PATH,
  LIVENESS_DIR,
  applyVerified,
  buildLivenessSnapshot,
  isMissingBotPage,
  isTmeMarkupUnrecognized,
  isWellFormed,
  loadBots,
  serializeBots,
  serializeSnapshot,
  sortBots,
  tmeEntityType,
} from './lib.mjs';

const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20000;
const BATCH_PAUSE_MS = 200;
// U7 (раунды 13-14): мёртвая канарейка — валидный хендл (24 симв), который
// теоретически может зарегистрировать кто угодно через BotFather. Вариант
// «50 символов — длиннее лимита Telegram» НЕ РАБОТАЕТ (проверено живьём:
// t.me на невалидный хендл отвечает редиректом на главную, не заглушкой).
// Правильный фикс — в checkCanary: если dead-канарейка «ожила» (не заглушка),
// это помеха, а не сбой метода: ворнинг в лог + продолжение проверки.
// Бомба обезврежена детектом вместо гарантии платформы.
const CANARY_DEAD = 'zzz_dead_bot_2026_xyz'; // не существует; если зарегистрируют — ворнинг, не блокировка
const CANARY_LIVE = 'BotFather'; // официальный бот Telegram, существует с 2015 года

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const USER_AGENT = 'Mozilla/5.0 (link-checker; +https://github.com/wwewtech/vpn_telegram_2026)';

// Максимальное число пустых ответов подряд, после которого прогон признаётся
// отравленным рейт-лимитом t.me. Пустая страница (HTTP 200, нет og:title) —
// признак троттлинга: наша же охота словила 249 пустых из 549 подряд.
// Держим счётчик: 8 подряд (2 полных батча) — это не сеть, это t.me нас душит.
const EMPTY_RESPONSE_STREAK_LIMIT = 8;

// Фатальная ошибка метода: прокидывается сквозь catch в fetchPage и валит прогон.
class MethodError extends Error {}

let emptyStreak = 0;

async function fetchPage(handle, attempt = 1) {
  const url = `https://t.me/${handle}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return { handle, status: 'unreachable', detail: `HTTP ${response.status}` };
    const html = await response.text();
    if (isMissingBotPage(html, handle)) {
      emptyStreak = 0; // заглушка — осмысленный ответ, троттлинга нет
      return { handle, status: 'dead', detail: 'страница-заглушка «Contact» — хендл не существует' };
    }
    // Пустая страница = рейт-лимит (канарейка это не ловит: она ДО цикла).
    // Раньше такой ответ считался «ok» — linkcheck врал, что бот жив,
    // и verified проставлялся непроверенным ботам.
    if (isTmeMarkupUnrecognized(html)) {
      emptyStreak += 1;
      if (emptyStreak >= EMPTY_RESPONSE_STREAK_LIMIT) {
        throw new MethodError(
          `рейт-лимит t.me: ${emptyStreak} пустых ответов подряд — дальнейшие результаты недостоверны`,
        );
      }
      if (attempt < 3) {
        await sleep(3000);
        return fetchPage(handle, attempt + 1);
      }
      return { handle, status: 'unreachable', detail: 'пустая страница t.me (нет og:title) — троттлинг' };
    }
    emptyStreak = 0; // нормальный ответ сбрасывает счётчик
    // W2 (раунд 15): каталог «ботов» — проверяем, что сущность действительно бот.
    // Каналы/группы (tgme_page_extra «N subscribers»/«N members») раньше проходили
    // как «ok» — GuardianVPN и Cheburnet_Bot_VPN прожили в каталоге недели.
    const entityType = tmeEntityType(html, handle);
    if (entityType === 'channel') {
      return { handle, status: 'notbot', detail: 'это КАНАЛ (N subscribers), а не бот — каталог принимает только ботов' };
    }
    if (entityType === 'group') {
      return { handle, status: 'notbot', detail: 'это ГРУППА (N members), а не бот — каталог принимает только ботов' };
    }
    return { handle, status: 'ok' };
  } catch (error) {
    if (error instanceof MethodError) throw error; // фатал метода — не глотаем
    if (attempt < 2) {
      await sleep(2000);
      return fetchPage(handle, attempt + 1);
    }
    return { handle, status: 'unreachable', detail: String(error && error.message ? error.message : error) };
  }
}

async function fetchTme(handle) {
  const response = await fetch(`https://t.me/${handle}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// Канарейка метода: живая страница должна распознаваться разметкой (og:title + og:description),
// мёртвая — распознаваться заглушкой «Contact». Любое отклонение = метод больше не надёжен.
async function checkCanary() {
  try {
    const liveHtml = await fetchTme(CANARY_LIVE);
    if (isTmeMarkupUnrecognized(liveHtml)) {
      return { ok: false, detail: `живая страница @${CANARY_LIVE} не распознана (нет og:title или og:description пуст)` };
    }
    if (isMissingBotPage(liveHtml, CANARY_LIVE)) {
      return { ok: false, detail: `живая страница @${CANARY_LIVE} ошибочно распознана как заглушка «Contact»` };
    }
    // Y2 (раунд 17) + Z1 (раунд 18): канарейка детектора ТИПА. Если t.me уберёт
    // tgme_page_extra, не-боты пройдут как «ok» — детектор W2 умолкнет тихо.
    // НО: частичный троттлинг тоже режет extra (при живом og:title) — симуляция
    // раунда 18 показала ложный фатал. Различаем: extra нет (null) — не фатал,
    // ворнинг + пропуск детектора в этом прогоне (рейт-лимит); extra есть, но
    // не распознаётся (не 'bot' и не null) — разметка изменилась, фатал.
    const liveType = tmeEntityType(liveHtml, CANARY_LIVE);
    if (liveType === null) {
      console.warn('⚠ Помеха: у @' + CANARY_LIVE + ' страница без tgme_page_extra (og:title жив) — вероятно троттлинг: детектор типа не-ботов отключён в этом прогоне.');
      console.warn('  Если t.me действительно убрал extra — это проявится у ВСЕХ ботов, и ворнинги в отчёте это покажут.');
    } else if (liveType !== 'bot') {
      return {
        ok: false,
        detail: `у @${CANARY_LIVE} тип ${JSON.stringify(liveType)} вместо «bot» — tgme_page_extra изменилась: детектор не-ботов (W2) больше не надёжен`,
      };
    }
  } catch (error) {
    return { ok: false, detail: `живая канарейка @${CANARY_LIVE}: ${String(error && error.message ? error.message : error)}` };
  }
  try {
    const deadHtml = await fetchTme(CANARY_DEAD);
    if (!isMissingBotPage(deadHtml, CANARY_DEAD)) {
      // U7: если страницу без ог:титл или редирект (т.me отвечает на невалидные
      // хендлы редиректом на главную) — метод ненадёжен, STOP.
      if (isTmeMarkupUnrecognized(deadHtml)) {
        return { ok: false, detail: `страница @${CANARY_DEAD} без og:title — невалидный хендл или разметка изменилась` };
      }
      // U7: хендл «ожил» — кто-то зарегистрировал CANARY_DEAD. Это НЕ сбой
      // метода (метод живой распознаёт!), а помеха: предупреждаем и продолжаем.
      // Старое поведение — вечный блок linkcheck («не распознан как Contact»).
      console.warn(`⚠ Помеха: мёртвая канарейка @${CANARY_DEAD} отвечает как ЖИВАЯ страница — вероятно, хендл зарегистрировали.`);
      console.warn('  Метод проверки живых/мёртвых страниц при этом работает — продолжаю.');
      console.warn('  Действие: смените CANARY_DEAD в scripts/check-links.mjs на свежий незанятый хендл.');
    }
  } catch (error) {
    return { ok: false, detail: `мёртвая канарейка @${CANARY_DEAD}: ${String(error && error.message ? error.message : error)}` };
  }
  return { ok: true };
}

async function checkAll(bots) {
  const results = [];
  for (let index = 0; index < bots.length; index += CONCURRENCY) {
    const batch = bots.slice(index, index + CONCURRENCY);
    const settled = await Promise.all(batch.map((bot) => fetchPage(bot.handle)));
    results.push(...settled);
    const done = Math.min(index + CONCURRENCY, bots.length);
    console.log(`Проверено ${done}/${bots.length}...`);
    if (done < bots.length) await sleep(BATCH_PAUSE_MS);
  }
  return results;
}

function renderReport(results, checkedAt) {
  const dead = results.filter((item) => item.status === 'dead');
  const unreachable = results.filter((item) => item.status === 'unreachable');
  const notbot = results.filter((item) => item.status === 'notbot');
  if (dead.length === 0 && unreachable.length === 0 && notbot.length === 0) return '';
  const lines = [`## Автопроверка ссылок: ${checkedAt}`, ``, `Проверено ботов: ${results.length}. Подозрительных: ${dead.length}.`];
  if (dead.length > 0) {
    lines.push(
      ``,
      `### Возможно удалены (${dead.length})`,
      ``,
      `| Бот | Ссылка | Статус |`,
      `| --- | --- | --- |`,
      ...dead.map((item) => `| @${item.handle} | https://t.me/${item.handle} | ${item.detail} |`),
    );
  }
  if (notbot.length > 0) {
    lines.push(
      ``,
      `### Не боты (${notbot.length}) — каталог принимает только ботов`,
      ``,
      `| Хендл | Ссылка | Тип |`,
      `| --- | --- | --- |`,
      ...notbot.map((item) => `| @${item.handle} | https://t.me/${item.handle} | ${item.detail} |`),
    );
  }
  if (unreachable.length > 0) {
    lines.push(
      ``,
      `### Не удалось проверить (${unreachable.length}) — нужен ручной взгляд, а не удаление`,
      ``,
      ...unreachable.map((item) => `- @${item.handle}: ${item.detail}`),
    );
  }
  lines.push(
    ``,
    `Это автоматический отчёт (еженедельный). Проверьте ботов вручную: если бот действительно мёртв — удалите запись из \`data/bots.json\` и выполните \`npm run fix\`.`,
  );
  return `${lines.join('\n')}\n`;
}

const bots = loadBots();

if (!isWellFormed(bots)) {
  console.error('Ошибка: в data/bots.json есть записи без строкового поля "handle" — запускайте npm run validate для деталей.');
  process.exit(1);
}

// Дедуп-гард: дубликаты по lowercase (Abc_bot + abc_bot) раньше проходили в
// снапшот молча — statuses хранил оба написания, и в реестре погибших один
// «умирал», а второй-фантом «жил». collectProblems это ловит, но check-links
// его не вызывал. Гард дублирует ровно одно правило валидации — остальное
// проверяет validate.mjs в CI (required check).
{
  const seen = new Set();
  for (const bot of bots) {
    const key = bot.handle.toLowerCase();
    if (seen.has(key)) {
      console.error(`Ошибка: дубликат хендла "@${bot.handle}" (без учёта регистра) — снапшот будет противоречив. Запустите npm run validate.`);
      process.exit(1);
    }
    seen.add(key);
  }
}

const canary = await checkCanary();
if (!canary.ok) {
  const message = `Самопроверка метода не пройдена: ${canary.detail}.`;
  console.error(`Ошибка метода: ${message}`);
  console.error('Разметка t.me, вероятно, изменилась — результаты проверки были бы недостоверны. Проверьте метод вручную.');
  const outIndex = process.argv.indexOf('--out');
  if (outIndex !== -1 && process.argv[outIndex + 1]) {
    writeFileSync(
      process.argv[outIndex + 1],
      `## Автопроверка ссылок: сбой метода\n\n${message}\nРазметка t.me, вероятно, изменилась — список ботов не проверялся, доверять прошлым результатам нельзя.\n`,
      'utf8',
    );
  } else {
    process.stdout.write(`## Автопроверка ссылок: сбой метода\n\n${message}\n`);
  }
  process.exit(1);
}

// checkAll может бросить MethodError (рейт-лимит t.me в середине прогона):
// данные не тронуты, но и проверка не завершена. Отчёт о сбое метода —
// в Issue уходит текстом, verified/снапшот не пишутся.
let results;
try {
  results = await checkAll(bots);
} catch (error) {
  const message = `Сбой метода в середине прогона: ${error.message}`;
  console.error(`Ошибка: ${message}`);
  console.error('Часть результатов могла быть получена до сбоя, но они НЕ сохранены — данные не тронуты.');
  const outIdx = process.argv.indexOf('--out');
  const failureReport = `## Автопроверка ссылок: сбой метода\n\n${message}\nПрогон остановлен — t.me ограничил частоту запросов. Данные каталога не изменены; повторите прогон позже (или уменьшите каталог).\n`;
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    writeFileSync(process.argv[outIdx + 1], failureReport, 'utf8');
  } else {
    process.stdout.write(failureReport);
  }
  process.exit(1);
}
const dead = results.filter((item) => item.status === 'dead');
const unreachable = results.filter((item) => item.status === 'unreachable');
const report = renderReport(results, new Date().toISOString().slice(0, 10));

// Снапшот живости для реестра смертности: пишется ВСЕГДА (и при мёртвых тоже —
// именно мёртвые и есть предмет реестра). Идёт в тот же авто-PR, что и verified:
// одна точка данных в неделю, диффуется в git построчно (statuses отсортирован).
// Идемпотентность дня с одним исключением: если каталог ИЗМЕНИЛСЯ после снапшота
// (добавили/удалили ботов), снапшот перезаписывается — иначе реестр живости
// навсегда фиксировал бы устаревший состав (Q2, раунд 9: снапшот 237 при
// каталоге 287 после PR с новыми ботами — реестр лгал, verified шёл вперёд).
// Повторный прогон БЕЗ изменений каталога снапшот не трогает (диффов нет).
const snapshotDate = new Date().toISOString().slice(0, 10);
const snapshotPath = path.join(LIVENESS_DIR, `${snapshotDate}.json`);
const newSnapshot = buildLivenessSnapshot(results, snapshotDate);
let snapshotChanged = !existsSync(snapshotPath);
if (!snapshotChanged) {
  try {
    const existing = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    // Состав каталога изменился — снапшот дня больше не соответствует каталогу.
    const existingHandles = Object.keys(existing.statuses ?? {}).sort().join(',');
    const newHandles = Object.keys(newSnapshot.statuses).sort().join(',');
    snapshotChanged = existingHandles !== newHandles;
  } catch {
    snapshotChanged = true; // битый существующий снапшот — перезаписываем
  }
}
if (snapshotChanged) {
  mkdirSync(LIVENESS_DIR, { recursive: true });
  writeFileSync(snapshotPath, serializeSnapshot(newSnapshot), 'utf8');
  console.log(`liveness: снапшот ${existsSync(snapshotPath) ? 'обновлён (состав каталога изменился)' : 'записан'} — ${snapshotPath} (ok: ${newSnapshot.ok}, dead: ${newSnapshot.dead}).`);
} else {
  console.log(`liveness: снапшот ${snapshotDate} уже существует — не перезаписываю.`);
}

// Отчёт записывается ДО stamp-блока: он зависит только от results, а stamp
// (запись данных + пересборка README) может упасть — при старом порядке
// падение пересборки оставляло CI без отчёта, и шаг Issue в workflow
// уходил в ветку «файл пуст → все ссылки доступны» — ложное «все живы»
// при фактически неизвестном состоянии и закрытие issue о мёртвых ботах.
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && process.argv[outIndex + 1]) {
  writeFileSync(process.argv[outIndex + 1], report, 'utf8');
} else {
  process.stdout.write(report);
}

// Автопроставление verified: только по итогам полной проверки, без мёртвых.
// При найденных мёртвых ботах данные не обновляем — сначала ручное решение по каждому.
// Порядок записи: data/bots.json → пересборка README (generate-readme.mjs синхронизирует
// и README_EN.md). Если пересборка упадёт, данные уже записаны, README отстанет —
// следующий npm run fix / validate это поймает и выправит, полуданных не возникнет
// (данные без README валидны, README без данных — нет). Отчёт к этому моменту
// уже записан — CI не останется без отчёта.
if (process.argv.includes('--stamp-verified') && dead.length === 0) {
  const checkedMonth = new Date().toISOString().slice(0, 7);
  const { bots: stamped, changed } = applyVerified(bots, results, checkedMonth);
  if (changed > 0) {
    writeFileSync(DATA_PATH, serializeBots(sortBots(stamped)), 'utf8');
    console.log(`verified: обновлено ${changed} записей (${checkedMonth}) — пересобираю README...`);
    execFileSync(process.execPath, [fileURLToPath(new URL('./generate-readme.mjs', import.meta.url))], { stdio: 'inherit' });
    console.log(`verified: data/bots.json и README обновлены (${changed} записей, ${checkedMonth}).`);
  } else {
    console.log(`verified: изменений нет — у всех живых ботов уже стоит ${checkedMonth}.`);
  }
}

console.log(`Итог: проверено ${results.length}, мёртвых: ${dead.length}, недоступных: ${unreachable.length}.`);
if (dead.length > 0 && !process.argv.includes('--no-fail')) {
  process.exitCode = 1;
}
