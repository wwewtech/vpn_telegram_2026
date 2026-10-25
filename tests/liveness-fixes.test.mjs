// Тесты фиксов A, B, C, E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLivenessSnapshot,
  computeLivenessStats,
  livenessProblems,
  renderDeathRegistry,
  serializeSnapshot,
  loadSnapshots,
  listSnapshotDates,
} from '../scripts/lib.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// === ФИКС B: мусорные статусы ===
test('buildLivenessSnapshot: неизвестный статус — бросает, а не молчит', () => {
  assert.throws(() => buildLivenessSnapshot([{ handle: 'a_bot', status: 'Ok' }], '2026-10-24'), /неизвестный статус/);
  assert.throws(() => buildLivenessSnapshot([{ handle: 'a_bot', status: 'zombie' }], '2026-10-24'), /неизвестный статус/);
  // валидные — не бросают
  const ok = buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-24');
  assert.equal(ok.total, 1);
});

test('buildLivenessSnapshot: инвариант total === ok+dead+unreachable', () => {
  const snap = buildLivenessSnapshot(
    [
      { handle: 'a_bot', status: 'ok' },
      { handle: 'b_bot', status: 'dead' },
      { handle: 'c_bot', status: 'unreachable' },
    ],
    '2026-10-24',
  );
  assert.equal(snap.total, snap.ok + snap.dead + snap.unreachable);
});

// === ФИКС A: diedOn после воскрешения ===
test('diedOn: dead→ok→dead — смерть после последнего ok, не первое dead', () => {
  const snaps = [
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-05'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-12'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-19'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths.length, 1);
  assert.equal(stats.deaths[0].diedOn, '2026-10-19', 'diedOn должен быть после последнего ok');
  assert.notEqual(stats.deaths[0].diedOn, '2026-10-05');
});

test('diedOn: ok→dead→dead — первое dead после последнего ok', () => {
  const snaps = [
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-05'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-12'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-19'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths[0].diedOn, '2026-10-12');
});

test('diedOn: ок→unreachable→dead — unreachable не воскрешает', () => {
  // unreachable ≠ ok, но и не dead: бот не подтверждён живым в этот день.
  // Смерть после unreachable — законна (unreachable не опровергает смерть).
  const snaps = [
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'unreachable' }], '2026-10-05'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-12'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths[0].diedOn, '2026-10-12');
});

test('первый dead без предшествующего ok: diedOn = дата первого dead', () => {
  // бот добавлен в каталог и сразу мёртв — первое наблюдение dead.
  const snaps = [buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-12')];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths[0].diedOn, '2026-10-12');
  assert.equal(stats.deaths[0].firstSeen, null, 'firstSeen = null: живым не наблюдался');
});

test('воскресший (dead→ok, последний ok) не в реестре', () => {
  const snaps = [
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-05'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-12'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths.length, 0);
});

// === ФИКС C: loadSnapshots валидирует против схемы ===
test('loadSnapshots: битый снапшот (мусорный статус) — громко падает', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'liv-fix-'));
  try {
    mkdirSync(dir, { recursive: true });
    const bad = {
      date: '2026-10-24',
      total: 1,
      ok: 1,
      dead: 0,
      unreachable: 0,
      statuses: { a_bot: 'Ok' }, // мусорный статус
    };
    writeFileSync(path.join(dir, '2026-10-24.json'), JSON.stringify(bad));
    assert.throws(() => loadSnapshots(dir), /не соответствует контракту.*недопустимый статус/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSnapshots: отсутствие обязательного поля — падает', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'liv-fix2-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '2026-10-24.json'), JSON.stringify({ date: '2026-10-24', total: 1 }));
    assert.throws(() => loadSnapshots(dir), /нет обязательного поля/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSnapshots: валидный снапшот — грузится без ошибок', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'liv-fix3-'));
  try {
    mkdirSync(dir, { recursive: true });
    const snap = buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-24');
    writeFileSync(path.join(dir, '2026-10-24.json'), serializeSnapshot(snap));
    const loaded = loadSnapshots(dir);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].statuses.a_bot, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('livenessProblems: чистая функция — пустой список на валидном, проблемы на битом', () => {
  const schema = {
    required: ['date', 'total', 'ok', 'dead', 'unreachable', 'statuses'],
    properties: {
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      total: { type: 'integer' },
      ok: { type: 'integer' },
      dead: { type: 'integer' },
      unreachable: { type: 'integer' },
      statuses: { additionalProperties: { type: 'string', pattern: '^(ok|dead|unreachable)$' } },
    },
  };
  const good = buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-24');
  assert.deepEqual(livenessProblems(good, schema), []);
  const bad = { date: '2026-10-24', total: 'много', statuses: { a_bot: 'zombie' } };
  assert.ok(livenessProblems(bad, schema).length >= 3);
  assert.deepEqual(livenessProblems(good, null).length > 0, true, 'без схемы — проблема');
});

// === ФИКС E: заголовок реестра ===
test('renderDeathRegistry: заголовок «Жил в каталоге | Умер»', () => {
  const snaps = [
    buildLivenessSnapshot([{ handle: 'b_bot', status: 'ok' }], '2026-04-20'),
    buildLivenessSnapshot([{ handle: 'b_bot', status: 'dead' }], '2026-10-19'),
  ];
  const text = renderDeathRegistry(computeLivenessStats(snaps));
  assert.match(text, /Жил в каталоге/);
  assert.doesNotMatch(text, /Констатирована смерть/);
});
