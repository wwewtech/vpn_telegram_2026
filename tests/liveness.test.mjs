// Юнит-тесты реестра живости (liveness): снапшоты, статистика, реестр погибших.
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLivenessSnapshot,
  computeLivenessStats,
  listSnapshotDates,
  loadSnapshots,
  renderDeathRegistry,
  serializeSnapshot,
} from '../scripts/lib.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ok = (handle) => ({ handle, status: 'ok' });
const dead = (handle) => ({ handle, status: 'dead' });
const unreachable = (handle) => ({ handle, status: 'unreachable' });

test('buildLivenessSnapshot: агрегаты и statuses по результатам', () => {
  const results = [ok('a_bot'), ok('b_bot'), dead('c_bot'), unreachable('d_bot')];
  const snap = buildLivenessSnapshot(results, '2026-10-26');
  assert.equal(snap.date, '2026-10-26');
  assert.equal(snap.total, 4);
  assert.equal(snap.ok, 2);
  assert.equal(snap.dead, 1);
  assert.equal(snap.unreachable, 1);
  assert.deepEqual(snap.statuses, { a_bot: 'ok', b_bot: 'ok', c_bot: 'dead', d_bot: 'unreachable' });
});

test('buildLivenessSnapshot: пустой результат — нули, пустые statuses', () => {
  const snap = buildLivenessSnapshot([], '2026-10-26');
  assert.equal(snap.total, 0);
  assert.equal(snap.ok, 0);
  assert.deepEqual(snap.statuses, {});
});

test('serializeSnapshot: канонический формат, statuses отсортирован, парсится обратно', () => {
  const snap = buildLivenessSnapshot([ok('Z_bot'), ok('a_bot'), dead('b_bot')], '2026-10-26');
  const text = serializeSnapshot(snap);
  // round-trip
  const parsed = JSON.parse(text);
  assert.equal(parsed.date, snap.date);
  assert.deepEqual(parsed.statuses, snap.statuses);
  // каноничность: повторная сериализация того же снапшота байт-в-байт
  assert.equal(serializeSnapshot(snap), text);
  // сортировка: a_bot раньше b_bot раньше Z_bot (без учёта регистра)
  const idxA = text.indexOf('"a_bot"');
  const idxB = text.indexOf('"b_bot"');
  const idxZ = text.indexOf('"Z_bot"');
  assert.ok(idxA !== -1 && idxB !== -1 && idxZ !== -1);
  assert.ok(idxA < idxB && idxB < idxZ, 'statuses не отсортирован');
});

test('computeLivenessStats: без снапшотов — пустая статистика', () => {
  const stats = computeLivenessStats([]);
  assert.equal(stats.snapshots, 0);
  assert.deepEqual(stats.deaths, []);
  assert.deepEqual(stats.weekly, []);
});

test('computeLivenessStats: смерть фиксируется, дата смерти — первое dead-наблюдение', () => {
  const snaps = [
    buildLivenessSnapshot([ok('a_bot'), ok('b_bot')], '2026-10-19'),
    buildLivenessSnapshot([ok('a_bot'), dead('b_bot')], '2026-10-26'),
    buildLivenessSnapshot([ok('a_bot'), dead('b_bot')], '2026-11-02'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.snapshots, 3);
  assert.equal(stats.deaths.length, 1);
  assert.equal(stats.deaths[0].handle, 'b_bot');
  assert.equal(stats.deaths[0].diedOn, '2026-10-26'); // первое наблюдение смерти
  assert.equal(stats.deaths[0].firstSeen, '2026-10-19'); // впервые увидели живым
});

test('computeLivenessStats: воскрешение — dead→ok не числится погибшим', () => {
  // Случай: бот был недоступен/мёртв в одном прогоне, потом ожил (ошибка сети).
  const snaps = [
    buildLivenessSnapshot([ok('a_bot')], '2026-10-19'),
    buildLivenessSnapshot([dead('a_bot')], '2026-10-26'),
    buildLivenessSnapshot([ok('a_bot')], '2026-11-02'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths.length, 0, 'оживший бот не должен числиться погибшим');
  assert.equal(stats.lastStatus.get('a_bot').status, 'ok');
});

test('computeLivenessStats: unreachable не смерть', () => {
  const snaps = [
    buildLivenessSnapshot([ok('a_bot')], '2026-10-19'),
    buildLivenessSnapshot([unreachable('a_bot')], '2026-10-26'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths.length, 0);
});

test('renderDeathRegistry: без потерь — вежливая заглушка', () => {
  const text = renderDeathRegistry(computeLivenessStats([]));
  assert.match(text, /все живы/);
});

test('renderDeathRegistry: с погибшими — таблица с хендлом и датами', () => {
  const snaps = [
    buildLivenessSnapshot([ok('b_bot'), ok('a_bot')], '2026-04-20'),
    buildLivenessSnapshot([ok('a_bot'), dead('b_bot')], '2026-10-19'),
  ];
  const text = renderDeathRegistry(computeLivenessStats(snaps));
  assert.match(text, /@b_bot/);
  assert.match(text, /2026-04-20 — 2026-10-19/);
  assert.match(text, /2026-10-19/);
});

test('listSnapshotDates + loadSnapshots: читает директорию, фильтрует, сортирует, сверяет date', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'liveness-test-'));
  try {
    // пустая директория
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(listSnapshotDates(dir), []);

    // два снапшота + мусорный файл
    const s1 = buildLivenessSnapshot([ok('a_bot')], '2026-10-19');
    const s2 = buildLivenessSnapshot([ok('a_bot'), ok('b_bot')], '2026-10-26');
    writeFileSync(path.join(dir, '2026-10-19.json'), serializeSnapshot(s1));
    writeFileSync(path.join(dir, '2026-10-26.json'), serializeSnapshot(s2));
    writeFileSync(path.join(dir, 'notes.txt'), 'мусор');

    assert.deepEqual(listSnapshotDates(dir), ['2026-10-19', '2026-10-26']);

    const loaded = loadSnapshots(dir);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].date, '2026-10-19');
    assert.equal(loaded[1].total, 2);

    // date не совпадает с именем файла — ошибка, а не молчаливый сдвиг дат
    writeFileSync(path.join(dir, '2026-11-02.json'), serializeSnapshot(buildLivenessSnapshot([ok('a_bot')], '2026-11-01')));
    assert.throws(() => loadSnapshots(dir), /не совпадает с именем файла/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
