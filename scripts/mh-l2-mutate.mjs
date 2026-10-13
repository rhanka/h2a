// Test-only mutation proofs. Every byte is restored even on an unexpected exit.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const cases = {
  unicode: ['authenticated-http.js', 'buffer += decoder.write(Buffer.from(value));', "buffer += Buffer.from(value).toString('utf8');", 'auth'],
  durable: ['admission.js', 'stateDirectory = registry.value.stateDirectory;', 'stateDirectory = directory;', 'image', true],
  'owner-record': ['launch.js', "if (owner?.value.ownerState === 'ACTIVE')", 'if (false)', 'image', true],
  compensation: ['compensation.js', "upgrade.controllerAuthorityState !== 'ACTIVE' ||", '', 'compensation'],
  pause: ['selection.js', "if (pause && kind !== 'explicit-serve') throw new Error('deferred_paused');", '', 'starters'],
  mac: ['authentication.js', " || !verify(this.key, 'requests', context(m), unsigned(request), request.mac)", '', 'auth'],
  socket: ['authenticated-http.js', 'if (requiredSocket && (assigned !== requiredSocket || assigned.destroyed))', 'if (false)', 'auth'],
  owner: ['admission.js', "if (liveness !== 'dead') throw new Error", 'if (false) throw new Error', 'authority'],
  inode: ['admission.js', ' || now.ino !== expected.ino', '', 'authority'],
  precheck: ['administration.js', '      this.options.verifyPrecheck(payload.precheckEvidenceDigest, payload.target);', '', 'image', true],
  stop: ['administration.js', "      const result = this.update(observed, { state: 'STOP_COMMITTED' }, step, { state: 'STOP_COMMITTED', generation: m.generation });",
    "      this.requestClose();\n      const result = this.update(observed, { state: 'STOP_COMMITTED' }, step, { state: 'STOP_COMMITTED', generation: m.generation });", 'cold'],
  budget: ['successor.js', "fatal || tx.successorReservation.attempts >= 3 ? 'SUCCESSOR_FAILED' : 'STOPPED'", "fatal ? 'SUCCESSOR_FAILED' : 'STOPPED'", 'cold']
};
const name = process.argv[2], vector = cases[name];
if (!vector) throw new Error(`unknown mutation: ${name}`);
const [leaf, before, after, file, build] = vector;
const path = `packages/h2a/src/runtime/handover/${leaf}`;
const source = fs.readFileSync(path, 'utf8');
if (source.split(before).length !== 2) throw new Error('mutation_anchor_not_unique');
const compile = () => {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b', 'packages/h2a', 'packages/h2a-runtime', '--pretty', 'false'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('mutation_compile_failed');
};
let code;
try {
  fs.writeFileSync(path, source.replace(before, after));
  if (build) compile();
  const result = spawnSync(process.execPath, ['scripts/mh-l2-test.mjs', `packages/h2a/test/mh-l2-${file}.test.js`, `mutation-${name}-red`], { stdio: 'inherit' });
  code = result.status;
} finally { fs.writeFileSync(path, source); if (build) compile(); }
if (code !== 1) throw new Error(`mutation_survived_or_failed_abnormally:${code}`);
const result = spawnSync(process.execPath, ['scripts/mh-l2-test.mjs', `packages/h2a/test/mh-l2-${file}.test.js`, `mutation-${name}-green`], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
