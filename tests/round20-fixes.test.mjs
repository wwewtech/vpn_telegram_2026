// Тесты раунда 20: AC4 — смерть ПОСЛЕ последнего снапшота перестала теряться.
//
// Запуск: node --test tests/
//
// Регрессия, которую здесь закрываем: guard X3 (раунд 16) пропускал любую
// seed-запись, хендл которой живой в снапшотах. Для krona_vps_bot это верно
// (бот ре-регистрировали → воскрешение), но для бота, умершего ПОСЛЕ последнего
// наблюдения и удалённого из каталога, тот же guard молча съедал запись:
// бот ок в 26.10, отсутствует в поздних снапшотах, реестр из снапшотов считает
// его живым, а сид — единственный способ такую смерть записать — отбрасывался.
//
// Контракт проверяется ПРОГОНОМ настоящего CLI (node scripts/liveness-stats.mjs)
// в песочнице: в раунде 19 контракт сида закреплялся только regex'ами по
// исходнику, а regex по тексту не отличает «пропуск из-за воскрешения» от
// «пропуска нужной смерти» — оба выглядят как один `continue`.
//
// Песочница: копии scripts/liveness-stats.mjs, scripts/lib.mjs, schema/ и
// синтетические снапшоты + seed — рабочий репозиторий не трогается.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Два наблюдения: в первом both1 жив, во втором его уже нет (удалён из
// каталога). later1 во втором снапшоте жив — он и проверяет сценарий
// воскрешения: смерть из сида случилась до последнего наблюдения.
const SNAP_A = JSON.stringify({
  date: '2026-10-26',
  total: 2,
  ok: 2,
  dead: 0,
  unreachable: 0,
  notbot: 0,
  statuses: { both1_vpn_bot: 'ok', later1_vpn_bot: 'ok' },
});
const SNAP_B = JSON.stringify({
  date: '2026-11-06',
  total: 1,
  ok: 1,
  dead: 0,
  unreachable: 0,
  notbot: 0,
  statuses: { later1_vpn_bot: 'ok' },
});

function makeSandbox(t, seed) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vpn-liveness-seed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'data', 'liveness'), { recursive: true });
  mkdirSync(path.join(dir, 'schema'), { recursive: true });
  for (const file of ['lib.mjs', 'liveness-stats.mjs']) {
    copyFileSync(path.join(ROOT, 'scripts', file), path.join(dir, 'scripts', file));
  }
  copyFileSync(path.join(ROOT, 'schema', 'liveness.schema.json'), path.join(dir, 'schema', 'liveness.schema.json'));
  writeFileSync(path.join(dir, 'data', 'liveness', '2026-10-26.json'), SNAP_A);
  writeFileSync(path.join(dir, 'data', 'liveness', '2026-11-06.json'), SNAP_B);
  writeFileSync(path.join(dir, 'data', 'liveness', 'seed-deaths.json'), JSON.stringify(seed, null, 2));
  return dir;
}

function runScript(dir, ...args) {
  // spawnSync, а не execFileSync: предупреждения сида идут в stderr, а
  // execFileSync сбрасывает stderr при успешном коде — и тест на текст
  // предупреждения падал бы, не увидев сообщения вовсе.
  const run = spawnSync(process.execPath, [path.join('scripts', 'liveness-stats.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { code: run.status, stdout: `${run.stdout || ''}${run.stderr || ''}` };
}

// ---------- AC4: смерть после последнего наблюдения записывается ----------

test('AC4: смерть после последнего снапшота попадает в реестр с предупреждением', (t) => {
  const dir = makeSandbox(t, {
    both1_vpn_bot: { firstSeen: '2026-10-26', diedOn: '2026-11-06' },
  });

  const result = runScript(dir);

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  assert.match(result.stdout, /@both1_vpn_bot: наблюдался 2026-10-26 — 2026-11-06/, 'смерть не попала в реестр');
  assert.match(result.stdout, /после последнего наблюдения/, 'нет предупреждения о смерти вне снапшотов');
});

test('AC4: markdown-реестр рисует строку умершего вне снапшотов', (t) => {
  const dir = makeSandbox(t, {
    both1_vpn_bot: { firstSeen: '2026-10-26', diedOn: '2026-11-06', note: 'Тестовая эпитафия.' },
  });

  const result = runScript(dir, '--markdown');

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  assert.match(result.stdout, /\| @both1_vpn_bot \| 2026-10-26 — 2026-11-06 \| 2026-11-06 \|/, 'строка реестра не отрендерена');
  assert.match(result.stdout, /Тестовая эпитафия\./, 'заметка не отрендерена');
});

// ---------- AC4: воскрешение по-прежнему сильнее сида ----------

test('AC4: смерть ДО последнего наблюдения по-прежнему пропускается', (t) => {
  const dir = makeSandbox(t, {
    later1_vpn_bot: { firstSeen: '2026-10-26', diedOn: '2026-10-30' },
  });

  const result = runScript(dir);

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  assert.match(result.stdout, /воскрешение, сид пропущен/, 'предупреждение о воскрешении пропало');
  assert.doesNotMatch(result.stdout, /@later1_vpn_bot: наблюдался/, 'воскресший бот попал в реестр');
});

test('AC4: хендл мёртв в снапшотах — сид не дописывается и предупреждений нет', (t) => {
  const seed = { only_dead_bot: { firstSeen: '2026-10-26', diedOn: '2026-10-30' } };
  const dir = makeSandbox(t, seed);
  // Переписываем поздний снапшот: хендл есть в нём и он dead — notbot/ok/aliveNow
  // его уже не считают живым, seed-запись должна вытесняться снапшотами.
  writeFileSync(path.join(dir, 'data', 'liveness', '2026-11-06.json'), JSON.stringify({
    date: '2026-11-06',
    total: 1,
    ok: 0,
    dead: 1,
    unreachable: 0,
    notbot: 0,
    statuses: { only_dead_bot: 'dead' },
  }));

  const result = runScript(dir);

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  assert.match(result.stdout, /@only_dead_bot: наблюдался/, 'смерть из снапшотов не попала в реестр');
  assert.doesNotMatch(result.stdout, /⚠ Сид:/, 'появилось предупреждение сида там, где сид не причём');
});

// ---------- Регрессия: граница — собственное наблюдение бота, а не глобальная дата ----------

// Реальный случай из прод-реестра: бот жил и наблюдался 26.10, затем умер и был
// удалён из каталога — в поздних снапшотах его уже нет. При этом снапшоты
// продолжались ещё до 10.11 (другие боты добавлялись). Старая реализация
// сравнивала diedOn с ГЛОБАЛЬНОЙ датой последнего снапшота (10.11) и решала,
// что бот «воскрес» (умер 06.11 < 10.11), из-за чего запись смерти молча
// выбрасывалась из реестра. Правильная граница — собственное последнее
// наблюдение бота (26.10): 06.11 позже него → смерть записывается.
test('AC4: смерть после СОБСТВЕННОГО наблюдения записывается, даже если снапшоты шли дальше', (t) => {
  const dir = makeSandbox(t, {
    both1_vpn_bot: { firstSeen: '2026-10-26', diedOn: '2026-11-06' },
  });
  // Поздний снапшот: бота в каталоге уже нет, но наблюдения продолжались.
  writeFileSync(path.join(dir, 'data', 'liveness', '2026-11-10.json'), JSON.stringify({
    date: '2026-11-10',
    total: 1,
    ok: 1,
    dead: 0,
    unreachable: 0,
    notbot: 0,
    statuses: { later1_vpn_bot: 'ok' },
  }));

  const result = runScript(dir);

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  assert.match(result.stdout, /@both1_vpn_bot: наблюдался 2026-10-26 — 2026-11-06/, 'смерть бота потерялась из-за сравнения с глобальной датой');
  assert.doesNotMatch(result.stdout, /воскрешение, сид пропущен/, 'бот ошибочно объявлен воскресшим');
  assert.match(result.stdout, /после последнего наблюдения/, 'нет предупреждения о смерти вне снапшотов');
});

// Граница — строгое «меньше»: дата смерти, совпадающая с последним наблюдением
// бота, — это смерть, а не воскрешение.
test('AC4: дата смерти, равная дате последнего наблюдения, — это смерть', (t) => {
  const dir = makeSandbox(t, {
    both1_vpn_bot: { firstSeen: '2026-10-26', diedOn: '2026-11-06' },
  });
  // Последний (и единственный, где бот жив) снимок бот-а — 06.11: смерть в тот же день.
  writeFileSync(path.join(dir, 'data', 'liveness', '2026-11-06.json'), JSON.stringify({
    date: '2026-11-06',
    total: 2,
    ok: 2,
    dead: 0,
    unreachable: 0,
    notbot: 0,
    statuses: { both1_vpn_bot: 'ok', later1_vpn_bot: 'ok' },
  }));

  const result = runScript(dir);

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  assert.match(result.stdout, /@both1_vpn_bot: наблюдался/, 'смерть в дату последнего наблюдения не записана');
  assert.doesNotMatch(result.stdout, /воскрешение, сид пропущен/, 'смерть в тот же день ошибочно объявлена воскрешением');
});
