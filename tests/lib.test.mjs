// Юнит-тесты общих утилит каталога. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTable,
  collectProblems,
  extractOgTitle,
  isMissingBotPage,
  renderUpdatedReadme,
  serializeBots,
  sortBots,
} from '../scripts/lib.mjs';

const bot = (handle, extra = {}) => ({ handle, ...extra });

test('sortBots: строго по алфавиту, без учёта регистра, цифры раньше _', () => {
  const sorted = sortBots([bot('b_bot'), bot('A_bot'), bot('a2_bot'), bot('a_1_bot')]);
  assert.deepEqual(
    sorted.map((item) => item.handle),
    ['a2_bot', 'a_1_bot', 'A_bot', 'b_bot'],
  );
});

test('sortBots: при равенстве без регистра — по исходному написанию', () => {
  const sorted = sortBots([bot('a_bot'), bot('A_bot')]);
  assert.deepEqual(
    sorted.map((item) => item.handle),
    ['A_bot', 'a_bot'],
  );
});

test('serializeBots: канонический формат файла', () => {
  assert.equal(
    serializeBots([bot('a_bot'), bot('B_bot')]),
    '[\n  { "handle": "a_bot" },\n  { "handle": "B_bot" }\n]\n',
  );
});

test('buildTable: нумерация, @-хендлы и ссылки без параметров', () => {
  const table = buildTable([bot('a_bot'), bot('B_bot')]);
  assert.equal(
    table,
    [
      '| # | Бот | Ссылка |',
      '| --- | --- | --- |',
      '| 1 | @a_bot | [t.me/a_bot](https://t.me/a_bot) |',
      '| 2 | @B_bot | [t.me/B_bot](https://t.me/B_bot) |',
    ].join('\n'),
  );
  assert.ok(!table.includes('?'));
});

test('collectProblems: чистая отсортированная база — без проблем', () => {
  assert.deepEqual(collectProblems([bot('a_bot'), bot('b_bot')], ''), []);
});

test('collectProblems: дубликаты без учёта регистра', () => {
  const problems = collectProblems([bot('Foo_bot'), bot('foo_bot')], '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /дубликат/);
});

test('collectProblems: некорректный хендл', () => {
  const problems = collectProblems([bot('ab')], '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /username Telegram/);
});

test('collectProblems: лишние поля запрещены', () => {
  const problems = collectProblems([{ handle: 'a_bot', note: 'x' }], '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /неизвестные поля/);
});

test('collectProblems: несортированный список', () => {
  const problems = collectProblems([bot('b_bot'), bot('a_bot')], '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /не отсортирован/);
});

test('collectProblems: реферальные параметры в README', () => {
  const problems = collectProblems([bot('a_bot')], 'https://t.me/a_bot?start=ref');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ссылка с параметрами/);
});

test('buildTable: колонка «Проверено» появляется при наличии verified', () => {
  const table = buildTable([bot('a_bot', { verified: '2026-10' }), bot('b_bot')]);
  assert.equal(
    table,
    [
      '| # | Бот | Проверено | Ссылка |',
      '| --- | --- | --- | --- |',
      '| 1 | @a_bot | 2026-10 | [t.me/a_bot](https://t.me/a_bot) |',
      '| 2 | @b_bot | — | [t.me/b_bot](https://t.me/b_bot) |',
    ].join('\n'),
  );
});

test('buildTable: без verified колонки «Проверено» нет', () => {
  assert.ok(!buildTable([bot('a_bot')]).includes('Проверено'));
});

test('collectProblems: verified формата YYYY-MM допускается', () => {
  assert.deepEqual(collectProblems([bot('a_bot', { verified: '2026-10' })], ''), []);
});

test('collectProblems: некорректный verified отклоняется', () => {
  const problems = collectProblems([bot('a_bot', { verified: '2026-1' })], '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /verified/);
});

const readmeFixture = (rows, badge = 'updated-2026.01') =>
  `# Title\n\n[![Updated](https://img.shields.io/badge/${badge}-brightgreen)](https://x)\n\n<!-- BOTS:START -->\n${rows}\n<!-- BOTS:END -->\n\nTail\n`;

test('renderUpdatedReadme: обновляет таблицу и бейдж, текст вокруг маркеров сохраняется', () => {
  const { updated, changed } = renderUpdatedReadme(readmeFixture('| stale |'), [bot('a_bot'), bot('b_bot')], new Date(2026, 9, 4));
  assert.equal(changed, true);
  assert.ok(updated.includes('updated-2026.10-brightgreen'));
  assert.ok(updated.includes('| 1 | @a_bot |'));
  assert.ok(updated.includes('| 2 | @b_bot |'));
  assert.ok(!updated.includes('| stale |'));
  assert.ok(updated.startsWith('# Title'));
  assert.ok(updated.endsWith('Tail\n'));
});

test('renderUpdatedReadme: идемпотентность (повторный запуск ничего не меняет)', () => {
  const bots = [bot('a_bot'), bot('b_bot')];
  const first = renderUpdatedReadme(readmeFixture('| stale |'), bots, new Date(2026, 9, 4));
  const second = renderUpdatedReadme(first.updated, bots, new Date(2026, 10, 20));
  assert.equal(second.changed, false);
  assert.equal(second.updated, first.updated);
});

test('renderUpdatedReadme: вычищает ручные реферальные параметры из таблицы', () => {
  const rows = '| 1 | @a_bot | [t.me/a_bot](https://t.me/a_bot?start=ref) |';
  const { updated } = renderUpdatedReadme(readmeFixture(rows), [bot('a_bot')], new Date(2026, 9, 4));
  assert.ok(!updated.includes('?start='));
});

test('renderUpdatedReadme: падает без маркеров', () => {
  assert.throws(() => renderUpdatedReadme('# no markers', [bot('a_bot')]), /маркеры/);
});

const LIVE_HTML = '    <meta property="og:title" content="BotFather">';
const DEAD_HTML =
  '    <meta name="robots" content="noindex, nofollow"><meta property="og:title" content="Telegram: Contact @zzz_dead_bot_2026_xyz">';

test('extractOgTitle: имя живого бота и контакт-заглушка мёртвого', () => {
  assert.equal(extractOgTitle(LIVE_HTML), 'BotFather');
  assert.equal(extractOgTitle(DEAD_HTML), 'Telegram: Contact @zzz_dead_bot_2026_xyz');
  assert.equal(extractOgTitle('<html></html>'), '');
  assert.equal(extractOgTitle('no meta tags at all'), '');
});

test('isMissingBotPage: мёртвый хендл при точном совпадении, без учёта регистра', () => {
  assert.equal(isMissingBotPage(DEAD_HTML, 'zzz_dead_bot_2026_xyz'), true);
  assert.equal(isMissingBotPage(DEAD_HTML, 'ZZZ_DEAD_BOT_2026_XYZ'), true);
  assert.equal(isMissingBotPage(DEAD_HTML, 'other_bot'), false);
  assert.equal(isMissingBotPage(LIVE_HTML, 'BotFather'), false);
});
