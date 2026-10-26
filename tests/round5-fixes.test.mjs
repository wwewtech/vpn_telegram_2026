// Тесты фиксов раунда 5: понятная ошибка битого снапшота, сортировка в stats.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLivenessSnapshot,
  computeLivenessStats,
  loadSnapshots,
} from '../scripts/lib.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('loadSnapshots: битый (не-JSON) снапшот — понятная ошибка с именем файла', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r5-k1-'));
  try {
    mkdirSync(path.join(dir), { recursive: true });
    writeFileSync(path.join(dir, '2026-10-26.json'), 'NOT JSON AT ALL');
    assert.throws(() => loadSnapshots(dir), (err) => {
      assert.match(err.message, /не удалось прочитать/);
      assert.match(err.message, /2026-10-26\.json/);
      return true;
    }, 'ошибка должна называть файл, а не сырой JSON-трейс');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeLivenessStats: несортированные снапшоты — хронология восстанавливается', () => {
  // Обратный порядок на входе: [26(dead), 05(ok)] — хронологически бот жил 05-го, умер 26-го.
  // Без сортировки lastStatus брал последний элемент массива (ok от 05-го) —
  // умерший выпадал из реестра (воспроизведено при охоте).
  const unsorted = [
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-26'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-05'),
  ];
  const stats = computeLivenessStats(unsorted);
  assert.equal(stats.lastStatus.get('a_bot').status, 'dead', 'последний по ХРОНОЛОГИИ, не по массиву');
  assert.equal(stats.lastStatus.get('a_bot').date, '2026-10-26');
  assert.equal(stats.deaths.length, 1, 'умерший в реестре');
  assert.equal(stats.deaths[0].diedOn, '2026-10-26');
  assert.equal(stats.deaths[0].firstSeen, '2026-10-05');
});

test('computeLivenessStats: weekly сортируется по датам', () => {
  const unsorted = [
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-26'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-05'),
  ];
  const stats = computeLivenessStats(unsorted);
  assert.equal(stats.weekly[0].date, '2026-10-05');
  assert.equal(stats.weekly[1].date, '2026-10-26');
});

test('computeLivenessStats: отсортированный вход — результат прежний (регресс)', () => {
  const snaps = [
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'ok' }], '2026-10-05'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-12'),
    buildLivenessSnapshot([{ handle: 'a_bot', status: 'dead' }], '2026-10-19'),
  ];
  const stats = computeLivenessStats(snaps);
  assert.equal(stats.deaths[0].diedOn, '2026-10-12');
});
