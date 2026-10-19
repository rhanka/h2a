import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { environment } from './xcli-lab.mjs';

test('L11: receipt discovery distinguishes an empty exact-SHA history from API failures', async () => {
  const { fetchTrustedReceipt } = await import('./xcli-trusted-artifact.mjs');
  const sha = 'a'.repeat(40);
  const download = async () => { assert.fail('an absent receipt must never be downloaded'); };
  await assert.rejects(fetchTrustedReceipt({ sha, download, request: async path => {
    assert.equal(path, `/actions/runs?status=success&per_page=100&head_sha=${sha}`);
    return { workflow_runs: [] };
  } }), /^Error: trusted-receipt-absent$/);
  for (const status of [401, 403, 404, 500]) {
    await assert.rejects(fetchTrustedReceipt({ sha, download, request: async () => {
      throw new Error(`github-api-failed:${status}`);
    } }), new RegExp(`^Error: github-api-failed:${status}$`));
  }
});

test('L11 review: gates download only a successful protected campaign artifact for the exact candidate head', async () => {
  const { fetchTrustedReceipt } = await import('./xcli-trusted-artifact.mjs');
  const sha = 'a'.repeat(40), receipt = { sha, provenance: { runId: 7, runAttempt: 1 } };
  const fixture = (overrides = {}) => {
    const run = { id: 7, run_attempt: 1, head_sha: sha, head_branch: 'feat/live-cross-cli-messaging', event: 'workflow_dispatch',
      conclusion: 'success', path: '.github/workflows/cross-cli-campaign.yml', repository: { full_name: 'rhanka/h2a' }, ...overrides };
    return async path => {
      if (path.includes('/runs?')) return { workflow_runs: [run] };
      if (path.includes('/branches/')) return { protected: true };
      if (path.endsWith('/artifacts')) return { artifacts: [{ id: 9, name: `xcli-campaign-${sha}`, expired: false, workflow_run: { id: 7, head_sha: sha } }] };
      throw new Error(`unexpected API path: ${path}`);
    };
  };
  let downloads = 0;
  const download = async () => { downloads++; return receipt; };
  const fetched = await fetchTrustedReceipt({ sha, request: fixture(), download });
  assert.equal(downloads, 1);
  assert.equal(fetched.provenance.authenticated, true);
  assert.equal(fetched.provenance.receiptDigest, createHash('sha256').update(JSON.stringify(receipt)).digest('hex'));
  for (const overrides of [{ head_sha: 'b'.repeat(40) }, { conclusion: 'failure' }, { event: 'pull_request' },
    { repository: { full_name: 'fork/h2a' } }, { path: 'other.yml' }, { head_branch: 'unprotected' }]) {
    await assert.rejects(fetchTrustedReceipt({ sha, request: fixture(overrides), download }), /trusted-receipt-absent/);
  }
  assert.equal(downloads, 1, 'untrusted runs never download an artifact');
  await assert.rejects(fetchTrustedReceipt({ sha, request: async path => path.includes('/branches/') ? { protected: false } : fixture()(path), download }), /trusted-receipt-absent/);
});

test('L11: the downloaded archive digest and exact receipt payload are verified before parsing', async () => {
  const { decodeAuthenticatedArtifact } = await import('./xcli-trusted-artifact.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-archive-'));
  try {
    const archive = join(root, 'receipt.zip'), payload = { sha: 'a'.repeat(40) };
    fs.writeFileSync(join(root, 'campaign-receipt.json'), JSON.stringify(payload));
    const zipped = spawnSync('/usr/bin/zip', ['-q', archive, 'campaign-receipt.json'], { cwd: root, env: environment(join(root, 'env')), encoding: 'utf8' });
    assert.equal(zipped.status, 0, zipped.stderr);
    const bytes = fs.readFileSync(archive), artifact = { digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
    assert.deepEqual(decodeAuthenticatedArtifact(artifact, bytes), payload);
    assert.throws(() => decodeAuthenticatedArtifact({ digest: 'sha256:' + '0'.repeat(64) }, bytes), /artifact-digest-mismatch/);
    fs.writeFileSync(join(root, 'unexpected.json'), '{}');
    assert.equal(spawnSync('/usr/bin/zip', ['-q', archive, 'unexpected.json'], { cwd: root, env: environment(join(root, 'env')) }).status, 0);
    const extra = fs.readFileSync(archive);
    assert.throws(() => decodeAuthenticatedArtifact({ digest: `sha256:${createHash('sha256').update(extra).digest('hex')}` }, extra), /artifact-files-unexpected/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
