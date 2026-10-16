import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { nativeCatalog, historicalSkillHashes } from '../dist/hosts/native-catalog.js';
const sha = text => createHash('sha256').update(text).digest('hex');
const pins = JSON.parse(readFileSync(new URL('../fixtures/native-host-history.json', import.meta.url)));
test('offline catalog covers all pinned releases from each host introduction with verified tuples', () => {
  const c = nativeCatalog();
  assert.equal(c.schema, 1); assert.equal(c.through, '0.98.6');
  assert.deepEqual(c.unavailable, ['0.76.0']);
  assert.equal(c.coverage.agy[0], '0.78.0'); assert.equal(c.coverage.muse[0], '0.97.5'); assert.equal(c.coverage.vibe[0], '0.98.3');
  assert.deepEqual(c.coverage.agy, pins.releases.map(r => r.version));
  for (const host of ['vibe', 'muse', 'agy', 'gemini']) assert.equal(c.coverage[host].at(-1), c.through);
  for (const entry of c.entries) {
    const pin = pins.packages[entry.package + '@' + entry.version];
    assert.ok(pin, `known pinned tuple: ${entry.package}@${entry.version}`);
    assert.equal(pin.integrity, entry.integrity); assert.match(entry.sha256, /^[a-f0-9]{64}$/); assert.match(entry.renderer, /^[a-f0-9]{64}$/);
  }
  assert.ok(c.entries.some(e => e.name.startsWith('harness-')));
  assert.deepEqual(historicalSkillHashes('vibe', 'unknown'), []);
});
test('vendored published renderers reproduce agy and harness-prefixed bytes without network', () => {
  const vendors = JSON.parse(readFileSync(new URL('../fixtures/native-host-renderers.json', import.meta.url)));
  assert.ok(vendors.some(v => v.name.startsWith('harness-')));
  assert.ok(vendors.some(v => v.release === '0.78.0'));
  for (const sample of vendors) {
    const context = vm.createContext({}); new vm.Script(sample.functions).runInContext(context, { timeout: 1000 });
    const parsed = context.parseSkill(sample.source);
    const rendered = ['agy', 'gemini'].includes(sample.host) ? context.renderSkillAsGeminiToml(parsed) : sample.source;
    assert.equal(rendered, sample.rendered); assert.equal(sha(rendered), sample.sha256);
    assert.ok(historicalSkillHashes(sample.host, sample.name).includes(sample.sha256));
  }
});
