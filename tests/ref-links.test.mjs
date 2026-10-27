// Тесты фикса T10: REF_LINK_RE ловит все схемы реферальных ссылок.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REF_LINK_RE } from '../scripts/lib.mjs';

test('T10: основной случай t.me с ?start — ловится', () => {
  assert.ok(REF_LINK_RE.test('https://t.me/bot?start=ref'));
  assert.ok(REF_LINK_RE.test('смотри https://t.me/x?start=123 тут'));
});

test('T10: tg://resolve с параметрами — теперь ловится', () => {
  assert.ok(REF_LINK_RE.test('tg://resolve?domain=x&start=y'), 'tg:// схема — главная дыра T10');
});

test('T10: telegram.me (старый домен) с параметрами — ловится', () => {
  assert.ok(REF_LINK_RE.test('https://telegram.me/bot?start=1'));
});

test('T10: #fragment — ловится', () => {
  assert.ok(REF_LINK_RE.test('https://t.me/bot#ref'));
});

test('T10: чистые ссылки НЕ помечаются', () => {
  assert.ok(!REF_LINK_RE.test('https://t.me/clean_bot'));
  assert.ok(!REF_LINK_RE.test('https://t.me/clean_bot — без параметров'));
  assert.ok(!REF_LINK_RE.test('tg://join?invite=abc'));
});

test('T10: строки таблицы с чистыми t.me-ссылками не помечаются', () => {
  const row = '| 1 | @a_bot | [t.me/a_bot](https://t.me/a_bot) |';
  assert.ok(!REF_LINK_RE.test(row));
});
