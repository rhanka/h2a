import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFocusDossier, runFocusBuildCli } from '../dist/focus-build.js';
const fixture = () => JSON.parse(readFileSync(new URL('../focus-kit/test/fixtures/renderer-parity/decision.input.json', import.meta.url)));

test('Vue selection belongs to the host; default output is byte-identical to explicit Svelte', () => {
  const doc = fixture(), before = JSON.stringify(doc);
  assert.equal(buildFocusDossier(doc), buildFocusDossier(doc, { renderer: 'svelte' }));
  assert.equal(JSON.stringify(doc), before);
  assert.throws(() => buildFocusDossier(doc, { renderer: 'other' }), /Unknown Focus renderer/);
  assert.throws(() => buildFocusDossier(doc, { mode: 'report' }), /requires the opt-in Vue/);
  assert.throws(() => buildFocusDossier({ ...doc, renderer: 'vue' }), /renderer/);
});

test('Vue retains the same presentation refusals before renderer loading', () => {
  const doc = fixture(); delete doc.readability;
  let svelte, vue;
  try { buildFocusDossier(doc); } catch (error) { svelte = error.message; }
  try { buildFocusDossier(doc, { renderer: 'vue' }); } catch (error) { vue = error.message; }
  assert.ok(svelte); assert.equal(vue, svelte);
});

test('Vue absence refuses explicitly and cannot fall back to Svelte or publish an artifact', () => {
  const available = existsSync(new URL('../focus-kit/renderer-vue.html', import.meta.url));
  const doc = fixture();
  if (available) {
    const html = buildFocusDossier(doc, { renderer: 'vue', mode: 'report' });
    assert.equal(JSON.parse(html.match(/data-focus-document>([\s\S]*?)<\/script>/)[1]).mode, 'report');
  } else {
    assert.throws(() => buildFocusDossier(doc, { renderer: 'vue' }), /Vue renderer unavailable/);
  }
  const root = mkdtempSync(join(tmpdir(), 'focus-vue-flag-'));
  try {
    const input = new URL('../focus-kit/test/fixtures/renderer-parity/decision.input.json', import.meta.url);
    const output = join(root, 'report.html');
    const messages = [], streams = { stdout: { write: s => messages.push(s) }, stderr: { write: s => messages.push(s) } };
    assert.equal(runFocusBuildCli(['build', input.pathname, '-o', output, '--renderer', 'invalid'], streams), 2);
    assert.equal(runFocusBuildCli(['build', input.pathname, '-o', output, '--renderer', 'vue', '--renderer', 'svelte'], streams), 2);
    assert.equal(runFocusBuildCli(['build', input.pathname, '-o', output, '--renderer', 'vue'], streams), available ? 0 : 1);
    assert.equal(existsSync(output), available);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
