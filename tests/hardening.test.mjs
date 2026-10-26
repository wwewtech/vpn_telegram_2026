// Тесты фиксов N2 (serializeBots undefined) и N5 (applyVerified checkedAt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVerified, serializeBots } from '../scripts/lib.mjs';

// === N2: serializeBots + undefined ===
test('serializeBots: verified:undefined не ломает JSON (round-trip)', () => {
  const out = serializeBots([{ handle: 'a_bot', verified: undefined }]);
  // Ключевое: результат обязан парситься
  const parsed = JSON.parse(out);
  assert.equal(parsed[0].handle, 'a_bot');
  assert.equal(parsed[0].verified, undefined, 'undefined-ключ исчез (что и ожидалось от JSON)');
});

test('serializeBots: обычные значения не затронуты', () => {
  const out = serializeBots([{ handle: 'a_bot', verified: '2026-10' }]);
  const parsed = JSON.parse(out);
  assert.equal(parsed[0].verified, '2026-10');
});

// === N5: applyVerified валидирует checkedAt ===
test('applyVerified: мусорный checkedAt — бросает', () => {
  assert.throws(() => applyVerified([{ handle: 'a_bot' }], [{ handle: 'a_bot', status: 'ok' }], 'мусор-123'), /checkedAt/);
  assert.throws(() => applyVerified([{ handle: 'a_bot' }], [{ handle: 'a_bot', status: 'ok' }], '2026-1'), /checkedAt/);
  assert.throws(() => applyVerified([{ handle: 'a_bot' }], [{ handle: 'a_bot', status: 'ok' }], undefined), /checkedAt/);
});

test('applyVerified: валидный checkedAt работает как раньше', () => {
  const { bots, changed } = applyVerified([{ handle: 'a_bot' }], [{ handle: 'a_bot', status: 'ok' }], '2026-10');
  assert.equal(changed, 1);
  assert.equal(bots[0].verified, '2026-10');
});
