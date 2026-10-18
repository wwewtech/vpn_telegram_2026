// Юнит-тесты валидатора JSON Schema (scripts/validate-schema.mjs).
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAgainstSchema } from '../scripts/validate-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = JSON.parse(readFileSync(path.join(ROOT, 'schema', 'bots.schema.json'), 'utf8'));

const bot = (handle, extra = {}) => ({ handle, ...extra });

test('валидатор схемы: реальная схема + корректные данные — без ошибок', () => {
  const { errors } = checkAgainstSchema([bot('valid_bot'), bot('other_bot', { verified: '2026-10' })], SCHEMA);
  assert.deepEqual(errors, []);
});

test('валидатор схемы: реальные data/bots.json проходят', () => {
  const data = JSON.parse(readFileSync(path.join(ROOT, 'data', 'bots.json'), 'utf8'));
  const { errors } = checkAgainstSchema(data, SCHEMA);
  assert.deepEqual(errors, []);
});

test('валидатор схемы: короткий хендл отклоняется (pattern)', () => {
  const { errors } = checkAgainstSchema([bot('ab')], SCHEMA);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /handle.*шаблон/);
});

test('валидатор схемы: хендл с недопустимыми символами отклоняется', () => {
  const { errors } = checkAgainstSchema([bot('bad-handle!')], SCHEMA);
  assert.equal(errors.length, 1);
});

test('валидатор схемы: хендл длиннее 32 символов отклоняется', () => {
  const { errors } = checkAgainstSchema([bot('a'.repeat(33))], SCHEMA);
  assert.equal(errors.length, 1);
});

test('валидатор схемы: отсутствующий handle отклоняется (required)', () => {
  const { errors } = checkAgainstSchema([{ verified: '2026-10' }], SCHEMA);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /обязательное поле "handle"/);
});

test('валидатор схемы: лишнее поле отклоняется (additionalProperties: false)', () => {
  const { errors } = checkAgainstSchema([bot('valid_bot', { note: 'x' })], SCHEMA);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /неизвестное поле "note"/);
});

test('валидатор схемы: verified не по формату отклоняется', () => {
  assert.equal(checkAgainstSchema([bot('valid_bot', { verified: '2026-1' })], SCHEMA).errors.length, 1);
  assert.equal(checkAgainstSchema([bot('valid_bot', { verified: '2026-13' })], SCHEMA).errors.length, 1);
  assert.equal(checkAgainstSchema([bot('valid_bot', { verified: '26-10' })], SCHEMA).errors.length, 1);
});

test('валидатор схемы: verified числом отклоняется (type)', () => {
  const { errors } = checkAgainstSchema([bot('valid_bot', { verified: 202610 })], SCHEMA);
  assert.ok(errors.length >= 1);
});

test('валидатор схемы: пустой массив отклоняется (minItems)', () => {
  const { errors } = checkAgainstSchema([], SCHEMA);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /минимум 1/);
});

test('валидатор схемы: не-массив отклоняется (type)', () => {
  const { errors } = checkAgainstSchema({ handle: 'valid_bot' }, SCHEMA);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ожидается тип array/);
});

test('валидатор схемы: строка вместо объекта записи отклоняется', () => {
  const { errors } = checkAgainstSchema(['valid_bot'], SCHEMA);
  assert.equal(errors.length, 1);
});

test('валидатор схемы: несколько ошибок собираются вместе', () => {
  const { errors } = checkAgainstSchema([bot('ab'), bot('cd', { extra: 1 })], SCHEMA);
  assert.equal(errors.length, 3); // короткий хендл, короткий хендл, лишнее поле
});

test('валидатор схемы: битая схема (неподдерживаемый ключ) не молчит', () => {
  const badSchema = { ...SCHEMA, minLength: 5 };
  const { errors } = checkAgainstSchema([bot('valid_bot')], badSchema);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /не поддерживает ключ "minLength"/);
});

test('валидатор схемы: схема не объект — отказ, а не падение', () => {
  const { errors } = checkAgainstSchema([bot('valid_bot')], null);
  assert.equal(errors.length, 1);
});

test('валидатор схемы (файлы): битый JSON данных читается как ошибка, не падение', async () => {
  const { validateSchemaFiles } = await import('../scripts/validate-schema.mjs');
  const { errors } = validateSchemaFiles('no-such-file.json', path.join(ROOT, 'schema', 'bots.schema.json'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /не удалось прочитать/);
});

test('валидатор схемы (файлы): битая схема читается как ошибка, не падение', async () => {
  const { validateSchemaFiles } = await import('../scripts/validate-schema.mjs');
  const { errors } = validateSchemaFiles(path.join(ROOT, 'data', 'bots.json'), 'no-such-schema.json');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /не удалось прочитать/);
});

test('валидатор схемы (файлы): реальные файлы проходят', async () => {
  const { validateSchemaFiles } = await import('../scripts/validate-schema.mjs');
  const { errors } = validateSchemaFiles();
  assert.deepEqual(errors, []);
});

test('валидатор схемы: записи с null и boolean отклоняются', () => {
  assert.equal(checkAgainstSchema([null], SCHEMA).errors.length, 1);
  assert.equal(checkAgainstSchema([true], SCHEMA).errors.length, 1);
});

test('валидатор схемы: тип-массив в схеме (string|null) принимается валидатором', () => {
  const schema = { ...SCHEMA, items: { ...SCHEMA.items, properties: { ...SCHEMA.items.properties, handle: { type: ['string', 'null'] } } } };
  const { errors } = checkAgainstSchema([bot('valid_bot')], schema);
  assert.deepEqual(errors, []);
});

test('валидатор схемы: пустая запись без required-полей даёт одну понятную ошибку', () => {
  const { errors } = checkAgainstSchema([{}], SCHEMA);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /обязательное поле "handle"/);
});
