import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordDemo } from './demo.ts';

test('should switch real PTYs, show badges and reuse or create sessions in isolation', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'h2a-mwt-proof-'));
  let success = false;
  try {
    const proof = await recordDemo(artifacts);
    assert.equal(proof.existing.created, false);
    assert.equal(proof.existing.pid, proof.counterPid);
    assert.equal(proof.created.created, true);
    assert.equal(proof.concurrent.filter(result => result.created).length, 1);
    assert.equal(proof.concurrent[0].pid, proof.concurrent[1].pid);
    assert.notEqual(proof.restarted.incarnation, proof.exited.incarnation);
    const transcript = await readFile(join(artifacts, 'demo-transcript.md'), 'utf8');
    for (const expected of ['waiting-for-input-question', 'counter =', 'Idle session ready', 'answer accepted: y', 'exited']) {
      assert.ok(transcript.includes(expected), expected);
    }
    success = true;
  } finally {
    if (success) await rm(artifacts, { recursive: true, force: true });
    else process.stderr.write(`Failed integration artifacts: ${artifacts}\n`);
  }
});
