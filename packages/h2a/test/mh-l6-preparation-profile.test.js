import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preparePublishedImage } from '../src/runtime/upgrade/published-payload.js';

test('diagnostic: measure actual closed payload copy and durable sync costs', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-preparation-profile-'));
  const children = [], spawn = cp.spawn;
  cp.spawn = function(...args) { const child = spawn.apply(this, args); children.push({ child, closed: new Promise(resolve => child.once('close', resolve)) }); return child; };
  syncBuiltinESMExports();
  t.after(async () => {
    for (const { child } of children) { if (child.exitCode === null && child.signalCode === null) child.ref(); for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.ref?.(); }
    (await import('esbuild')).stop(); await Promise.all(children.map(row => row.closed));
    cp.spawn = spawn; syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true });
  });
  const { buildReleasePayload } = await import('../../../scripts/mh-l1-package-prototype.mjs');
  const payload = await buildReleasePayload(join(root, 'payload'), { version: '0.98.7', buildId: 'mh-l6-release-cohort' });
  const sync = fs.fsyncSync, asyncSync = fs.fsync, copy = fs.cpSync;
  let syncMs = 0, copyMs = 0, files = 0, directories = 0, active = 0, maximum = 0;
  fs.fsyncSync = fd => {
    const info = fs.fstatSync(fd), began = performance.now();
    try { return sync(fd); } finally { syncMs += performance.now() - began; if (info.isFile()) files++; else directories++; }
  };
  fs.fsync = (fd, callback) => {
    const info = fs.fstatSync(fd), began = performance.now(); active++; maximum = Math.max(maximum, active);
    return asyncSync(fd, error => {
      syncMs += performance.now() - began; active--; if (info.isFile()) files++; else directories++;
      callback(error);
    });
  };
  fs.cpSync = (...args) => { const began = performance.now(); try { return copy(...args); } finally { copyMs += performance.now() - began; } };
  const began = performance.now();
  try {
    const image = await preparePublishedImage(payload.root, join(root, 'image'));
    assert.equal(image.manifestDigest, payload.manifestDigest);
  } finally {
    fs.fsyncSync = sync; fs.fsync = asyncSync; fs.cpSync = copy;
    t.diagnostic(JSON.stringify({ diagnosticOnly: true, totalMs: performance.now() - began, syncCallAggregateMs: syncMs, copyMs, files, directories, maximum, active }));
  }
});
