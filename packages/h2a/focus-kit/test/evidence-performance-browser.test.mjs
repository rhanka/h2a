import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { corpus } from './evidence-corpus.mjs';
import { measure } from './evidence-metrics.mjs';
import { digest } from './evidence-fixtures.mjs';
const policyUrl = new URL('./fixtures/evidence-performance-policy.v1.json', import.meta.url);
const summary = values => {
  const sorted = [...values].sort((a,b) => a-b);
  return { samples: values.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
};

test('qualifies H1 small and real large corpus latency, bounded DOM and owned-process memory against frozen budgets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-evidence-performance-'));
  const policyBytes = readFileSync(policyUrl), policy = JSON.parse(policyBytes);
  assert.equal(policy.repetitions.cold, 30); assert.equal(policy.repetitions.tasks, 30);
  for (const [field, path] of [['corpusSha256','fixtures/evidence-corpus.v1.json'],['generatorSha256','evidence-corpus.mjs'],
    ['fixtureSha256','evidence-fixtures.mjs'],['measurementSha256','evidence-metrics.mjs']])
    assert.equal(digest(readFileSync(new URL(path, import.meta.url))), policy[field], `Frozen ${field}`);
  const documents = corpus(root);
  const result = await measure(root, documents, { coldRuns: 30, taskRuns: 30, onSample: sample => console.log(JSON.stringify(sample)),
    onDom: d => { assert.ok(d.lines <= policy.budgets.domLines, `Bounded lines: ${d.lines}`); assert.ok(d.nodes <= policy.budgets.domNodes, `Bounded evidence DOM: ${d.nodes}`); } });
  const report = { command: 'rtk node --test packages/h2a/focus-kit/test/evidence-performance-browser.test.mjs',
    policySha256: digest(policyBytes), node: process.version, cpu: cpus()[0].model, ramBytes: totalmem(), ...result };
  writeFileSync(join(root, 'metrics.json'), JSON.stringify(report, null, 2));
  console.log(`Raw samples/artifact/policy hashes: ${join(root, 'metrics.json')}`);
  assert.equal(result.instrumentationError, undefined, 'Missing live-process instrumentation fails after retaining raw measurements');
  assert.equal(result.browser, policy.calibration.chromium, 'Pinned Chromium');
  assert.ok(result.artifacts.large.sources > 25);
  assert.ok(result.artifacts.large.htmlBytes > 30_000_000, 'Fully embedded artifact around 32 MB');
  for (const [name, m] of Object.entries(result.metrics)) {
    assert.equal(m.cold.length, name === 'doubled' ? 1 : 30);
    for (const metric of ['cold','citation','search']) {
      if (name === 'legacy' && metric !== 'cold') continue;
      const s = summary(m[metric]), budget = metric === 'cold' ? policy.budgets.cold[name] : policy.budgets[metric];
      if (metric !== 'cold') assert.equal(s.samples, 30);
      console.log(`${name}/${metric}: ${JSON.stringify(s)}`);
      assert.ok(s.p95 <= budget.p95 && s.max <= budget.max, `${name}/${metric} exceeds frozen policy`);
    }
    if (name !== 'legacy') {
      assert.equal(m.dom.length, 120);
      for (const d of m.dom) { assert.ok(d.lines <= policy.budgets.domLines, `Bounded lines: ${d.lines}`); assert.ok(d.nodes <= policy.budgets.domNodes, `Bounded evidence DOM: ${d.nodes}`); }
      for (const value of Object.values(m.memory)) assert.ok(Number.isFinite(value) && value > 0, 'Missing memory metric fails');
      assert.ok(m.memory.peakRss <= policy.budgets.peakRssBytes);
      assert.ok(m.memory.retainedRss - m.memory.initialRss <= policy.budgets.retainedRssGrowthBytes);
      assert.ok(m.memory.retainedHeap - m.memory.initialHeap <= policy.budgets.retainedHeapGrowthBytes);
      console.log(`${name}/memory: ${JSON.stringify(m.memory)}`);
    }
  }
});
