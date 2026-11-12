// Интеграционные тесты контракта --check для generate-readme.mjs (AD4, раунд 19).
//
// Запуск: node --test tests/
//
// В раунде 19 контракт закреплялся только regex'ами по исходнику (round19-fixes.test.mjs):
// «guard'ов столько же, сколько writeFileSync», «каждая запись в else-ветке». Этого
// недостаточно: реальный риск CI — не текст скрипта, а его поведение. Здесь тот же
// контракт проверяется прогоном настоящего CLI в песочнице:
//   (а) --check не пишет файлы (ни содержимым, ни mtime);
//   (б) расхождения RU и EN собираются вместе — падение на первом не маскирует второе;
//   (в) сообщение actionable: содержит `npm run fix`.
//
// Песочница содержит копии scripts/ + README.md/README_EN.md: generate-readme.mjs
// берёт пути из lib.mjs, где ROOT = на уровень выше папки скрипта. Рабочий
// репозиторий не трогается — только os.tmpdir().
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  copyFileSync,
  statSync,
  utimesSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RU_STALE_MSG = 'README.md отличается от data/bots.json. Запустите: npm run fix';
const EN_STALE_MSG = 'README_EN.md не синхронизирован с data/bots.json. Запустите: npm run fix';
const RU_OK_MSG = 'OK: README.md актуален';

// Устаревшие заготовки: маркеры есть, таблица пуста — она гарантированно
// расходится с данными (страховка от случайного «совпадение актуально»).
const RU_SKELETON = `# Каталог (тест)

[![Updated](https://img.shields.io/badge/updated-2026.10-brightgreen)](https://example.com)

<!-- BOTS:START -->

<!-- BOTS:END -->
`;
const EN_SKELETON = `# Catalog (test)

[![Updated](https://img.shields.io/badge/updated-2026.10-brightgreen)](https://example.com)

A list of 200+ bots.

<!-- BOTS:START -->

<!-- BOTS:END -->
`;

const BOTS = '[\n  { "handle": "alpha_vpn_bot" },\n  { "handle": "beta_net_bot" }\n]\n';

// Песочница живёт в os.tmpdir(), поэтому чистится через t.after(): при падении
// assert'а каталог иначе остаётся в %TEMP% навсегда (8 мусорных папок на прогон).
function makeSandbox(t, { bots = BOTS, ru = RU_SKELETON, en = EN_SKELETON } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vpn-readme-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  for (const file of ['lib.mjs', 'generate-readme.mjs']) {
    copyFileSync(path.join(ROOT, 'scripts', file), path.join(dir, 'scripts', file));
  }
  writeFileSync(path.join(dir, 'data/bots.json'), bots);
  if (ru !== null) writeFileSync(path.join(dir, 'README.md'), ru);
  if (en !== null) writeFileSync(path.join(dir, 'README_EN.md'), en);
  return dir;
}

function runScript(dir, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join('scripts', 'generate-readme.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, stdout };
  } catch (error) {
    // execFileSync бросает исключение при ненулевом коде: stdout и stderr уже
    // собраны в error — отдаём оба потока, чтобы сообщения были видны в assert'ах.
    return { code: error.status, stdout: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

function read(dir, name) {
  const file = path.join(dir, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function mtimeMs(dir, name) {
  const file = path.join(dir, name);
  return existsSync(file) ? statSync(file).mtimeMs : null;
}

// Откатываем mtime в прошлое: если --check всё же перепишет файл тем же
// содержимым, mtime изменится и регрессия будет поймана.
// utimesSync требует оба времени: atime и mtime. Один аргумент = mtime undefined.
function ageFile(dir, name) {
  const past = new Date('2020-01-01T00:00:00Z');
  utimesSync(path.join(dir, name), past, past);
}

test('--check: устаревший README.md — exit 1, actionable-сообщение, файл не записан', (t) => {
  const dir = makeSandbox(t);
  ageFile(dir, 'README.md');
  ageFile(dir, 'README_EN.md');
  const beforeRu = read(dir, 'README.md');
  const beforeEn = read(dir, 'README_EN.md');
  const mtimeBeforeRu = mtimeMs(dir, 'README.md');
  const mtimeBeforeEn = mtimeMs(dir, 'README_EN.md');

  const result = runScript(dir, '--check');

  assert.equal(result.code, 1, `ожидался exit 1, получено ${result.code}: ${result.stdout}`);
  assert.ok(
    result.stdout.includes(RU_STALE_MSG),
    `в выводе нет actionable-сообщения о README.md: ${result.stdout}`,
  );
  assert.ok(result.stdout.includes('npm run fix'), `сообщение без подсказки npm run fix: ${result.stdout}`);
  assert.equal(read(dir, 'README.md'), beforeRu, '--check переписал README.md (содержимое)');
  assert.equal(read(dir, 'README_EN.md'), beforeEn, '--check переписал README_EN.md (содержимое)');
  assert.equal(mtimeMs(dir, 'README.md'), mtimeBeforeRu, '--check переписал README.md (mtime)');
  assert.equal(mtimeMs(dir, 'README_EN.md'), mtimeBeforeEn, '--check переписал README_EN.md (mtime)');
});

test('--check: расхождения RU и EN собираются вместе, а не fail-fast на первом', (t) => {
  const dir = makeSandbox(t);

  const result = runScript(dir, '--check');

  assert.equal(result.code, 1, `ожидался exit 1, получено ${result.code}: ${result.stdout}`);
  assert.ok(result.stdout.includes(RU_STALE_MSG), `нет расхождения RU: ${result.stdout}`);
  assert.ok(result.stdout.includes(EN_STALE_MSG), `нет расхождения EN — fail-fast вернулся: ${result.stdout}`);
  // Оба сообщения — в одном fail(): ожидаем две подсказки «npm run fix», не два запуска.
  const hints = [...result.stdout.matchAll(/npm run fix/g)].length;
  assert.equal(hints, 2, `ожидалось 2 actionable-подсказки, получено ${hints}: ${result.stdout}`);
});

test('--check: оба README актуальны — exit 0 и оба OK', (t) => {
  const dir = makeSandbox(t);
  // Синхронизируем песочницу обычным запуском (без --check) — пишущий режим.
  const fix = runScript(dir);
  assert.equal(fix.code, 0, `подготовительный запуск упал: ${fix.stdout}`);

  const result = runScript(dir, '--check');

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  assert.ok(result.stdout.includes(RU_OK_MSG), `нет OK по README.md: ${result.stdout}`);
  assert.ok(result.stdout.includes('OK: README_EN.md актуален'), `нет OK по README_EN.md: ${result.stdout}`);
  assert.ok(!result.stdout.includes('npm run fix'), `ложное расхождение на актуальных файлах: ${result.stdout}`);
});

test('--check: отсутствие README_EN.md не считается расхождением', (t) => {
  const dir = makeSandbox(t, { en: null });

  const result = runScript(dir, '--check');

  assert.equal(result.code, 1, `ожидался exit 1 из-за RU, получено ${result.code}: ${result.stdout}`);
  assert.ok(result.stdout.includes(RU_STALE_MSG), `нет расхождения RU: ${result.stdout}`);
  assert.ok(!result.stdout.includes(EN_STALE_MSG), `отсутствие EN подано как расхождение: ${result.stdout}`);
  assert.equal(read(dir, 'README_EN.md'), null, '--check создал README_EN.md');
});

test('без --check файлы пишутся: таблица, бейдж и метка «100+ bots»', (t) => {
  const dir = makeSandbox(t);

  const result = runScript(dir);

  assert.equal(result.code, 0, `ожидался exit 0, получено ${result.code}: ${result.stdout}`);
  const ru = read(dir, 'README.md');
  assert.ok(
    ru.includes('| 1 | @alpha_vpn_bot | [t.me/alpha_vpn_bot](https://t.me/alpha_vpn_bot) |'),
    `таблица RU не собрана: ${ru}`,
  );
  assert.ok(ru.includes('| 2 | @beta_net_bot |'), `вторая строка RU не собрана: ${ru}`);
  const en = read(dir, 'README_EN.md');
  assert.ok(en.includes('100+ bots'), `метка «200+ bots» не синхронизирована с данными: ${en}`);
  assert.ok(en.includes('| # | Bot | Link |'), `таблица EN не собрана: ${en}`);
  // Бейдж обновлён до текущего месяца (заготовка была 2026.10).
  const now = new Date();
  const stamp = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  assert.ok(ru.includes(`updated-${stamp}`), `бейдж RU не обновлён до ${stamp}: ${ru}`);
  assert.ok(en.includes(`updated-${stamp}`), `бейдж EN не обновлён до ${stamp}: ${en}`);
});

test('--check: повреждённый бейдж updated — exit 1 до любой записи', (t) => {
  const brokenRu = RU_SKELETON.replace('updated-2026.10-brightgreen', 'Обновлено недавно');
  const dir = makeSandbox(t, { ru: brokenRu });

  const result = runScript(dir, '--check');

  assert.equal(result.code, 1, `ожидался exit 1, получено ${result.code}: ${result.stdout}`);
  assert.ok(/бейдж updated-YYYY\.MM/.test(result.stdout), `нет сообщения о бейдже: ${result.stdout}`);
  assert.ok(read(dir, 'README.md').includes('Обновлено недавно'), '--check переписал README.md с битым бейджем');
  assert.equal(read(dir, 'README_EN.md'), EN_SKELETON, '--check переписал README_EN.md');
});
