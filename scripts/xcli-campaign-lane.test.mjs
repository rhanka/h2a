// Lot L11: lane-shape tests. The campaign workflow refuses to run without
// an explicit seat set and refuses fork refs; the PR lane carries the
// receipt-check job; the release lane gates on the exact-SHA receipt.
// Red while any lane misses its gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const campaign = fs.readFileSync(join(repo, '.github/workflows/cross-cli-campaign.yml'), 'utf8');
const prLane = fs.readFileSync(join(repo, '.github/workflows/cross-cli-messaging.yml'), 'utf8');
const release = fs.readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8');

test('L11: the campaign lane demands an explicit seat set', () => {
  assert.ok(/seat_set:\s*\n(\s+\S.*\n)*?\s+required:\s*true/.test(campaign), 'seat_set input is required');
  assert.ok(campaign.includes('test -n "${SEAT_SET}"') || campaign.includes('seat set is required'),
    'the lane refuses an empty seat set at runtime');
});

test('L11: the campaign lane refuses fork refs', () => {
  assert.ok(!/^ {2}pull_request:/m.test(campaign), 'no pull_request trigger');
  assert.ok(!/^\s+pull_request_target:/m.test(campaign), 'no pull_request_target semantics');
  assert.ok(campaign.includes("github.event_name != 'pull_request'"), 'PR events are refused in the job');
  assert.ok(campaign.includes('environment: cross-cli-seats'), 'seat material stays in the protected environment');
  assert.ok(/cancel-in-progress:\s*false/.test(campaign), 'a queued campaign waits instead of racing seats');
  assert.ok(campaign.includes('Wipe seat HOMEs unconditionally'), 'cancel cleanup wipes seats');
  assert.ok(/if:\s*always\(\)/.test(campaign), 'cleanup runs even on cancellation');
  assert.ok(campaign.includes('xcli-receipt-check.mjs'), 'the lane checks the receipt before publishing');
});

test('L11: the PR lane carries the receipt-check gate', () => {
  assert.ok(prLane.includes('receipt-check') || prLane.includes('receipt_gate'),
    'the PR lane runs the receipt check');
  assert.ok(prLane.includes('xcli-receipt-check.mjs'), 'the PR lane invokes the receipt check script');
  assert.ok(prLane.includes('--report-only'), 'lot PRs get report-only qualification instead of a gate');
  assert.ok(prLane.includes('qualification: open') || prLane.includes('report-only'),
    'report-only output never reads as merge-readiness');
});

test('L13: every mandated scenario row runs on the CI scenario axis', () => {
  const manifest = JSON.parse(fs.readFileSync(join(repo, 'docs/cross-cli-matrix.json'), 'utf8'));
  for (const scenario of manifest.simulationMandatory.scenarios) {
    assert.ok(prLane.includes(`"${scenario}"`), `${scenario} is on the CI axis`);
  }
});

test('L11: the release lane gates on the exact-SHA receipt', () => {
  assert.ok(release.includes('xcli-receipt-check.mjs'), 'release invokes the receipt check');
  assert.ok(release.includes('resolve-release-sha'), 'release checks the resolved SHA, never a mutable tag');
  assert.ok(/--gate release/.test(release), 'release gates at release scope');
});
