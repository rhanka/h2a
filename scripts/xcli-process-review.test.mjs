import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, classifyExecJournal } from './xcli-lab.mjs';
import { pathToFileURL } from 'node:url';
const baseline = process.env.XCLI_PROCESS_REVIEW_BASELINE;

test('L6 review: native descendant execs are observed without self-reporting at 1/10/100ms', async () => {
  const { buildSupervisor, supervisedCommand, supervisorResult } = await import('./xcli-process-supervisor.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-process-'));
  try {
    const binary = buildSupervisor(root), fixture = join(root, 'python3.14'), launcher = join(root, 'launcher.mjs');
    const native = join(root, 'fixture.cc');
    fs.writeFileSync(native, '#include <unistd.h>\n#include <cstdlib>\nint main(int n,char**v){usleep(n>1?atoi(v[1])*1000:1000);return 0;}\n');
    const compiled = spawnSync('/usr/bin/g++', [native, '-o', fixture], { env: environment(join(root, 'compiler')), encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    fs.writeFileSync(launcher, `import {spawnSync} from 'node:child_process';
for (const ms of [1,10,100]) for(let n=0;n<3;n++) spawnSync(${JSON.stringify(fixture)},[String(ms)]);`);
    const command = baseline ? [process.execPath, launcher] : supervisedCommand(binary, root, [process.execPath, launcher]);
    const out = spawnSync(command[0], command.slice(1), { env: environment(join(root, 'env')), timeout: 10000, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    let result;
    if (baseline) {
      const old = spawnSync('git', ['show', `${baseline}:scripts/xcli-lab.mjs`], { encoding: 'utf8' });
      assert.equal(old.status, 0, old.stderr);
      const file = join(root, 'baseline-lab.mjs'); fs.writeFileSync(file, old.stdout);
      const lab = await import(pathToFileURL(file));
      const journal = join(root, 'journal.jsonl');
      // The old harness records its explicit launcher, never the native
      // descendants. The fixture itself never reports an exec.
      lab.recordExec(journal, { pid: out.pid, path: process.execPath, tag: 'harness' });
      result = { processRecovery: true, records: lab.readExecJournal(journal) };
    } else result = supervisorResult(root);
    assert.equal(result.processRecovery, true);
    assert.equal(classifyExecJournal(result.records).pythonDescendants.length, 9);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L5 review: lost worker descendants are stopped and reaped within the recovery bound', async () => {
  const { buildSupervisor, supervisedCommand, supervisorResult } = await import('./xcli-process-supervisor.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-process-'));
  let orphan;
  try {
    const binary = buildSupervisor(root), fixture = join(root, 'lost.mjs');
    fs.writeFileSync(fixture, `import {spawn} from 'node:child_process'; import fs from 'node:fs';
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(join(root, 'child.pid'))},String(child.pid));child.unref(); console.log('not-json');`);
    const command = baseline ? [process.execPath, fixture] : supervisedCommand(binary, root, [process.execPath, fixture]);
    const start = Date.now();
    const out = spawnSync(command[0], command.slice(1), { env: environment(join(root, 'env')), timeout: 10000, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(Date.now() - start < 6000);
    const pid = Number(fs.readFileSync(join(root, 'child.pid')));
    orphan = pid;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(supervisorResult(root).processRecovery, true);
  } finally {
    if (baseline && orphan) { try { process.kill(orphan, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('L6: a vendor subtree allowance ends when it launches our MCP entrypoint', async () => {
  const { buildSupervisor, supervisedCommand, supervisorResult } = await import('./xcli-process-supervisor.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-process-'));
  try {
    const binary = buildSupervisor(root), dummy = join(root, 'python3.14');
    fs.copyFileSync('/bin/true', dummy);
    const vendor = join(root, 'vendor.mjs'), mcp = join(root, 'mcp.mjs');
    fs.writeFileSync(vendor, `import {spawnSync} from 'node:child_process';spawnSync(${JSON.stringify(dummy)},[]);spawnSync(process.execPath,[${JSON.stringify(mcp)}]);`);
    fs.writeFileSync(mcp, `import {spawnSync} from 'node:child_process';spawnSync(${JSON.stringify(dummy)},[]);`);
    const command = supervisedCommand(binary, root, [process.execPath, vendor]);
    const out = spawnSync(command[0], command.slice(1), { env: { ...environment(join(root, 'env')),
      XCLI_VENDOR_PATHS: vendor, XCLI_HARNESS_ENTRYPOINTS: mcp }, timeout: 10000, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const result = supervisorResult(root);
    assert.equal(result.processRecovery, true);
    assert.equal(result.records.filter(r => r.path === dummy && r.tag === 'vendor').length, 1);
    assert.deepEqual(classifyExecJournal(result.records).pythonDescendants, [dummy]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
