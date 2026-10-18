import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { command } from '../src/vuln-fix/process.mjs';
import { scanLocks } from '../src/vuln-fix/scan.mjs';
import { supplyChain } from '../src/vuln-fix/verify.mjs';

test('should settle timeout even when a descendant would keep inherited pipes open', { timeout: 200 }, async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed;
  child.kill = signal => { killed = signal; }; // no close: inherited pipe remains open.
  await assert.rejects(command('fake', [], { timeout: 10, spawner: () => child }), /timeout/);
  assert.equal(killed, 'SIGKILL');
  assert.equal(child.stdout.destroyed, true);
});

test('should force full dependency coverage and mask credentials in supply-chain checks', async () => {
  const seen = [];
  const raw = 'supply-fake-credential-135792468';
  const execute = async (cmd, args) => {
    seen.push([cmd, args]);
    return { code: 1, stdout: `registry failure Authorization: Bearer ${raw}`, stderr: '' };
  };
  const repo = { locks: ['package-lock.json'], workspace: '/fixture', execute };
  const results = await supplyChain(repo, new Date('2026-10-20T00:00:00Z'));
  assert.equal(results.ok, false);
  for (const [, args] of seen.filter(([, entry]) => entry[0] !== 'view')) {
    for (const flag of ['--include=dev', '--include=optional', '--include=peer']) assert.ok(args.includes(flag), `npm misses ${flag}`);
  }
  assert.ok(!JSON.stringify(results).includes(raw));
});

test('should preserve process quarantine through detection and supply-chain aggregation', async () => {
  const failure = Object.assign(new Error('timeout'), { quarantine: true });
  const execute = async () => { throw failure; };
  await assert.rejects(scanLocks({ root: '/fixture', locks: ['package-lock.json'], osv: false, command: execute,
    readLock: () => ({ lockfileVersion: 3, packages: {} }) }), error => error.quarantine === true);
  await assert.rejects(supplyChain({ locks: ['package-lock.json'], workspace: '/fixture', execute }, new Date()), error => error.quarantine === true);
});
