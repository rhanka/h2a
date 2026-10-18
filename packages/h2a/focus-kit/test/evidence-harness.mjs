import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
export const isolatedEnvironment = root => ({ ...process.env, HOME: root, TMPDIR: root, XDG_RUNTIME_DIR: root,
  XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, XDG_CACHE_HOME: root, H2A_ROOT: join(root, 'h2a') });
export function portable(root, doc, bin = fileURLToPath(new URL('../../dist/bin.js', import.meta.url))) {
  const input = join(root, 'dossier.json'), output = join(root, 'dossier.html');
  writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [bin, 'focus', 'build', input, '-o', output], { cwd: root,
    encoding: 'utf8', env: isolatedEnvironment(root), maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return { input, output, url: pathToFileURL(output).href, html: readFileSync(output) };
}
export async function withBrowser(doc, work) {
  const root = mkdtempSync(join(tmpdir(), 'focus-evidence-browser-'));
  let browser;
  try {
    const artifact = portable(root, doc);
    browser = await chromium.launch({ headless: true, env: isolatedEnvironment(root) });
    await work({ root, browser, ...artifact });
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
}
