// Тесты U7: адаптивная канарейка — «оживление» = помеха, не блок.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cl = readFileSync(path.join(ROOT, 'scripts/check-links.mjs'), 'utf8');

test('U7: CANARY_DEAD валиден по HANDLE_RE (t.me отвечает заглушкой на валидные)', () => {
  const canary = cl.match(/CANARY_DEAD = '([^']+)'/)?.[1];
  assert.ok(canary);
  // 24 симв — валидный формат: t.me отвечает Contact-заглушкой (проверено живьём)
  assert.ok(/^[A-Za-z0-9_]{5,32}$/.test(canary), 'валидный формат — заглушка гарантирована');
});

test('U7: оживление канарейки — ворнинг, не блок (по коду checkCanary)', () => {
  // старое поведение: return { ok: false } при НЕ-Contact → linkcheck навсегда сломан
  // новое: console.warn + продолжение — ветка оживления НЕ возвращает ok:false
  const block = cl.match(/U7: хендл «ожил»[\s\S]*?return \{ ok: true \}/)?.[0];
  assert.ok(block, 'ветка оживления должна завершаться ok:true (не блокируя)');
  assert.ok(block.includes('console.warn'), 'ворнинг выводится');
  assert.ok(!block.includes("ok: false, detail: `несуществующий"), 'старый фатал удалён из ветки оживления');
});
