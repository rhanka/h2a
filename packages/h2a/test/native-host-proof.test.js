import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { inspectNativeQualification } from '../dist/hosts/native-proof.js';
import { captureRuntimeGeneratedFiles, verifyRuntimeRecord } from '../dist/hosts/native-runtime-record.js';
import { digest } from '../dist/hosts/native-files.js';
test('runtime and evidence mutations invalidate native receipts even when RECORD bytes stay unchanged', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'native-proof-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = join(root, '.h2a-install'), dist = join(root, 'runtime/mistral_vibe-2.26.1.dist-info'), source = join(root, 'runtime/vibe/runtime.mjs');
  fs.mkdirSync(state); fs.mkdirSync(dist, { recursive: true }); fs.mkdirSync(join(root, 'runtime/vibe'));
  fs.writeFileSync(source, 'fixture');
  const recordPath = join(dist, 'RECORD'), metadataPath = join(dist, 'METADATA'), evidence = join(root, 'attempt.json');
  fs.writeFileSync(recordPath, 'vibe/runtime.mjs,sha256=' + createHash('sha256').update('fixture').digest('base64url') + ',7\nvibe/__pycache__/cache.pyc,,\n');
  fs.writeFileSync(metadataPath, 'Name: mistral-vibe\nVersion: 2.26.1\n'); fs.writeFileSync(evidence, '{}');
  const generatedFiles = captureRuntimeGeneratedFiles(recordPath);
  assert.equal(verifyRuntimeRecord(recordPath, generatedFiles), true);
  assert.equal(verifyRuntimeRecord(recordPath, {}), false, 'hashless cache rows must be captured, even when absent');
  const observed = { MCP: 'mcp', profile: 'profile', node: 'node', entrypoint: 'entry' };
  const receipt = { schema: 1, host: 'vibe', root, fixture: false, recordedAt: new Date().toISOString(),
    runtime: { distribution: 'mistral-vibe', version: '2.26.1', recordPath, metadataPath, recordSha256: digest(fs.readFileSync(recordPath)), generatedFiles },
    components: { MCP: { status: 'qualified', dependencies: observed, evidence: [evidence], evidenceHashes: { [evidence]: digest('{}') } } } };
  fs.writeFileSync(join(state, 'qualification.json'), JSON.stringify(receipt));
  const inspect = () => inspectNativeQualification(state, 'vibe', root, observed);
  assert.equal(inspect().guardEligible, true);
  fs.writeFileSync(source, 'changed');
  assert.equal(inspect().components.MCP, 'obsolete');
  fs.writeFileSync(source, 'fixture'); fs.writeFileSync(evidence, '{"edited":true}');
  assert.equal(inspect().guardEligible, false);
  assert.equal(inspect().components.MCP, 'obsolete');
});
