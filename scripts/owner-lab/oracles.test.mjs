import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { readable, safeCounts } from './support.mjs';

const counts = extras => ['# tests 1', '# pass 1', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0', ...extras].join('\n');
test('qualification refuses skips, cancellation, TODO and missing execution evidence', () => {
  assert.equal(safeCounts(counts([])).pass, 1);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.throws(() => safeCounts(counts([`# ${key} 1`])));
  assert.throws(() => safeCounts(''));
  assert.throws(() => safeCounts(counts(['# tests 0', '# pass 0'])));
});
test('human output oracle rejects an escaped JSON wall and empty output', () => {
  readable('h2a upgraded to 1.2.3\nCodex: ready\n');
  readable('[h2a] 2 sessions restored\n');
  for (const value of ['', '{"result":"{\\n  \\"ok\\":true}"}', '{\n  "ok": true\n}']) assert.throws(() => readable(value));
});

async function run(file, args, env) {
  const child = spawn(process.execPath, [file, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const status = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  return { status, stdout, stderr };
}
test('fake gh exposes REST pulls metadata but refuses unsupported fields and wrong selectors', async t => {
  const calls = [];
  const server = createServer((req, res) => { calls.push(req.url); res.end(JSON.stringify({ number: 42, base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } })); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const env = { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR, OWNER_LAB_GITHUB: `http://127.0.0.1:${server.address().port}` };
  const gh = resolve(import.meta.dirname, 'gh.mjs');
  const positive = await run(gh, ['api', '--hostname', 'github.com', 'repos/fixture/own/pulls/42'], env);
  assert.equal(positive.status, 0); assert.equal(JSON.parse(positive.stdout).base.sha, 'a'.repeat(40));
  const jq = await run(gh, ['api', 'repos/fixture/own/pulls/42', '--jq', '.head.sha'], env);
  assert.equal(jq.stdout, 'b'.repeat(40));
  for (const args of [
    ['pr', 'view', '42', '--json', 'baseRefOid,headRefOid'],
    ['pr', 'diff', '99', '--repo', 'fixture/own'],
    ['pr', 'diff', '42', '--repo', 'fixture/foreign'],
    ['api', 'repos/fixture/own/pulls/42', '-X', 'DELETE'],
  ]) assert.notEqual((await run(gh, args, env)).status, 0);
  assert.deepEqual(calls, ['/repos/fixture/own/pulls/42', '/repos/fixture/own/pulls/42']);
});
test('launcher failure still emits seven FAILs and removes its private scratch', async t => {
  assert.ok(process.env.TMPDIR && !tmpdir().startsWith('/tmp'), 'Tests require the sanctioned TMPDIR');
  const root = mkdtempSync(join(tmpdir(), 'owner-lab-oracle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, 'evidence');
  const result = await run(resolve(import.meta.dirname, 'run.mjs'), ['--ref', 'owner-lab-nonexistent-ref', '--temp-parent', root, '--output', output], {
    PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root,
  });
  assert.equal(result.status, 1);
  const verdicts = JSON.parse(readFileSync(join(output, 'verdicts.json')));
  assert.equal(verdicts.length, 7); assert.ok(verdicts.every(r => r.verdict === 'FAIL'));
  const cleanup = JSON.parse(readFileSync(join(output, 'cleanup.json')));
  assert.equal(cleanup.removed, true); assert.equal(existsSync(cleanup.scratch), false);
});
