#!/usr/bin/env node
// Run named product suites from a fresh source build, never checkout/installed dist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { sourceBuild, environment, repo, compliantQualificationRoot } from './xcli-lab.mjs';
import { verifyExecutionReport } from './test-execution-evidence.mjs';
import { ensureHistoricalGitRef, LEGACY_HOST_REF } from './historical-test-ref.mjs';
import { assertPrivatePidNamespace } from '../packages/h2a/test/helpers/private-pid-namespace.mjs';
import { exportEvidence } from './xcli-export-evidence.mjs';

const files = process.argv.slice(2);
assert.ok(files.length, 'explicit test files required');
for (const file of files) assert.match(file, /^packages\/h2a\/test\/[a-z0-9-]+\.test\.js$/);
// h2a_run deliberately rejects /tmp workspaces. Its historical integration
// fixture needs a private mkdtemp in the ephemeral GitHub runner's temp area,
// using the unchanged helper's default <build>/.q boundary instead.
const durableParent = process.env.XCLI_SOURCE_TMP_PARENT;
if (durableParent) {
  assert.equal(durableParent, '/home/runner/work/_temp', 'only the hosted CI temporary parent is allowed');
  assert.equal(fs.realpathSync(durableParent), durableParent, 'CI temporary parent must not be aliased');
}
const root = durableParent ? fs.mkdtempSync(join(durableParent, 'xcli-')) : compliantQualificationRoot();
const built = sourceBuild(root);
// Some source-consumer suites verify the shipped documentation and literal
// source citations. Preserve those fixtures in the same private build tree.
for (const name of ['h2a', 'h2a-runtime', 'track', 'remote-protocol']) {
  fs.cpSync(join(repo, 'packages', name, 'src'), join(built.path, 'packages', name, 'src'), { recursive: true });
}
fs.cpSync(join(repo, 'docs'), join(built.path, 'docs'), { recursive: true });
fs.cpSync(join(repo, 'packages/h2a/test'), join(built.path, 'packages/h2a/test'), { recursive: true });
// CLI contract and spawn-boundary consumers read shipped assets and runner
// configuration. Copy those fixtures unchanged; missing fixtures must fail.
// The memory-skill fixture also stages the packaged scripts and plugin
// descriptors from the same tree, so they ship here as well.
for (const name of ['skills', 'focus-app', 'hooks', 'scripts', '.claude-plugin', '.codex-plugin', '.mcp.json']) {
  fs.cpSync(join(repo, 'packages/h2a', name), join(built.path, 'packages/h2a', name), { recursive: true });
}
fs.cpSync(join(repo, 'packages/track/skills'), join(built.path, 'packages/track/skills'), { recursive: true });
for (const file of ['vitest.config.mjs', 'packages/h2a-runtime/vitest.config.mjs',
  'packages/track/vitest.config.ts', 'scripts/run-tests.mjs']) {
  fs.mkdirSync(join(built.path, file, '..'), { recursive: true });
  fs.copyFileSync(join(repo, file), join(built.path, file));
}
const qualificationRoot = durableParent ? join(built.path, '.q') : root;
const env = { ...environment(join(qualificationRoot, 'runner')),
  ...(!durableParent ? { H2A_TEST_QUALIFICATION_ROOT: root } : {}) };
if (files.includes('packages/h2a/test/native-inventory-absence.test.js')) {
  env.H2A_TEST_REQUIRE_LEGACY_HOST = '1';
  try {
    assertPrivatePidNamespace();
    ensureHistoricalGitRef(repo, LEGACY_HOST_REF);
    const legacy = join(root, 'legacy');
    fs.mkdirSync(legacy);
    const archive = spawnSync('git', ['archive', LEGACY_HOST_REF], { cwd: repo, maxBuffer: 200 * 1024 * 1024 });
    assert.equal(archive.status, 0, 'historical source archive required');
    assert.equal(spawnSync('/usr/bin/tar', ['-x', '-C', legacy], { input: archive.stdout }).status, 0);
    const ts = createRequire(join(repo, 'package.json'))('typescript');
    function compile(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { compile(path); continue; }
        if (entry.name.endsWith('.d.ts')) continue;
        const dest = path.replace('/src/', '/dist/').replace(/\.ts$/, '.js');
        fs.mkdirSync(join(dest, '..'), { recursive: true });
        const bytes = fs.readFileSync(path);
        fs.writeFileSync(dest, entry.name.endsWith('.ts') ? ts.transpileModule(bytes.toString(), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText : bytes);
      }
    }
    compile(join(legacy, 'packages/h2a-runtime/src'));
    fs.symlinkSync(join(built.path, 'node_modules'), join(legacy, 'node_modules'));
    env.H2A_TEST_LEGACY_HOST_DIR = legacy;
  } catch (error) {
    if (error.code !== 'ERR_ASSERTION') throw error;
    console.log('BLOCKED: historical procfs readers require the private PID namespace launcher; the required case must fail, never skip.');
  }
}
const executionReport = join(root, 'execution.json');
const args = ['--import', join(built.path, 'packages/h2a/test/helpers/native-isolation.js'),
  '--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
  `--test-reporter=${join(repo, 'scripts/node-evidence-reporter.mjs')}`,
  `--test-reporter-destination=${executionReport}`, '--test-concurrency=1', ...files];
const result = spawnSync(process.execPath, args, { cwd: built.path, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const output = (result.stdout ?? '') + (result.stderr ?? '');
fs.writeFileSync(join(root, 'tests.tap'), output);
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key =>
  [key, Number([...output.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].at(-1)?.[1] ?? -1)]));
fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify({ command: ['node', ...args], counts,
  exitCode: result.status, sourceBuild: built }, null, 2) + '\n');
exportEvidence(root, ['receipt.json', 'execution.json']);
process.stdout.write(output + `Evidence: ${root}\n`);
const declared = JSON.parse(fs.readFileSync(join(repo, 'scripts/test-non-tests-0986.json'), 'utf8')).entries
  .map(entry => ({ ...entry, file: join(built.path, entry.file) }));
const failures = verifyExecutionReport(JSON.parse(fs.readFileSync(executionReport, 'utf8')),
  files.map(file => join(built.path, file)), { declaredNonTests: declared });
for (const failure of failures) console.log(`FAILED EVIDENCE: ${failure}`);
process.exitCode = result.status === 0 && counts.tests > 0 && counts.cancelled === 0 && failures.length === 0 ? 0 : 1;
