// The trust boundary is the authenticated GitHub Actions API, never fields
// self-declared in a local receipt. No seat material enters this module.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { environment } from './xcli-lab.mjs';

const repository = 'rhanka/h2a';
const workflow = '.github/workflows/cross-cli-campaign.yml';
const allowedBranches = ['main', 'feat/live-cross-cli-messaging'];
export async function githubRequest(path, archive = false) {
  assert.ok(process.env.GH_TOKEN, 'github-auth-required');
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'manual', signal: AbortSignal.timeout(30000),
  });
  if (archive && response.status === 302) {
    const location = new URL(response.headers.get('location'));
    assert.equal(location.protocol, 'https:');
    // The signed storage redirect receives no GitHub Authorization header.
    const storage = await fetch(location, { signal: AbortSignal.timeout(30000) });
    assert.ok(storage.ok, 'artifact-download-failed');
    return Buffer.from(await storage.arrayBuffer());
  }
  assert.ok(response.ok, `github-api-failed:${response.status}`);
  return response.json();
}
async function downloadReceipt(artifact) {
  const bytes = await githubRequest(`/actions/artifacts/${artifact.id}/zip`, true);
  return decodeAuthenticatedArtifact(artifact, bytes);
}
export function decodeAuthenticatedArtifact(artifact, bytes) {
  assert.equal(artifact.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`, 'artifact-digest-mismatch');
  const root = fs.mkdtempSync('/tmp/xcli-artifact-');
  try {
    const archive = join(root, 'receipt.zip'); fs.writeFileSync(archive, bytes, { mode: 0o600 });
    const options = { env: environment(root), cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 };
    const names = spawnSync('/usr/bin/unzip', ['-Z1', archive], options);
    assert.equal(names.status, 0, 'artifact-archive-invalid');
    assert.equal(names.stdout.trim(), 'campaign-receipt.json', 'artifact-files-unexpected');
    const extracted = spawnSync('/usr/bin/unzip', ['-p', archive, 'campaign-receipt.json'], options);
    assert.equal(extracted.status, 0, 'artifact-extraction-failed');
    return JSON.parse(extracted.stdout);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
export async function fetchTrustedReceipt({ sha, request = githubRequest, download = downloadReceipt }) {
  assert.match(sha ?? '', /^[0-9a-f]{40}$/, 'candidate-sha-required');
  // A workflow added on the candidate branch has no workflow-by-name API
  // entry yet. List this exact SHA's runs, then authenticate the workflow
  // and provenance below; an API/auth failure still fails distinctly.
  const runs = await request(`/actions/runs?status=success&per_page=100&head_sha=${sha}`);
  for (const run of runs.workflow_runs ?? []) {
    if (run.head_sha !== sha || run.repository?.full_name !== repository ||
        run.path !== workflow || run.conclusion !== 'success' ||
        !['workflow_dispatch', 'schedule'].includes(run.event) || !allowedBranches.includes(run.head_branch)) continue;
    const branch = await request(`/branches/${encodeURIComponent(run.head_branch)}`);
    if (branch.protected !== true) continue;
    const { artifacts } = await request(`/actions/runs/${run.id}/artifacts`);
    const artifact = artifacts?.find(a => a.name === `xcli-campaign-${sha}` && !a.expired &&
      a.workflow_run?.id === run.id && a.workflow_run?.head_sha === sha);
    if (!artifact) continue;
    const receipt = await download(artifact);
    assert.equal(receipt.sha, sha, 'artifact-candidate-mismatch');
    assert.equal(receipt.provenance?.runId, run.id, 'artifact-run-mismatch');
    assert.equal(receipt.provenance?.runAttempt, run.run_attempt, 'artifact-attempt-mismatch');
    return { receipt, provenance: { authenticated: true, repository, workflow, candidateSha: sha,
      runId: run.id, runAttempt: run.run_attempt, artifactId: artifact.id,
      receiptDigest: createHash('sha256').update(JSON.stringify(receipt)).digest('hex') } };
  }
  throw new Error('trusted-receipt-absent');
}
