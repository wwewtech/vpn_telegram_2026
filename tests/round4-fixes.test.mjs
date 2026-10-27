// Тесты фиксов раунда 4: validate обоих README, пустой handle, дедуп findRegion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sandbox(files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r4-'));
  for (const d of ['scripts', 'schema', 'data']) mkdirSync(path.join(dir, d), { recursive: true });
  for (const f of readdirSync(path.join(ROOT, 'scripts'))) copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
  copyFileSync(path.join(ROOT, 'schema/bots.schema.json'), path.join(dir, 'schema/bots.schema.json'));
  copyFileSync(path.join(ROOT, 'data/bots.json'), path.join(dir, 'data/bots.json'));
  copyFileSync(path.join(ROOT, 'README.md'), path.join(dir, 'README.md'));
  copyFileSync(path.join(ROOT, 'README_EN.md'), path.join(dir, 'README_EN.md'));
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(dir, rel), content);
  return dir;
}

function run(dir, script) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join('scripts', script)], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('validate.mjs: реферальная ссылка в README_EN — ловится', () => {
  const dir = sandbox();
  try {
    const en = readFileSync(path.join(dir, 'README_EN.md'), 'utf8')
      .replace('[CONTRIBUTING.md](CONTRIBUTING.md)', '[CONTRIBUTING.md](CONTRIBUTING.md) — see https://t.me/somebot?start=ref');
    writeFileSync(path.join(dir, 'README_EN.md'), en);
    const r = run(dir, 'validate.mjs');
    assert.equal(r.code, 1, 'validate должен упасть');
    assert.match(r.out, /README_EN\.md/);
    assert.match(r.out, /с параметрами/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validate.mjs: двойные маркеры в README_EN — ловятся', () => {
  const dir = sandbox();
  try {
    const en = readFileSync(path.join(dir, 'README_EN.md'), 'utf8') + '\n<!-- BOTS:START -->\n| x |\n<!-- BOTS:END -->\n';
    writeFileSync(path.join(dir, 'README_EN.md'), en);
    const r = run(dir, 'validate.mjs');
    assert.equal(r.code, 1);
    assert.match(r.out, /README_EN\.md/);
    assert.match(r.out, /ровно по одному маркеру/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validate.mjs: чистые файлы — проходит с сообщением про RU и EN', () => {
  const dir = sandbox();
  try {
    const r = run(dir, 'validate.mjs');
    assert.equal(r.code, 0);
    assert.match(r.out, /RU и EN/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generate-readme.mjs: пустой handle — падает, README не тронут', () => {
  const dir = sandbox();
  try {
    writeFileSync(path.join(dir, 'data/bots.json'), '[\n  { "handle": "" }\n]\n');
    const before = readFileSync(path.join(dir, 'README.md'), 'utf8');
    const r = run(dir, 'generate-readme.mjs');
    assert.equal(r.code, 1, 'должен упасть на пустом handle');
    assert.match(r.out, /пустым handle/);
    assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), before, 'README перезаписан мусором!');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generate-readme.mjs: валидные данные — работает как раньше', () => {
  const dir = sandbox();
  try {
    const r = run(dir, 'generate-readme.mjs');
    assert.equal(r.code, 0);
    // Число ботов меняется с каталогом — проверяем динамически по данным песочницы
    const data = JSON.parse(readFileSync(path.join(dir, 'data/bots.json'), 'utf8'));
    assert.match(r.out, new RegExp(`${data.length} ботов`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
