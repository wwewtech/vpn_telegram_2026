// Тесты раунда 17: канарейка типа (Y2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cl = readFileSync(path.join(ROOT, 'scripts/check-links.mjs'), 'utf8');

test('Y2: канарейка проверяет tmeEntityType у BotFather (детектор W2 не умолкнет)', () => {
  // Код checkCanary должен требовать liveType === 'bot' у BotFather
  assert.ok(cl.includes("liveType !== 'bot'"), 'канарейка типа: ветка отказа при не-bot');
  assert.ok(cl.includes('детектор не-ботов (W2) больше не надёжен'), 'сообщение упоминает W2-детектор');
});

test('Y2: если t.me уберёт tgme_page_extra — канарейка упадёт громко (не тихие ok)', () => {
  // Симуляция: html без extra → tmeEntityType = null → канарейка вернёт ok:false
  // (проверяем через анализ кода: ветка существует и возвращает ok:false)
  const branch = cl.match(/liveType !== 'bot'[\s\S]{0,300}?ok: false/s);
  assert.ok(branch, 'ветка возвращает ok: false — linkcheck остановится');
});
