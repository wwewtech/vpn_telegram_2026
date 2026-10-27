// Тесты раунда 18: Z1 — троттлинг vs разметка в канарейке типа.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cl = readFileSync(path.join(ROOT, 'scripts/check-links.mjs'), 'utf8');

test('Z1: null-тип (троттлинг: extra нет) — ворнинг, НЕ фатал', () => {
  const nullBranch = cl.match(/liveType === null[\s\S]{0,400}?else if/s);
  assert.ok(nullBranch, 'ветка null существует и отделена от фатала');
  assert.ok(nullBranch[0].includes('console.warn'), 'null → ворнинг');
  assert.ok(!nullBranch[0].includes('ok: false'), 'null НЕ фаталит (троттлинг — не сбой разметки)');
});

test('Z1: не-null и не-bot (разметка изменилась) — фатал сохранён', () => {
  // Фрагмент: liveType !== 'bot') { ... ok: false — ok:false ближе, чем W2 в detail
  const fatalBranch = cl.match(/liveType !== 'bot'\)[\s\S]{0,300}?ok: false/s);
  assert.ok(fatalBranch, 'фатал в else-if для изменённого типа');
  // W2 проверяем в более широком контексте после фатала
  const wider = cl.slice(cl.indexOf("liveType !== 'bot'"), cl.indexOf("liveType !== 'bot'") + 600);
  assert.ok(wider.includes('W2'), 'сообщение указывает на детектор W2');
});
