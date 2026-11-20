// Регрессии аудита 20.11: notbot = failure, безопасный отчёт и повторный Release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runLinkCheck({ status, extraArgs = [] }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'linkcheck-exit-test-'));
  try {
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'data'));
    for (const file of ['lib.mjs', 'check-links.mjs']) {
      copyFileSync(path.join(ROOT, 'scripts', file), path.join(dir, 'scripts', file));
    }
    writeFileSync(path.join(dir, 'data', 'bots.json'), '[{"handle":"channel_bot"}]');
    const runner = `
      const live = '<meta property="og:title" content="Name"><meta property="og:description" content="Description"><div class="tgme_page_extra">@HANDLE</div>';
      globalThis.fetch = async (url) => {
        const handle = new URL(url).pathname.slice(1);
        if (handle === 'BotFather') return new Response(live.replace('HANDLE', handle));
        if (handle === 'zzz_dead_bot_2026_xyz') return new Response('<meta property="og:title" content="Telegram: Contact @' + handle + '"><meta property="og:description" content="Contact">');
        const extra = ${JSON.stringify(status === 'notbot' ? '12 subscribers' : '@channel_bot')};
        return new Response(live.replace('@HANDLE', extra));
      };
      process.argv = [process.execPath, 'check-links.mjs', ...${JSON.stringify(extraArgs)}];
      await import(${JSON.stringify(pathToFileURL(path.join(dir, 'scripts', 'check-links.mjs')).href)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', runner], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('notbot: отчёт создаётся, но проверка завершается failure', () => {
  const result = runLinkCheck({ status: 'notbot' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Не боты \(1\)/);
  assert.match(result.stdout, /не-ботов: 1/);
});

test('--no-fail: явный диагностический режим сохраняет exit 0 при notbot', () => {
  const result = runLinkCheck({ status: 'notbot', extraArgs: ['--no-fail'] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Не боты \(1\)/);
});

test('Link check: failure сохраняется, а Issue-шаг выполняется после continue-on-error', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/linkcheck.yml'), 'utf8');
  assert.match(workflow, /id: linkcheck\s+continue-on-error: true/);
  assert.match(workflow, /steps\.linkcheck\.outcome == 'success'/);
  assert.match(workflow, /steps\.linkcheck\.outcome[\s\S]{0,100}!= "success"[\s\S]{0,50}exit 1/);
  assert.match(workflow, /printf '## Автопроверка ссылок: сбой метода/);
});

test('Autofix: автоматический коммит не подавляет required checks через skip ci', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/autofix.yml'), 'utf8');
  const commitLine = workflow.split('\n').find((line) => line.includes('git commit -m'));
  assert.ok(commitLine);
  assert.doesNotMatch(commitLine, /skip ci/);
});

test('Release: существующий тег checkout-ится до генерации описания', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const checkout = workflow.indexOf('git checkout --detach "$TAG"');
  const counts = workflow.indexOf('name: Bots count now and at previous release');
  assert.ok(checkout !== -1 && counts !== -1 && checkout < counts, 'notes должны собираться из ревизии тега');
});
