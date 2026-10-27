// Тесты раунда 16: notbot в снапшоте (X2), сид vs воскрешение (X3), note в реестре (X4).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLivenessSnapshot,
  computeLivenessStats,
  renderDeathRegistry,
  serializeSnapshot,
  loadSnapshots,
} from '../scripts/lib.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// === X2: notbot в снапшоте ===
test('X2: снапшот с notbot не падает (баг раунда 15: канал валил весь linkcheck)', () => {
  const snap = buildLivenessSnapshot(
    [
      { handle: 'a_bot', status: 'ok' },
      { handle: 'chan_bot', status: 'notbot' },
    ],
    '2026-10-27',
  );
  assert.equal(snap.ok, 1);
  assert.equal(snap.notbot, 1);
  assert.equal(snap.total, 2);
  assert.equal(snap.statuses.chan_bot, 'notbot');
});

test('X2: инвариант total === ok+dead+unreachable+notbot', () => {
  const snap = buildLivenessSnapshot(
    [
      { handle: 'a', status: 'ok' },
      { handle: 'b', status: 'dead' },
      { handle: 'c', status: 'unreachable' },
      { handle: 'd', status: 'notbot' },
    ],
    '2026-10-27',
  );
  assert.equal(snap.total, snap.ok + snap.dead + snap.unreachable + snap.notbot);
});

test('X2: сериализация снапшота с notbot — round-trip', () => {
  const snap = buildLivenessSnapshot([{ handle: 'x_bot', status: 'notbot' }], '2026-10-27');
  const parsed = JSON.parse(serializeSnapshot(snap));
  assert.equal(parsed.statuses.x_bot, 'notbot');
  assert.equal(parsed.notbot, 1);
});

test('X2: loadSnapshots принимает notbot (валидация против схемы)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'x2-'));
  try {
    mkdirSync(dir, { recursive: true });
    const snap = buildLivenessSnapshot([{ handle: 'x_bot', status: 'notbot' }], '2026-10-27');
    writeFileSync(path.join(dir, '2026-10-27.json'), serializeSnapshot(snap));
    const loaded = loadSnapshots(dir); // валидирует против схемы — не должна упасть
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].statuses.x_bot, 'notbot');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// === X3: сид не перекрывает воскрешение (проверяем логику aliveNow) ===
test('X3: computeLivenessStats — notbot-статус не мешает lastStatus', () => {
  const snaps = [
    buildLivenessSnapshot([{ handle: 'x_bot', status: 'notbot' }], '2026-10-27'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.lastStatus.get('x_bot').status, 'notbot');
  assert.equal(stats.deaths.length, 0, 'notbot — не смерть');
});

// === X4: note в рендере реестра ===
test('X4: renderDeathRegistry показывает note (эпитафия не теряется)', () => {
  const text = renderDeathRegistry({
    deaths: [{ handle: 'krona_vps_bot', diedOn: '2026-10-19', firstSeen: '2026-04-20', note: 'Issue #30, PR #31' }],
  });
  assert.match(text, /@krona_vps_bot/);
  assert.match(text, /Issue #30, PR #31/);
});

test('X4: реестр без note — как раньше', () => {
  const text = renderDeathRegistry({
    deaths: [{ handle: 'b_bot', diedOn: '2026-10-19', firstSeen: '2026-04-20' }],
  });
  assert.match(text, /@b_bot/);
  assert.ok(!text.includes('Issue'), 'строка без note-эпитафии');
});
