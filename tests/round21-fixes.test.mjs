// Тесты раунда 21: валидатор JSON Schema + защита сида-реестра.
//
// Запуск: node --test tests/
//
// Покрытие:
//   - additionalProperties: false БЕЗ properties — отвергает любые ключи (раньше пропускал молча).
//   - additionalProperties как схема — валидирует значения по ключам, а не весь объект
//     (statuses:{foo:'zombie'} отвергается, а не «ожидается тип string» для объекта).
//   - integer тип в JSON Schema совпадает с JS number (реальные снапшоты с total:354
//     не валились бы с «ожидается тип integer, получен number»).
//   - pattern на вложенных/leaf-схемах работает.
//   - Seed-реестр: два сида, отличающиеся только регистром, не дают двух строк реестра
//     (дедуп по нижнему регистру срабатывает внутри одного прогона CLI).
//   - невалидный diedOn в сиде — громкий отказ до попадания в реестр.
//
// Песочница: копии scripts/liveness-stats.mjs, scripts/lib.mjs, schema/ и
// синтетические снапшоты + seed — рабочий репозиторий не трогается.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkAgainstSchema } from '../scripts/validate-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- validate-schema.mjs ----------

const BOGUS_LIVENESS = {
  date: '2026-11-06',
  total: 354,
  ok: 354,
  dead: 0,
  unreachable: 0,
  notbot: 0,
  statuses: { foo: 'zombie' },
};
const LIVENESS_SCHEMA = JSON.parse(readFileSync(path.join(ROOT, 'schema', 'liveness.schema.json'), 'utf8'));

test('валидатор схемы: additionalProperties: false без properties отвергает любые ключи', () => {
  const schema = { type: 'object', additionalProperties: false };
  const { errors } = checkAgainstSchema({ x: 1 }, schema);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /неизвестное поле "x"/);
});

test('валидатор схемы: additionalProperties как схема валидирует значения по ключам', () => {
  const { errors } = checkAgainstSchema(BOGUS_LIVENESS, LIVENESS_SCHEMA);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /шаблон \^\(ok\|dead\|unreachable\|notbot\)\$$/);
});

test('валидатор схемы: integer тип принимает JS number (реальный снапшот проходит)', () => {
  const real = JSON.parse(readFileSync(path.join(ROOT, 'data', 'liveness', '2026-11-06.json'), 'utf8'));
  const { errors } = checkAgainstSchema(real, LIVENESS_SCHEMA);
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test('валидатор схемы: pattern на вложенном свойстве работает', () => {
  const schema = { type: 'object', properties: { a: { type: 'string', pattern: '^ok$' } } };
  const { errors } = checkAgainstSchema({ a: 'nope' }, schema);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /шаблон/);
});

// ---------- liveness-stats.mjs: seed-дедуп по регистру ----------

function makeLivenessSandbox(t, seed, snapshots) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vpn-liveness-seed21-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'data', 'liveness'), { recursive: true });
  mkdirSync(path.join(dir, 'schema'), { recursive: true });
  for (const file of ['lib.mjs', 'liveness-stats.mjs']) {
    copyFileSync(path.join(ROOT, 'scripts', file), path.join(dir, 'scripts', file));
  }
  copyFileSync(path.join(ROOT, 'schema', 'liveness.schema.json'), path.join(dir, 'schema', 'liveness.schema.json'));
  for (const [date, statuses] of Object.entries(snapshots ?? {})) {
    const statusList = Object.values(statuses);
    writeFileSync(path.join(dir, 'data', 'liveness', `${date}.json`), JSON.stringify({
      date, total: statusList.length, ok: statusList.filter(s => s === 'ok').length,
      dead: statusList.filter(s => s === 'dead').length, unreachable: 0, notbot: 0, statuses,
    }));
  }
  writeFileSync(path.join(dir, 'data', 'liveness', 'seed-deaths.json'), JSON.stringify(seed, null, 2));
  return dir;
}

function runStatsScript(dir, ...args) {
  const run = spawnSync(process.execPath, [path.join('scripts', 'liveness-stats.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { code: run.status, stdout: `${run.stdout || ''}${run.stderr || ''}` };
}

test('сид: два хендла, отличающиеся только регистром, — одна строка реестра', (t) => {
  const dir = makeLivenessSandbox(t, {
    Aa_bot: { firstSeen: '2026-10-20', diedOn: '2026-11-01', note: 'первая запись' },
    aa_BOT: { firstSeen: '2026-10-21', diedOn: '2026-11-02', note: 'дубль по регистру' },
  }, { '2026-10-26': { aa_bot: 'ok' } });

  const result = runStatsScript(dir, '--markdown');

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  // Считаем ТОЛЬКО строки таблицы реестра: тот же хендл ещё встречается в
  // предупреждении «⚠ Сид: @...», которое не является строкой реестра.
  const rows = (result.stdout.match(/^\|\s*@aa_bot\s*\|/gim) ?? []);
  assert.equal(rows.length, 1, `дубль по регистру попал в реестр дважды: ${result.stdout}`);
  assert.match(result.stdout, /первая запись/, 'первая запись сида потеряна');
});

test('сид: некорректный diedOn — громкий отказ до попадания в реестр', (t) => {
  const dir = makeLivenessSandbox(t, {
    bad_bot: { firstSeen: '2026-10-20', diedOn: 'not-a-date' },
  }, {});

  const result = runStatsScript(dir);

  assert.equal(result.code, 1, `ожидался exit 1, получено ${result.code}`);
  assert.match(result.stdout, /diedOn обязательно/, 'нет ошибки о невалидном diedOn');
});
