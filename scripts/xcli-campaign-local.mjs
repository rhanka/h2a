// R19 local campaign mode (owner 01/11 17:40: test locally before burning
// GitHub CI). Runs the same cells on this machine, under the iso-w.sh
// confinement the conductor provides, with the same envelopes built by
// scripts/xcli-seat-provision.mjs --local from the local auth-only material
// (exact LOGIN_ALLOWLIST paths under the real HOME, read only by the
// provision script; MISTRAL_API_KEY from its environment for vibe).
// Envelopes travel to the cells through 0600 files in a 0700 dir — never
// into the real HOME — and the provision dir is shredded with a receipt
// after the run. No GitHub secret, no workflow run. The local campaign
// report is per-cell pass/fail with typed reasons, clearly labelled
// non-merge-gating: it never gates a merge. GitHub provisioning stays
// scripted but runs only after a green local campaign.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compliantQualificationRoot } from './xcli-lab.mjs';
import { DEFAULT_SEAT_SET, provisionSeats, shredFiles } from './xcli-seat-provision.mjs';
import { scanEvidenceText } from './xcli-evidence-scan.mjs';

const self = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(self));

export const LOCAL_GATE = 'local-non-merge-gating';

// Run one local campaign: provision envelopes, run the lane once per pair
// set through a single qualify invocation (pairs injected into the
// materialised manifest in place, so relative seat paths keep resolving),
// then report and shred. Returns the report object.
export function runLocalCampaign({ seatSet = DEFAULT_SEAT_SET, pairs = null,
  fullMatrix = false, slotManifestFile = join(repoRoot, 'docs/cross-cli-seat-slots.json'),
  homeDir = homedir(), env = process.env, ownerScope = 'owner', outBase = null,
  campaignRoot = null, reportFile = null, timeoutMs = 60000, sessionCap = null,
  mcpCallCap = 100, wallClockMs = 3600000, wakeOffsets = '0',
  simulated = false, spawnTimeoutMs = 600000 } = {}) {
  let outDir = null;
  try {
    const provisioned = provisionSeats({ seatSet, slotManifestFile, homeDir, env,
      ownerScope, ...(outBase ? { outBase } : {}), mode: 'local' });
    outDir = provisioned.outDir;
    const manifest = JSON.parse(fs.readFileSync(provisioned.manifestFile, 'utf8'));
    const seatIds = manifest.seats.map(seat => seat.seatId);
    let wanted = pairs;
    if (!wanted) {
      wanted = fullMatrix
        ? seatIds.flatMap(a => seatIds.map(b => `${a}:${b}`))
        : seatIds.map(id => `${id}:${id}`);
    }
    assert.ok(wanted.length, 'at least one pair required');
    manifest.pairs = wanted;
    fs.writeFileSync(provisioned.manifestFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    const root = campaignRoot ?? compliantQualificationRoot();
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const qualificationFile = join(root, 'qualification.json');
    const caps = sessionCap ?? (wanted.length + seatIds.length) * 2;
    const probed = spawnSync(process.execPath,
      [join(repoRoot, 'scripts/qualify-cross-cli.mjs'), '--seat-manifest', provisioned.manifestFile,
        '--campaign-root', root, '--timeout-ms', String(timeoutMs),
        '--wake-release-offsets-ms', wakeOffsets, '--session-cap', String(caps),
        '--mcp-call-cap', String(mcpCallCap), '--campaign-wall-clock-ms', String(wallClockMs),
        '--output', qualificationFile, ...(simulated ? ['--simulated'] : [])],
      { cwd: repoRoot, env: process.env, encoding: 'utf8', timeout: spawnTimeoutMs,
        maxBuffer: 16 * 1024 * 1024 });
    const qualification = fs.existsSync(qualificationFile)
      ? JSON.parse(fs.readFileSync(qualificationFile, 'utf8')) : null;
    const okStatus = simulated ? 'simulated-OK' : 'measured-OK';
    const cells = (qualification?.cells ?? []).map(cell => ({
      sender: cell.sender, receiver: cell.receiver,
      senderSeat: cell.seats?.sender ?? cell.senderSeat ?? null,
      receiverSeat: cell.seats?.receiver ?? cell.receiverSeat ?? null,
      status: cell.status, reason: cell.blocker ?? cell.failure ?? (cell.status === okStatus ? 'round-trip' : 'unknown'),
      elapsedMs: cell.elapsedMs ?? cell.parentElapsedMs ?? null,
      parentSecretWipe: cell.parentSecretWipe ?? null }));
    const report = { version: 1, gate: LOCAL_GATE, seatSet,
      manifestDigest: provisioned.manifestDigest, pairs: wanted, campaignRoot: root,
      qualifyStatus: probed.status, counts: {
        pass: cells.filter(cell => cell.status === okStatus).length,
        fail: cells.filter(cell => cell.status !== okStatus).length },
      cells, note: 'Local campaign under iso-w.sh confinement: same cells and envelopes as the protected lane, no GitHub secret, no workflow run — never merge-gating.' };
    scanEvidenceText(JSON.stringify(report));
    const reportPath = reportFile ?? join(root, 'local-campaign-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    report.reportFile = reportPath;
    return { report, green: probed.status === 0 && cells.length > 0 &&
      cells.every(cell => cell.status === okStatus) };
  } finally {
    // The provision dir (envelopes + seat HOMEs) is shredded whatever the
    // outcome. The campaign root (evidence only, scanned) stays for review.
    const surviving = outDir ? shredFiles([outDir]) : [];
    if (surviving.length) throw new Error('local-shred-unproven');
  }
}

const option = (args, name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const repeated = (args, name) => args.filter((arg, index) => index > 0 && args[index - 1] === name);

if (process.argv[1] && resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  const pairs = repeated(args, '--pair');
  try {
    const { report, green } = runLocalCampaign({
      seatSet: option(args, '--seat-set', DEFAULT_SEAT_SET),
      pairs: pairs.length ? pairs : null,
      fullMatrix: args.includes('--full-matrix'),
      slotManifestFile: option(args, '--slot-manifest', join(repoRoot, 'docs/cross-cli-seat-slots.json')),
      homeDir: option(args, '--home', homedir()), env: process.env,
      ownerScope: option(args, '--owner-scope', 'owner'),
      ...(option(args, '--out-base', null) ? { outBase: option(args, '--out-base', null) } : {}),
      ...(option(args, '--campaign-root', null) ? { campaignRoot: option(args, '--campaign-root', null) } : {}),
      ...(option(args, '--report', null) ? { reportFile: option(args, '--report', null) } : {}),
      timeoutMs: Number(option(args, '--timeout-ms', '60000')),
      ...(option(args, '--session-cap', null) ? { sessionCap: Number(option(args, '--session-cap', null)) } : {}),
      mcpCallCap: Number(option(args, '--mcp-call-cap', '100')),
      wallClockMs: Number(option(args, '--campaign-wall-clock-ms', '3600000')),
      wakeOffsets: option(args, '--wake-release-offsets-ms', '0'),
      simulated: args.includes('--simulated') });
    for (const cell of report.cells) {
      console.log(`${cell.senderSeat ?? cell.sender} -> ${cell.receiverSeat ?? cell.receiver}: ${cell.status} (${cell.reason})`);
    }
    console.log(JSON.stringify({ event: 'local-campaign-report', gate: report.gate,
      reportFile: report.reportFile, counts: report.counts, green }));
    console.log(JSON.stringify({ event: 'local-campaign-shredded', surviving: [] }));
    process.exitCode = green ? 0 : 2;
  } catch (error) {
    console.log(`local-campaign: REFUSED code=${error.message}`);
    process.exit(1);
  }
}
