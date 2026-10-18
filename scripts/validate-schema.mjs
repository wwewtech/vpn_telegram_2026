// Проверяет data/bots.json против формального контракта schema/bots.schema.json.
//
// Зачем отдельный слой: validate.mjs проверяет ИНВАРИАНТЫ (сортировка, дубли, ссылки в README),
// а этот скрипт — ФОРМУ записей по декларативной схеме. Схема — источник правды для формы:
// новое поле сначала добавляется в схему, потом в код. Если код и схема разошлись —
// валидация падает с понятной ошибкой.
//
// Зависимостей нет: поддерживается ограниченный профиль JSON Schema draft 2020-12
// (type, required, additionalProperties, pattern, minItems, items) — ровно то,
// что используется в schema/bots.schema.json. Для полного профиля есть ajv,
// но ради 207 записей зависимость не нужна.
//
// Запуск: node scripts/validate-schema.mjs [--quiet]
// Тесты подменяют путь через env BOTS_DATA_PATH / BOTS_SCHEMA_PATH.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = process.env.BOTS_DATA_PATH ?? path.join(ROOT, 'data', 'bots.json');
const SCHEMA_PATH = process.env.BOTS_SCHEMA_PATH ?? path.join(ROOT, 'schema', 'bots.schema.json');

// Поддерживаемый профиль ключей схемы. Всё, что схема использует, но валидатор
// не умеет, должно попасть сюда — иначе молчаливо проигнорируется.
const SUPPORTED = new Set(['type', 'required', 'additionalProperties', 'pattern', 'minItems', 'items', 'properties', 'title', 'description', 'examples', '$schema', '$id', '_meta']);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isSchemaNode(value) {
  // Узел схемы — объект с хотя бы одним распознаваемым ключевым словом валидации.
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateNode(node, schema, pathLabel, errors) {
  // type
  if (schema.type) {
    const actual = typeOf(node);
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.includes(actual)) {
      errors.push(`${pathLabel}: ожидается тип ${expected.join('|')}, получен ${actual}`);
      return; // дальнейшие проверки типа бессмысленны
    }
  }
  // minItems (массивы)
  if (Array.isArray(node) && schema.minItems !== undefined && node.length < schema.minItems) {
    errors.push(`${pathLabel}: минимум ${schema.minItems} элемент(ов), получено ${node.length}`);
  }
  // items (массивы)
  if (Array.isArray(node) && schema.items) {
    node.forEach((item, index) => {
      validateNode(item, schema.items, `${pathLabel}[${index}]`, errors);
    });
  }
  if (!isSchemaNode(node)) return;
  // required
  for (const key of schema.required ?? []) {
    if (!(key in node)) {
      errors.push(`${pathLabel}: отсутствует обязательное поле "${key}"`);
    }
  }
  // additionalProperties: false + properties
  if (schema.additionalProperties === false && schema.properties) {
    for (const key of Object.keys(node)) {
      if (!(key in schema.properties)) {
        errors.push(`${pathLabel}: неизвестное поле "${key}" (контракт допускает только: ${Object.keys(schema.properties).join(', ')})`);
      }
    }
  }
  // pattern + type + рекурсивная проверка свойств
  for (const [key, rule] of Object.entries(schema.properties ?? {})) {
    if (!isSchemaNode(rule)) continue;
    if (!(key in node)) continue;
    const value = node[key];
    if (rule.pattern !== undefined && typeof value === 'string' && !new RegExp(rule.pattern).test(value)) {
      errors.push(`${pathLabel}.${key}: значение ${JSON.stringify(value)} не подходит под шаблон ${rule.pattern}`);
    }
    if (rule.type !== undefined) {
      validateNode(value, rule, `${pathLabel}.${key}`, errors);
    }
  }
}

function assertSchemaProfile(schema, errors) {
  // Самопроверка: в схеме нет ключей, которые валидатор не понимает.
  // Имена свойств ВНУТРИ properties/item — это имена полей данных, их не проверяем;
  // проверяем ключевые слова на каждом уровне вложенности схем.
  const walk = (node, label) => {
    if (!isSchemaNode(node)) return;
    for (const key of Object.keys(node)) {
      if (key === 'properties') {
        for (const [name, sub] of Object.entries(node.properties)) {
          if (!isSchemaNode(sub)) continue;
          walk(sub, `${label}.properties.${name}`);
        }
        continue;
      }
      if (key === 'items') {
        walk(node.items, `${label}.items`);
        continue;
      }
      if (key === 'examples' || key === '_meta') continue; // данные, не ключевые слова
      if (!SUPPORTED.has(key)) {
        errors.push(`схема ${label}: валидатор не поддерживает ключ "${key}" — расширьте SUPPORTED или уберите из схемы`);
      }
    }
  };
  walk(schema, 'root');
}

// Чистая функция: читает файлы и проверяет данные против схемы.
// Экспортируется для тестов (подмена путей через env BOTS_DATA_PATH / BOTS_SCHEMA_PATH).
export function validateSchemaFiles(dataPath = DATA_PATH, schemaPath = SCHEMA_PATH) {
  const errors = [];
  let data;
  let schema;
  try {
    data = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch (error) {
    return { errors: [`не удалось прочитать ${dataPath}: ${error.message}`] };
  }
  try {
    schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    return { errors: [`не удалось прочитать ${schemaPath}: ${error.message}`] };
  }

  assertSchemaProfile(schema, errors);
  if (errors.length > 0) return { errors }; // профиль битый — данным доверять нельзя

  validateNode(data, schema, dataPath, errors);
  return { errors };
}

// Чистая функция для тестов: данные и схема — аргументы, файлы не читает.
export function checkAgainstSchema(data, schema) {
  const errors = [];
  if (!isSchemaNode(schema)) return { errors: ['схема должна быть объектом'] };
  assertSchemaProfile(schema, errors);
  if (errors.length > 0) return { errors };
  validateNode(data, schema, 'data', errors);
  return { errors };
}

// CLI-режим: запуск напрямую (node scripts/validate-schema.mjs), не через import.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { errors } = validateSchemaFiles();
  if (errors.length > 0) {
    console.error(`Схема не пройдена — ${errors.length} проблем(ы):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  if (!process.argv.includes('--quiet')) {
    console.log('OK: data/bots.json соответствует контракту schema/bots.schema.json.');
  }
}
