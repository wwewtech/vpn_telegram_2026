// Тесты английской таблицы и генерации README_EN из данных.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTableEn, renderUpdatedReadmeEn } from '../scripts/lib.mjs';

const bot = (handle, extra = {}) => ({ handle, ...extra });

test('buildTableEn: английские заголовки, verified, ссылки без параметров', () => {
  const table = buildTableEn([bot('a_bot'), bot('B_bot', { verified: '2026-10' })]);
  assert.equal(
    table,
    [
      '| # | Bot | Verified | Link |',
      '| --- | --- | --- | --- |',
      '| 1 | @a_bot | — | [t.me/a_bot](https://t.me/a_bot) |',
      '| 2 | @B_bot | 2026-10 | [t.me/B_bot](https://t.me/B_bot) |',
    ].join('\n'),
  );
  assert.ok(!table.includes('?'));
});

test('buildTableEn: без verified — три колонки, как в русской', () => {
  const table = buildTableEn([bot('a_bot')]);
  assert.ok(table.includes('| # | Bot | Link |'));
  assert.ok(!table.includes('Verified'));
});

test('renderUpdatedReadmeEn: таблица генерируется между маркерами', () => {
  const src = `# T\n\n<!-- BOTS:START -->\n| old |\n<!-- BOTS:END -->\n`;
  const { updated, changed } = renderUpdatedReadmeEn(src, [bot('a_bot')], '2026.10');
  assert.equal(changed, true);
  assert.ok(updated.includes('| # | Bot | Link |'));
  assert.ok(updated.includes('@a_bot'));
  assert.ok(!updated.includes('| old |'));
});

test('renderUpdatedReadmeEn: без маркеров — таблица не вставляется (легаси-файл)', () => {
  const src = `# No markers\n\nText\n`;
  const { updated, changed } = renderUpdatedReadmeEn(src, [bot('a_bot')], '2026.10');
  assert.equal(changed, false);
  assert.ok(!updated.includes('@a_bot'));
});

test('renderUpdatedReadmeEn: идемпотентность — повторный прогон не меняет файл', () => {
  const src = `# T\n\n<!-- BOTS:START -->\n| old |\n<!-- BOTS:END -->\n`;
  const first = renderUpdatedReadmeEn(src, [bot('a_bot')], '2026.10');
  const second = renderUpdatedReadmeEn(first.updated, [bot('a_bot')], '2026.10');
  assert.equal(second.changed, false);
  assert.equal(second.updated, first.updated);
});

test('renderUpdatedReadmeEn: ручная правка таблицы перезаписывается (защита от порчи)', () => {
  const src = `# T\n\n<!-- BOTS:START -->\n| 1 | @a_bot | SPAM-LINK | BOTS:END -->\n<!-- BOTS:END -->\n`;
  const { updated } = renderUpdatedReadmeEn(src, [bot('a_bot')], '2026.10');
  assert.ok(!updated.includes('SPAM-LINK'));
  assert.ok(updated.includes('@a_bot'));
});
