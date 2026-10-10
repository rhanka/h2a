// Serial, isolated qualification. Every row records its exact invocation and source.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const repo = path.resolve(import.meta.dirname, '../..');
const input = JSON.parse(process.argv[2]);
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: input.worktree || repo, encoding: 'utf8' }).trim();
const common = { worktree: input.worktree || repo, sourceSha, fixtureRoot: repo+'/.qual-tmp/lab/large-campaign', mode: 'runtime', mcp: 'both', sidecar: false, n: 1,
  pinned: repo+'/.qual-tmp/playwright/node_modules/@playwright/mcp/cli.js', timeoutMs: 20000 };
// An archive checkout has no .git: baseline SHA is explicitly supplied and checked by its archive manifest.
if (input.sourceSha) common.sourceSha = input.sourceSha;
const env = { ...process.env, HOME: repo+'/.qual-tmp/home', XDG_RUNTIME_DIR: repo+'/.qual-tmp/runtime', XDG_STATE_HOME: repo+'/.qual-tmp/state', XDG_CONFIG_HOME: repo+'/.qual-tmp/config', TMPDIR: repo+'/.qual-tmp/tmp' };
const manifest = repo+'/.qual-tmp/evidence/'+input.label+'-commands.jsonl';
for (const scenario of input.scenarios) {
  if(input.reclaimOwnedFixtures)execFileSync(process.execPath,[repo+'/scripts/launch-perf/evict-owned.mjs'],{cwd:repo,env,stdio:'inherit'});
  const options = { ...common, ...scenario };
  const args = [repo+'/scripts/launch-perf/probe.mjs', JSON.stringify(options)];
  const raw = repo+'/.qual-tmp/evidence/'+options.label+'.log';
  fs.appendFileSync(manifest, JSON.stringify({ command: process.execPath, args, env: Object.fromEntries(['HOME','XDG_RUNTIME_DIR','XDG_STATE_HOME','XDG_CONFIG_HOME','TMPDIR'].map(k=>[k,env[k]])), raw, sourceSha: options.sourceSha })+'\n');
  const fd = fs.openSync(raw, 'wx', 0o600);
  const child = spawn(process.execPath, args, { cwd: repo, env, stdio: ['ignore', fd, fd] });
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  fs.closeSync(fd);
  console.log(JSON.stringify({ label: options.label, code, raw, sourceSha: options.sourceSha }));
}
