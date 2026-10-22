// Интеграционные тесты CLI-скриптов: поведение при сбоях и отказоустойчивость.
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Песочница с копией скриптов и схемы: тесты не трогают рабочий репозиторий.
function makeSandbox(botsJson) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vpn-cli-test-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'schema'), { recursive: true });
  for (const file of ['lib.mjs', 'sort-bots.mjs', 'validate.mjs', 'validate-schema.mjs']) {
    copyFileSync(path.join(ROOT, 'scripts', file), path.join(dir, 'scripts', file));
  }
  copyFileSync(path.join(ROOT, 'schema/bots.schema.json'), path.join(dir, 'schema/bots.schema.json'));
  writeFileSync(path.join(dir, 'data/bots.json'), botsJson);
  return dir;
}

function runScript(dir, script) {
  try {
    const stdout = execFileSync(process.execPath, [path.join('scripts', script)], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: (error.stdout || '') + (error.stderr || '') };
  }
}

test('sort-bots: битый handle (не строка) — падает и НЕ трогает файл', () => {
  // Регрессия: раньше handle: 123 молча считался пустым хендлом, сортировался
  // в начало, файл переписывался (потеря исходных данных) и exit code был 0.
  const dir = makeSandbox('[\n  { "handle": "a_bot" },\n  { "handle": 123 }\n]\n');
  const before = readFileSync(path.join(dir, 'data/bots.json'), 'utf8');
  const result = runScript(dir, 'sort-bots.mjs');
  assert.equal(result.code, 1, `ожидался exit 1, получено ${result.code}`);
  assert.match(result.stdout, /handle/);
  assert.equal(readFileSync(path.join(dir, 'data/bots.json'), 'utf8'), before, 'файл изменён при битых данных');
  rmSync(dir, { recursive: true, force: true });
});

test('sort-bots: пустой массив — падает и не затирает файл', () => {
  const dir = makeSandbox('[]');
  const result = runScript(dir, 'sort-bots.mjs');
  assert.equal(result.code, 1);
  assert.equal(readFileSync(path.join(dir, 'data/bots.json'), 'utf8'), '[]');
  rmSync(dir, { recursive: true, force: true });
});

test('sort-bots: битый JSON — падает и не затирает файл', () => {
  const dir = makeSandbox('{ broken');
  const result = runScript(dir, 'sort-bots.mjs');
  assert.equal(result.code, 1);
  assert.equal(readFileSync(path.join(dir, 'data/bots.json'), 'utf8'), '{ broken');
  rmSync(dir, { recursive: true, force: true });
});

test('sort-bots: нормализует порядок ключей при сортировке', () => {
  const dir = makeSandbox('[\n  { "verified": "2026-09", "handle": "a_bot" }\n]\n');
  const result = runScript(dir, 'sort-bots.mjs');
  assert.equal(result.code, 0);
  const out = readFileSync(path.join(dir, 'data/bots.json'), 'utf8');
  assert.ok(out.includes('"handle": "a_bot", "verified"'), `порядок ключей не нормализован: ${out.trim()}`);
  rmSync(dir, { recursive: true, force: true });
});

test('sort-bots: отсортированные данные — идемпотентен, файл не меняется', () => {
  const dir = makeSandbox('[\n  { "handle": "a_bot" },\n  { "handle": "b_bot" }\n]\n');
  const before = readFileSync(path.join(dir, 'data/bots.json'), 'utf8');
  const result = runScript(dir, 'sort-bots.mjs');
  assert.equal(result.code, 0);
  assert.equal(readFileSync(path.join(dir, 'data/bots.json'), 'utf8'), before);
  rmSync(dir, { recursive: true, force: true });
});

test('validate и validate-schema: одинаково отвергают битый handle', () => {
  const broken = '[\n  { "handle": 123 }\n]\n';
  const dir = makeSandbox(broken);
  assert.equal(runScript(dir, 'validate.mjs').code, 1, 'validate.mjs принял битый handle');
  assert.equal(runScript(dir, 'validate-schema.mjs').code, 1, 'validate-schema.mjs принял битый handle');
  rmSync(dir, { recursive: true, force: true });
});
