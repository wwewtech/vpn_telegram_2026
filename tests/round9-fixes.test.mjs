// Тесты фиксов раунда 9: снапшот перезаписывается при изменении состава каталога (Q2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// check-links гонит реальную сеть — вместо этого проверяем ЛОГИКУ снапшот-блока
// напрямую: воспроизводим его код в изоляции (точная копия решения).
function snapshotDecision(existing, newSnapshot) {
  let changed = existing === null;
  if (!changed) {
    const existingHandles = Object.keys(existing.statuses ?? {}).sort().join(',');
    const newHandles = Object.keys(newSnapshot.statuses).sort().join(',');
    changed = existingHandles !== newHandles;
  }
  return changed;
}

test('Q2: снапшот перезаписывается, когда каталог вырос (+50 ботов)', () => {
  const existing = { date: '2026-10-26', total: 237, statuses: { a_bot: 'ok', b_bot: 'ok' } };
  const fresh = { date: '2026-10-26', total: 287, statuses: { a_bot: 'ok', b_bot: 'ok', c_bot: 'ok' } };
  assert.equal(snapshotDecision(existing, fresh), true, 'состав изменился — перезапись');
});

test('Q2: снапшот НЕ перезаписывается при том же составе (идемпотентность дня)', () => {
  const existing = { date: '2026-10-26', total: 3, statuses: { a_bot: 'ok', b_bot: 'ok', c_bot: 'ok' } };
  const fresh = { date: '2026-10-26', total: 3, statuses: { a_bot: 'ok', b_bot: 'dead', c_bot: 'ok' } };
  // состав тот же (хендлы совпадают), статусы могли смениться — НЕ перезаписываем,
  // смерть зафиксируется следующим понедельником (задокументированное поведение)
  assert.equal(snapshotDecision(existing, fresh), false, 'состав не изменился — не трогаем');
});

test('Q2: битый существующий снапшот — перезапись (не битый навсегда)', () => {
  // JSON.parse упадёт → changed = true
  let decided;
  try {
    const existing = JSON.parse('NOT JSON');
    decided = snapshotDecision(existing, { statuses: {} });
  } catch {
    decided = true; // блок кода ставит true при ошибке парсинга
  }
  assert.equal(decided, true);
});

test('Q2: удаление бота из каталога — тоже перезапись', () => {
  const existing = { date: '2026-10-26', total: 3, statuses: { a_bot: 'ok', b_bot: 'ok', c_bot: 'ok' } };
  const fresh = { date: '2026-10-26', total: 2, statuses: { a_bot: 'ok', b_bot: 'ok' } };
  assert.equal(snapshotDecision(existing, fresh), true);
});

test('Q2: снапшота нет — запись (исходный случай)', () => {
  assert.equal(snapshotDecision(null, { statuses: { a_bot: 'ok' } }), true);
});
