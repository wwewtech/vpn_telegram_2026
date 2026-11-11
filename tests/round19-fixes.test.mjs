// Тесты раунда 19: AA2 — гонка пустых ответов в канарейке типа; AA3 — троттлинг
// t.me ломал прогон на полном каталоге; AB1 — сид с расхождением регистра
// печатал «ЖИВ (undefined)»; AB4 — RU-блок в generate-readme --check глушил
// английскую проверку.
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Похожие тесты-регресcии (round18) используют source-text regex'ы, а это означает
// рих совпадений внутри комментариев — как раз в этом коде комментарии объясняют
// старый баг. Режем их, чтобы проверять только исполняемый код.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const cl = codeOnly(readFileSync(path.join(ROOT, 'scripts/check-links.mjs'), 'utf8'));
const gen = codeOnly(readFileSync(path.join(ROOT, 'scripts/generate-readme.mjs'), 'utf8'));
const ls = codeOnly(readFileSync(path.join(ROOT, 'scripts/liveness-stats.mjs'), 'utf8'));

// ---------- AA3: троттлинг t.me — счётчик локальный, а не модульный ----------

test('AA3: emptyStreak объявлен в скоупе checkAll, не на уровне модуля', () => {
  // Регрессия: счётчик жил на уровне МОДУЛЯ и инкрементировался внутри fetchPage,
  // который CONCURRENCY=4 воркеров гоняют параллельно. Четыре разных
  // троттлящихся хендла из одного батча давали 4 инкремента, и на полном
  // каталоге суммарный счётчик считался «пустыми ответами ПОДРЯД».
  const declInCheckAll = cl.match(/async function checkAll[\s\S]{0,200}?let emptyStreak = 0/);
  assert.ok(declInCheckAll, 'emptyStreak объявлен внутри checkAll');

  // На уровне модуля (без отступа) пускаться счётчик не должен. `^[ \t]*`
  // здесь был бы ошибкой: он матчит и объявление внутри функции — ровно та
  // форма объявления, наличие которой в скоупе checkAll мы только что
  // подтвердили.
  const moduleLevel = cl.match(/^(?:const|let|var)\s+emptyStreak/m);
  assert.ok(!moduleLevel, 'модульного счётчика пустых ответов больше нет');
});

test('AA3: инкремент идёт по settled-массиву батча, сброс на любом другом вердикте', () => {
  assert.ok(/for \(const item of settled\)/.test(cl), 'итерация по результатам батча после settle');
  assert.ok(/isEmptyPageResult\(item\)/.test(cl), 'предикат «пустой ответ» применён к элементу батча');
  assert.ok(/} else {\s*\n\s*emptyStreak = 0;/.test(cl), 'сброс счётчика в else на любом непустом вердикте');
});

test('AA3: превышение лимита — MethodError, а не «мёртвые боты»', () => {
  // Окно должно накрывать и сам throw, и текст сообщения — поэтому захватываем
  // хвост, а не останавливаемся на имени класса.
  const tail = cl.match(/emptyStreak >= EMPTY_RESPONSE_STREAK_LIMIT[\s\S]{0,900}/);
  assert.ok(tail, 'проверка лимита найдена');
  assert.ok(/throw new MethodError/.test(tail[0]), 'превышение лимита бросает MethodError, а не пишёт мёртвые боты');
  assert.ok(/пустых ответов подряд/.test(tail[0]), 'сообщение описывает именно троттлинг t.me');
});

// ---------- AA2/AB1: сид с расхождением регистра ----------

test('AB1: поиск статуса по нижнему регистру — предупреждение не печатает undefined', () => {
  const byLower = ls.match(/lastStatusByLowerHandle\s*=\s*new Map\(/);
  assert.ok(byLower, 'строится индекс по нижнему регистру');
  assert.ok(/\.get\(key\)/.test(ls), 'поиск идёт по приведённому ключу');
  // Прямой get по исходному Registру сида — регрессия «ЖИВ (undefined)».
  assert.ok(!/lastStatus\.get\(handle\)/.test(ls), 'поиска по точному регистру сида не осталось');
});

test('AB1: seed-запись с битым diedOn — громкий отказ до попадания в реестр', () => {
  assert.ok(/DATE_RE\.test\(info\.diedOn\)/.test(ls), 'diedOn валидируется регуляркой даты');
  assert.ok(/process\.exit\(1\)/.test(ls), 'битая запись валит скрипт');
});

// ---------- AD4: --check собирает оба расхождения, не пишет файлы ----------

test('AD4: RU и EN расхождения в --check собираются, а не роняют скрипт на первом', () => {
  const collector = gen.match(/const checkFailures = \[\]/);
  assert.ok(collector, 'есть аккумулятор отложенных ошибок');
  // Оба блока должны писать в аккумулятор, а не звать fail() немедленно.
  assert.ok(/checkFailures\.push\('README.md отличается/.test(gen), 'RU-расхождение накапливается');
  assert.ok(/checkFailures\.push\('README_EN.md не синхронизирован/.test(gen), 'EN-расхождение накапливается');
  // Ровно один fail() — в конце, общим сообщением.
  const fails = gen.match(/fail\(checkFailures\.join/g);
  assert.equal(fails?.length, 1, 'fail() вызывается один раз общим сообщением');
});

test('AD4: режим --check определяет запись через флаг, а не инлайновый argv', () => {
  assert.ok(/const checkMode = process\.argv\.includes\('--check'\)/.test(gen), 'флаг заведён в переменную');
  assert.ok(!/if \(process\.argv\.includes\('--check'\)\)\s*\{/.test(gen), 'инлайновых проверок argv в записи не осталось');
});

test('AD4: в --check файлы не пишутся', () => {
  // Форма записи — `if (checkMode) { push } else { writeFileSync }`: обе записи
  // идут в else-ветке, доступной только вне проверки.
  const guards = [...gen.matchAll(/if \(checkMode\) \{\s*checkFailures\.push\(/g)];
  const writes = [...gen.matchAll(/writeFileSync\(README_(EN_)?PATH/g)];
  assert.equal(writes.length, guards.length, `записей: ${writes.length}, веток проверки: ${guards.length}`);
  for (const w of writes) {
    const at = w.index;
    // Ближайший guard слева от записи, и после него — ровно один else.
    const preceding = [...guards].filter((g) => g.index < at);
    assert.ok(preceding.length >= 1, 'перед каждой записью есть проверка режима');
    const guard = preceding[0];
    const between = gen.slice(guard.index, at);
    assert.ok(/\} else \{/.test(between), `запись идёт в else-ветке (не в режиме --check): ...${between.trim().slice(-40)}`);
  }
});

// ---------- AD4: штамп для EN берётся из пересобранного контента ----------

test('AD4: штамп EN берётся из result.updated (в --check файл не пишется)', () => {
  // Из исходного текста — регрессия: в --check README не записывался, бейдж EN
  // отставал от того, которым RU должен был стать, и --check врал «EN актуален».
  const m = gen.match(/const stamp = extractBadgeStamp\(([^)]+)\)/);
  assert.ok(m, 'штамп вычисляется явно');
  assert.equal(m[1], 'result.updated', `штамп берётся из пересобранного контента, а не ${m[1]}`);
});

