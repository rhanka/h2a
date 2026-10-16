// Bounded review-finding proofs: explicit test files, private state, no skips.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

process.umask(0o022);
const major = Number(process.versions.node.split('.')[0]);
if (![22, 24].includes(major)) throw new Error('Node 22/24 required');
const evidence = 'docs/plan/mh-l2/evidence';
fs.mkdirSync(evidence, { recursive: true });
function execute(file, label, extra = {}, omitted = []) {
  const directory = fs.mkdtempSync('/tmp/mh-l2-amendment-');
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_OPTIONS: '--max-old-space-size=768', ...extra };
  for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
    'REMOTE_CLI_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'TMPDIR', 'H2A_ROOT']) {
    if (omitted.includes(key)) continue;
    env[key] = join(directory, key.toLowerCase()); fs.mkdirSync(env[key], { mode: 0o700 });
  }
  // os.tmpdir() must fall back to a private root even with TMPDIR unset.
  if (omitted.includes('TMPDIR')) env.TMP = directory;
  const args = ['--test', '--test-reporter=tap', file];
  try {
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const output = `command: ${process.execPath} ${args.join(' ')}\nnode: ${process.version}\nprivate root: ${directory}\nenv selection: ${JSON.stringify(extra)}; unset: ${omitted.join(',')}\n${result.stdout}${result.stderr}\nreceipt: ${JSON.stringify({ code: result.status, signal: result.signal })}\n`;
    const path = join(evidence, `l2fix-node${major}-${label}.log`);
    fs.writeFileSync(path, output);
    const count = Number(/# tests (\d+)/.exec(output)?.[1]);
    if (!count || !/# skipped 0\b/.test(output) || !/# cancelled 0\b/.test(output) || !/# todo 0\b/.test(output)) throw new Error('missing_or_skipped_or_cancelled_oracle:' + path);
    process.stdout.write(`${path}: ${count} tests, exit=${result.status}, signal=${result.signal}\n`);
    return { code: result.status, output, count };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const liveTest = 'packages/h2a/test/mh-l2-live.test.js', identityTest = 'packages/h2a/test/mh-l2-identity-contention.test.js';
const handover = 'packages/h2a/src/runtime/handover/';
const cases = [
  ['admissions-contradiction', handover + 'administration.js', '    this.observeLivePublication(this.transaction());', '', liveTest,
    'reserved live source should durably close admissions on every publication contradiction without a deadline'],
  ['expiry-contradiction', handover + 'administration.js', '    observed = this.observeLivePublication(observed);', '', liveTest,
    'reserved live source should durably close admissions on every publication contradiction without a deadline'],
  ['authority-order', handover + 'administration.js', '    let observed = this.observeLivePublication(this.transaction());', '    let observed = this.transaction();', liveTest,
    'real authority verification should persist publication contradictions before rejecting administrative requests'],
  ['aborted-authority', handover + 'live-source.js', "tx.state === 'ABORTED' || ", '', liveTest,
    'aborted live authorization should never authorize a successor marker'],
  ['expired-publication', handover + 'administration.js', "if (tx.barrierDeadline === null) throw new Error('barrier_required');", "if (tx.barrierDeadline <= this.now()) throw new Error('barrier_expired');", liveTest,
    'concordant publication should retire after an expired barrier without reversing time or skipping G0 drain'],
  ['ownership-order', handover + 'participants.js', "        if (!['PUBLISHED', 'RETIRED'].includes(tx.state) && owner.state !== 'FROZEN') throw new Error('checkpoint_not_frozen');", '', liveTest,
    'checkpoint validation should reject transferring or acquired owners before durable source publication'],
  ['key-generation-lock', 'packages/h2a/src/runtime/identity/live.ts',
    "const prepared = readKeypair(root, instance) ??\n    (adoptFromInstance ? readKeypair(root, adoptFromInstance) : undefined) ?? generateKeypair();",
    "const prepared = withWriterMutation(root, 'registry', () => readKeypair(root, instance) ??\n    (adoptFromInstance ? readKeypair(root, adoptFromInstance) : undefined) ?? generateKeypair());", identityTest,
    'identity should generate Ed25519 keys outside the global writer lock and recheck the gate before publishing'],
  ['identity-retry', 'packages/h2a/src/runtime/identity/worker.ts',
    'if ((err instanceof LockTimeoutError || (err instanceof Error && err.message === "mutation_lock_unavailable")) && remainingMs() > 0)',
    'if (err instanceof LockTimeoutError && remainingMs() > 0)', identityTest,
    'identity worker should retry mutation contention within its identity budget'],
  ['key-publication-race', 'packages/h2a/src/runtime/identity/live.ts',
    '    const existing = readKeypair(root, instance);', "    const existing = readKeypair(root, instance + ':other');", identityTest,
    'identity should preserve a competing keypair published while its candidate is generated'],
  ['identity-timeout', 'packages/h2a/src/runtime/identity/worker.ts',
    '(err.name === "LockTimeoutError" || err.message === "mutation_lock_unavailable")', 'err.name === "LockTimeoutError"', identityTest,
    'identity worker should classify exhausted mutation contention as identity_timeout'],
  ['delete-barrier', 'packages/h2a/src/runtime/mcp-central.ts',
    'let control = context.req.method === "GET";', 'let control = context.req.method !== "POST";', 'packages/h2a/test/mh-l2-live-central.test.js'],
  ['temp-fallback', 'packages/h2a/test/mh-l2-live-central.test.js',
    'process.env.H2A_HANDOVER_TEST_TMPDIR || process.env.TMPDIR || tmpdir()', 'process.env.TMPDIR', 'packages/h2a/test/mh-l2-live-central.test.js']
];
const compile = () => {
  const args = ['node_modules/typescript/bin/tsc', '-b', 'packages/h2a', '--pretty', 'false'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('proof_build_failed:' + result.stdout + result.stderr);
};
const [mode = 'portability', ...selected] = process.argv.slice(2);
if (mode === 'portability') {
  const result = execute('packages/h2a/test/mh-l2-live-central.test.js', selected[0] ?? 'portability', {}, ['TMPDIR', 'XDG_CACHE_HOME']);
  process.stdout.write(result.output);
  process.exitCode = result.code ?? 1;
} else if (mode === 'mutate') {
  const chosen = selected.length ? cases.filter(([name]) => selected.includes(name)) : cases;
  if (!chosen.length || selected.some(name => !cases.some(c => c[0] === name))) throw new Error('unknown_mutation');
  for (const [name, path, before, after, file, oracle] of chosen) {
    const source = fs.readFileSync(path, 'utf8');
    if (source.split(before).length !== 2) throw new Error('nonunique_mutation_anchor:' + name);
    const build = path.endsWith('.ts'), extra = oracle ? { [file === liveTest ? 'MH_L2_LIVE_CASE' : 'MH_L2_IDENTITY_CASE']: oracle } : {};
    const omitted = name === 'temp-fallback' ? ['TMPDIR', 'XDG_CACHE_HOME'] : [];
    let red;
    try {
      fs.writeFileSync(path, source.replace(before, after));
      if (build) compile();
      red = execute(file, name + '-mutant', extra, omitted);
    } finally {
      fs.writeFileSync(path, source);
      if (build) compile();
    }
    if (red.code !== 1 || red.count !== 1 || !red.output.includes('ERR_ASSERTION')) throw new Error('mutant_survived_or_failed_abnormally:' + name);
    const green = execute(file, name + '-restored', extra, omitted);
    if (green.code !== 0 || green.count !== 1) throw new Error('restored_source_failed:' + name);
    process.stdout.write(`node${major} ${name}: mutant=1 (ERR_ASSERTION), restored=0; one oracle, zero skips\n`);
  }
  process.stdout.write(`node${major}: ${chosen.length}/${chosen.length} mutants killed and restored\n`);
} else throw new Error('unknown_proof_mode');
