// E2b3: every direct child entry API is guarded in its own right — async
// shell forms, bare (command, options/callback) overloads, eval workers and
// published legacy bytes loaded as image code. Child coverage is never
// deduced from the parent: each API is exercised directly in a fresh
// harness process carrying the closed reader plus the execution policy.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { after } from 'node:test';
import { managedImage } from './helpers/mh-l5-image.js';

const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
const harness = fileURLToPath(new URL('./helpers/mh-l6-entrypoints-harness.mjs', import.meta.url));

let shared;
after(async () => { if (shared) await shared.close(); });
async function fixture() {
  if (!shared) {
    const f = await managedImage();
    // The manifest covers the image tree exactly (no extra files), so the
    // refusal operand is the image root directory itself: referencing
    // image bytes through shell/bare forms is refused by location, and a
    // pre-fix run executes nothing sensitive.
    shared = { ...f, entryUrl: pathToFileURL(join(f.image, 'dist/bin.js')).href, operand: f.image };
  }
  return shared;
}

function run(f, action, operand = '') {
  // The lane runner injects a NODE_OPTIONS --import spawn hook; the harness
  // must start without it (like the components harness env), otherwise the
  // image policy rightly rejects the foreign loader in its own argv.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const result = spawnSync(process.execPath, [harness, f.entryUrl, action, operand],
    { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined, result.stderr);
  const line = result.stdout.trim().split('\n').at(-1);
  return { status: result.status, body: JSON.parse(line) };
}

function legacyBytes(t) {
  assert.ok(process.env.MH_L5_ARTIFACTS, 'official published legacy fixtures mandatory; never skip');
  const root = fs.realpathSync(process.env.MH_L5_ARTIFACTS);
  const receipt = JSON.parse(fs.readFileSync(join(root, 'receipt.json'), 'utf8'));
  assert.ok(receipt.verified.find(row => row.file === 'sentropic-h2a-0.98.5.tgz'), 'legacy fixture verified');
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l6-entrypoints-legacy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  execFileSync('/usr/bin/tar', ['-xzf', join(root, 'sentropic-h2a-0.98.5.tgz'), '-C', directory]);
  return join(directory, 'package', 'dist', 'bin.js');
}

test('E2b3 should refuse an image entry through async shell exec', async t => {
  const f = await fixture(t);
  const red = run(f, 'exec-shell-image', f.operand);
  assert.equal(red.status, 1);
  assert.equal(red.body.refused, 'image_child_entry_unqualified');
});

test('E2b3 should pass an external shell command through exec untouched', async t => {
  const f = await fixture(t);
  const green = run(f, 'exec-shell-external');
  assert.equal(green.status, 0);
  assert.equal(green.body.stdout, 'entrypoints-ok');
});

test('E2b3 should refuse an image entry through sync shell exec', async t => {
  const f = await fixture(t);
  const red = run(f, 'execsync-shell-image', f.operand);
  assert.equal(red.status, 1);
  assert.equal(red.body.refused, 'image_child_entry_unqualified');
});

test('E2b3 should pass an external shell command through execSync untouched', async t => {
  const f = await fixture(t);
  const green = run(f, 'execsync-shell-external');
  assert.equal(green.status, 0);
  assert.equal(green.body.stdout, 'entrypoints-ok');
});

test('E2b3 should refuse a bare image entry through execFile', async t => {
  const f = await fixture(t);
  const red = run(f, 'execfile-bare-image', f.operand);
  assert.equal(red.status, 1);
  assert.equal(red.body.refused, 'image_child_entry_unqualified');
});

test('E2b3 should pass a bare external program through execFile untouched', async t => {
  const f = await fixture(t);
  const green = run(f, 'execfile-bare-external');
  assert.equal(green.status, 0);
  assert.equal(green.body.code, 0);
});

test('E2b3 should refuse a bare image entry through spawn', async t => {
  const f = await fixture(t);
  const red = run(f, 'spawn-bare-image', f.operand);
  assert.equal(red.status, 1);
  assert.equal(red.body.refused, 'image_child_entry_unqualified');
});

test('E2b3 should pass a bare external shell command through spawn untouched', async t => {
  const f = await fixture(t);
  const green = run(f, 'spawn-shell-external');
  assert.equal(green.status, 0);
  assert.equal(green.body.stdout, 'entrypoints-ok');
});

test('E2b3 should refuse an eval worker before it can evaluate', async t => {
  const f = await fixture(t);
  const red = run(f, 'worker-eval');
  assert.equal(red.status, 1);
  assert.equal(red.body.refused, 'image_worker_entry_unqualified');
});

test('E2b3 should refuse published legacy bytes loaded as image code', async t => {
  const f = await fixture(t);
  const legacy = legacyBytes(t);
  assert.ok(fs.statSync(legacy).isFile());
  const red = run(f, 'legacy-load', legacy);
  assert.equal(red.status, 1);
  assert.equal(red.body.refused, 'image_module_missing');
});
