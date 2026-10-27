// Тесты раунда 15: tmeEntityType (W2), seed-deaths (W3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmeEntityType, renderDeathRegistry } from '../scripts/lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// === W2: tmeEntityType ===
const BOT_HTML = (handle, extra) =>
  `<meta property="og:title" content="X"><div class="tgme_page_extra">${extra}</div>`;
const CHANNEL_HTML = (subs) =>
  `<meta property="og:title" content="X"><div class="tgme_page_extra">${subs} subscribers</div>`;
const GROUP_HTML = (mem) =>
  `<meta property="og:title" content="X"><div class="tgme_page_extra">${mem} members, 5 online</div>`;

test('W2: бот (extra @handle) — тип bot', () => {
  assert.equal(tmeEntityType(BOT_HTML('test_bot', '@test_bot'), 'test_bot'), 'bot');
  // регистр не важен
  assert.equal(tmeEntityType(BOT_HTML('TestBot', '@testbot'), 'TestBot'), 'bot');
});

test('W2: канал (N subscribers) — тип channel', () => {
  assert.equal(tmeEntityType(CHANNEL_HTML(831), 'GuardianVPN'), 'channel');
  assert.equal(tmeEntityType(CHANNEL_HTML(1571), 'Cheburnet_Bot_VPN'), 'channel');
  assert.equal(tmeEntityType(CHANNEL_HTML(1), 'x_bot'), 'channel');
});

test('W2: группа (N members) — тип group', () => {
  assert.equal(tmeEntityType(GROUP_HTML(100), 'chat_bot'), 'group');
});

test('W2: extra «bot»/«бот» без @ — тип bot', () => {
  assert.equal(tmeEntityType(BOT_HTML('x', 'bot'), 'x_bot'), 'bot');
  assert.equal(tmeEntityType(BOT_HTML('x', 'бот'), 'x_bot'), 'bot');
});

test('W2: нет extra — null (не вето, сигнал)', () => {
  assert.equal(tmeEntityType('<meta property="og:title" content="X">', 'x_bot'), null);
});

test('W2: несовпадение @handle и extra без ключевых слов — null', () => {
  assert.equal(tmeEntityType(BOT_HTML('a', '@someone_else'), 'a_bot'), null);
});

// === W3: seed-deaths ===
test('W3: сид-файл существует и валиден JSON', () => {
  const p = path.join(ROOT, 'data', 'liveness', 'seed-deaths.json');
  assert.ok(existsSync(p), 'сид-файл на месте');
  const seed = JSON.parse(readFileSync(p, 'utf8'));
  assert.ok(seed.krona_vps_bot, 'krona в сидe');
  assert.equal(seed.krona_vps_bot.diedOn, '2026-10-19');
  assert.ok(seed.krona_vps_bot.firstSeen, 'дата добавления есть');
});

test('W3: renderDeathRegistry с сидом — krona отображается', () => {
  const stats = { deaths: [{ handle: 'krona_vps_bot', diedOn: '2026-10-19', firstSeen: '2026-04-20' }] };
  const text = renderDeathRegistry(stats);
  assert.match(text, /@krona_vps_bot/);
  assert.match(text, /2026-04-20 — 2026-10-19/);
});
