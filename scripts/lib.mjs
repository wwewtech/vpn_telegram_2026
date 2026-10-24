// Общие утилиты для скриптов каталога: пути, чтение данных, сортировка,
// сериализация, сборка таблицы, проверки и обновление README,
// снапшоты живости (liveness) и статистика выживаемости.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const README_PATH = path.join(ROOT, 'README.md');
export const README_EN_PATH = path.join(ROOT, 'README_EN.md');
export const DATA_PATH = path.join(ROOT, 'data', 'bots.json');
export const LIVENESS_DIR = path.join(ROOT, 'data', 'liveness');

export const START = '<!-- BOTS:START -->';
export const END = '<!-- BOTS:END -->';
export const BADGE = /(updated-)(\d{4})\.(\d{2})(-brightgreen)/;
export const BADGE_G = /(updated-)(\d{4})\.(\d{2})(-brightgreen)/g;
export const STAMP_RE = /^\d{4}\.(0[1-9]|1[0-2])$/;

// Штамп «YYYY.MM» из бейджа updated в тексте; null, если бейджа нет.
export function extractBadgeStamp(text) {
  const badge = String(text).match(BADGE);
  return badge ? `${badge[2]}.${badge[3]}` : null;
}

// Заменяет штамп у всех бейджей updated в тексте, а не только у первого.
export function replaceBadgeStamp(text, stamp) {
  return String(text).replace(BADGE_G, (match, prefix, year, month, suffix) => `${prefix}${stamp}${suffix}`);
}

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

// Канонический формат файла: один объект в строке. Порядок ключей нормализуется:
// handle первым (обязательное поле схемы), verified вторым, остальные (невалидные
// для контракта, но сериализатор не должен терять данные) — в исходном порядке.
// Без нормализации перевёрнутая запись из чужого PR проходила validate и
// порождала вторую «каноническую» форму файла — вечный git-шум при npm run fix.
export function serializeBots(bots) {
  const lines = bots.map((bot) => {
    if (bot === null || typeof bot !== 'object' || Array.isArray(bot)) {
      return `  ${JSON.stringify(bot)}`;
    }
    const order = ['handle', 'verified', ...Object.keys(bot).filter((key) => key !== 'handle' && key !== 'verified')];
    const fields = order
      .filter((key) => key in bot)
      .map((key) => `${JSON.stringify(key)}: ${JSON.stringify(bot[key])}`);
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

// true, когда разметка t.me изменилась и метод проверки перестал быть надёжным.
// Ожидаем от текущей разметки t.me у живого хендла: есть og:title и непустой og:description.
// Канарейка в check-links.mjs вызывает это для заведомо живой страницы; заглушка
// несуществующего хендла проверяется отдельно через isMissingBotPage.
export function isTmeMarkupUnrecognized(html) {
  const ogTitle = extractOgTitle(html);
  if (!ogTitle) return true;
  const match = String(html).match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  if (!match) return true;
  return match[1].trim() === '';
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
  updated = replaceBadgeStamp(updated, stamp);
  return { updated, changed: true };
}

// Грубое число ботов для README_EN.md: «200+», «300+» и т.д. (округление вниз до сотни,
// но не меньше «100+» — меньшие каталоги описывать округлением бессмысленно).
export function botsRoundFloor(bots) {
  return `${Math.max(100, Math.floor(bots.length / 100) * 100)}+`;
}

const EN_COUNT_RES = [/\b\d+\+\s+bots\b/gi, /\b\d+\+\s+VPN\s+bots\b/gi];

// Синхронизирует README_EN.md с данными: бейдж updated-YYYY.MM (stamp — значение
// бейджа из основного README, «YYYY.MM») и метки вида «200+ bots».
// Чистая функция, файлы не пишет. Идемпотентна: stamp приходит из основного README
// и меняется только вместе с ним, поэтому при неизменных данных файл не меняется.
// Если файла нет — возвращает source без изменений.
export function renderUpdatedReadmeEn(source, bots, stamp, present = true) {
  if (!present) return { updated: source, changed: false };
  if (!STAMP_RE.test(stamp)) {
    throw new Error(`штамп для README_EN.md должен быть строкой «YYYY.MM», получено: ${JSON.stringify(stamp)}`);
  }
  const rough = botsRoundFloor(bots);
  let updated = replaceBadgeStamp(source, stamp);
  updated = EN_COUNT_RES.reduce(
    (text, re) => text.replace(re, (m) => m.replace(/\d+\+/, rough)),
    updated,
  );
  return { updated, changed: updated !== source };
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

  // Маркеры таблицы: если маркеры в README есть, их должно быть ровно по одному
  // (START и END). Двойные пары раньше проходили валидацию молча, а генератор
  // обновлял только первый блок — второй оставался дубликатом навсегда.
  // Если маркеров нет совсем — молчим: это легаси-контракт вызова с пустым
  // текстом (тесты передают ''), отсутствие маркеров ловит renderUpdatedReadme.
  const startCount = countOccurrences(readmeText, START);
  const endCount = countOccurrences(readmeText, END);
  if (startCount > 0 || endCount > 0) {
    if (startCount !== 1 || endCount !== 1) {
      problems.push(
        `в README.md должно быть ровно по одному маркеру ${START} и ${END}, ` +
          `найдено: START=${startCount}, END=${endCount}. Удалите лишний блок таблицы, ` +
          `вставленный вручную, — таблица генерируется между единственной парой маркеров.`,
      );
    } else if (readmeText.indexOf(END) < readmeText.indexOf(START)) {
      problems.push(`в README.md маркер ${END} стоит раньше ${START} — проверьте порядок маркеров.`);
    }
  }

  return problems;
}

function countOccurrences(text, marker) {
  let count = 0;
  let position = 0;
  for (;;) {
    const found = text.indexOf(marker, position);
    if (found === -1) return count;
    count += 1;
    position = found + marker.length;
  }
}

// Автопроставление verified по результатам проверки ссылок.
// Чистая функция: возвращает новый массив (и счётчик изменений), исходный не мутирует.
//   - «ok»      → verified = месяц проверки (YYYY-MM), если он НОВЕЕ текущего или поля нет.
//                  Ручную «будущую» отметку (например, 2027-01 при проверке за 2026-10)
//                  автопрогон не понижает — ручные данные важнее автостатуса;
//   - «dead»    → verified снимается (бот не работает — свежесть протухла);
//   - «unreachable» → verified не трогаем (сеть ≠ мёртвый бот).
export function applyVerified(bots, results, checkedAt) {
  const byHandle = new Map();
  for (const item of results) {
    byHandle.set(String(item.handle).toLowerCase(), item.status);
  }
  let changed = 0;
  const updated = bots.map((bot) => {
    const status = byHandle.get(bot.handle.toLowerCase());
    if (status === undefined) return bot;
    if (status === 'ok') {
      if (bot.verified !== undefined && bot.verified >= checkedAt) return bot; // уже свежее или равно
      changed += 1;
      return { ...bot, verified: checkedAt };
    }
    if (status === 'dead') {
      if (bot.verified === undefined) return bot;
      changed += 1;
      const copy = { ...bot };
      delete copy.verified;
      return copy;
    }
    return bot;
  });
  return { bots: updated, changed };
}

// ============================== LIVENESS ==============================
// Реестр смертности: linkcheck каждую неделю фиксирует статус всех ботов.
// Снапшоты копятся в data/liveness/YYYY-MM-DD.json, из них считается
// выживаемость, диффы недель и реестр погибших (death registry).

// Снапшот живости из результатов checkAll: { date, total, ok, dead, unreachable, statuses }.
// Чистая функция: только данные, никакой записи на диск.
export function buildLivenessSnapshot(results, dateISO) {
  const statuses = {};
  for (const item of results) {
    statuses[item.handle] = item.status;
  }
  return {
    date: dateISO,
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    dead: results.filter((r) => r.status === 'dead').length,
    unreachable: results.filter((r) => r.status === 'unreachable').length,
    statuses,
  };
}

export function serializeSnapshot(snapshot) {
  // Компактный формат: один хендл — одна строка, легко диффится в git.
  const lines = Object.entries(snapshot.statuses)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([handle, status]) => `    ${JSON.stringify(handle)}: ${JSON.stringify(status)}`);
  return [
    `{`,
    `  "date": ${JSON.stringify(snapshot.date)},`,
    `  "total": ${snapshot.total},`,
    `  "ok": ${snapshot.ok},`,
    `  "dead": ${snapshot.dead},`,
    `  "unreachable": ${snapshot.unreachable},`,
    `  "statuses": {`,
    ...lines.map((l, i) => (i === lines.length - 1 ? l : `${l},`)),
    `  }`,
    `}`,
    ``,
  ].join('\n');
}

// Все доступные даты снапшотов (сортировка по дате).
export function listSnapshotDates(dir = LIVENESS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadSnapshots(dir = LIVENESS_DIR) {
  return listSnapshotDates(dir).map((date) => {
    const raw = JSON.parse(readFileSync(path.join(dir, `${date}.json`), 'utf8'));
    if (raw.date !== date) throw new Error(`liveness/${date}.json: поле date (${raw.date}) не совпадает с именем файла`);
    return raw;
  });
}

// Статистика по накопленным снапшотам. Чистая функция от массива снапшотов.
//   - survival: последняя известная дата статуса «ok» для каждого хендла
//   - deaths: хендлы, чей последний статус «dead» (и когда это случилось впервые)
//   - weekly: по-недельные диффы: сколько ok/dead/unreachable в каждом прогоне
export function computeLivenessStats(snapshots) {
  const byDate = new Map(); // date -> snapshot
  for (const s of snapshots) byDate.set(s.date, s);

  // Последний статус каждого хендла по хронологии снапшотов.
  const lastStatus = new Map(); // handle -> { status, date }
  const seenAlive = new Map(); // handle -> первая дата, когда появился (ok/unreachable)
  for (const s of snapshots) {
    for (const [handle, status] of Object.entries(s.statuses)) {
      lastStatus.set(handle, { status, date: s.date });
      if (status !== 'dead' && !seenAlive.has(handle)) seenAlive.set(handle, s.date);
    }
  }

  // Погибшие: последний статус dead. firstDead — когда dead увидели впервые.
  const firstDead = new Map();
  for (const s of snapshots) {
    for (const [handle, status] of Object.entries(s.statuses)) {
      if (status === 'dead' && !firstDead.has(handle)) firstDead.set(handle, s.date);
    }
  }
  const deaths = [...firstDead.entries()]
    .filter(([handle]) => (lastStatus.get(handle)?.status ?? '') === 'dead')
    .map(([handle, diedOn]) => ({
      handle,
      diedOn,
      firstSeen: seenAlive.get(handle) ?? null, // когда впервые наблюдался живым
    }))
    .sort((a, b) => a.handle.toLowerCase().localeCompare(b.handle.toLowerCase()));

  const weekly = snapshots.map((s) => ({ date: s.date, ok: s.ok, dead: s.dead, unreachable: s.unreachable }));

  return { snapshots: snapshots.length, weekly, deaths, lastStatus };
}

// Markdown-таблица реестра смертности для README/релизов.
export function renderDeathRegistry(stats) {
  if (stats.deaths.length === 0) {
    return ['| Бот | Жил в каталоге | Умер |', '| --- | --- | --- |', '| _все живы — потерь нет_ | — | — |'].join('\n');
  }
  const rows = stats.deaths.map(
    (d) =>
      `| @${d.handle} | ${d.firstSeen ? d.firstSeen + ' — ' : ''}${d.diedOn} | ${d.diedOn} |`,
  );
  return ['| Бот | Наблюдался | Констатирована смерть |', '| --- | --- | --- |', ...rows].join('\n');
}
