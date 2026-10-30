import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, sourceBuild, repo, compliantQualificationRoot } from './xcli-lab.mjs';
import { parseWakeWindows } from './qualify-cross-cli.mjs';
import { verifyWakePhases } from './xcli-ci-check.mjs';

// A real startup dialog may render its choice before it starts accepting keys.
// No login or provider is used; after consent this runs the signed product path.
test('a partially rendered Cancel-focused trust dialog completes before the live round trip', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root);
    const fixture = join(root, 'startup.mjs');
    fs.writeFileSync(fixture, `import { pathToFileURL } from 'node:url';
process.stdin.setRawMode(true);
process.stdin.resume();
let accepting = false, complete = false;
process.stdout.write('Quick safety check: Is this a project you trust?\\r\\nNo, exit\\r\\nYes, I trust this folder\\r\\n');
const timer = setTimeout(() => {
  accepting = true;
  process.stdout.write('Enter to confirm\\r\\n');
}, 600);
async function input(bytes) {
  if (!accepting || complete || !bytes.toString().includes('\\x1b[B\\r')) return;
  complete = true;
  clearTimeout(timer);
  process.stdin.off('data', input);
  process.stdout.write('\\x1b[2J\\x1b[H');
  await import(pathToFileURL(${JSON.stringify(join(repo, 'scripts/xcli-simulated-model.mjs'))}));
}
process.stdin.on('data', input);
`);
    const syntax = spawnSync(process.execPath, ['--check', fixture], { env: environment(join(root, 'syntax')), encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const executables = {};
    for (const cli of ['claude']) {
      const executable = join(root, cli);
      fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' '${cli}' "$@"\n`, { mode: 0o700 });
      executables[cli] = executable;
    }
    let worker = join(repo, 'scripts/qualify-cross-cli.mjs');
    if (process.env.XCLI_STARTUP_BASELINE) {
      const baseline = spawnSync('git', ['show', process.env.XCLI_STARTUP_BASELINE + ':scripts/qualify-cross-cli.mjs'],
        { cwd: repo, encoding: 'utf8' });
      assert.equal(baseline.status, 0);
      let source = baseline.stdout;
      for (const name of ['xcli-lab.mjs', 'xcli-terminal.mjs'])
        source = source.replace("'./" + name + "'", JSON.stringify(pathToFileURL(join(repo, 'scripts', name)).href));
      worker = join(root, 'baseline-worker.mjs');
      fs.writeFileSync(worker, source);
    }
    const result = spawnSync(process.execPath, [worker, '--worker'], {
      cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      input: JSON.stringify({ sender: 'claude', receiver: 'claude', root, build: built.path,
        executables, timeoutMs: 60000, simulated: true,
        wake: parseWakeWindows(undefined, true), releaseOffsetMs: 0 }),
      encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0);
    const cell = JSON.parse(result.stdout);
    assert.notEqual(cell.cleanupFailed, true, JSON.stringify(cell.cleanupErrors));
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('c-')).length, 0);
    assert.equal(cell.status, 'simulated-OK', JSON.stringify(cell));
    assert.deepEqual(verifyWakePhases(cell), [], 'the startup consumer must fund and witness all cell-level phases');
    assert.equal(cell.noPostSendHarnessInput, true);
    assert.deepEqual(cell.evidence.filter(e => e.event === 'startup-ui').map(e => e.action),
      ['trust-empty-workspace', 'trust-empty-workspace']);
    assert.equal(cell.replyDelivered, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R15 (class-c RED): a post-trust MCP-approval Allow screen (captured 2.1.314
// vocabulary) must be answered like any normal startup UI. Red on the
// pre-fix worker (XCLI_STARTUP_BASELINE=HEAD): no startup key matches, the
// screen is classified tool-approval-required and the cell blocks.
test('an MCP-approval Allow screen is answered before the live round trip', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root);
    const fixture = join(root, 'allow.mjs');
    fs.writeFileSync(fixture, `import { pathToFileURL } from 'node:url';
process.stdin.setRawMode(true);
process.stdin.resume();
let allowed = false;
process.stdout.write('MCP servers need permission to run in this workspace\\r\\nOnly allow tools from sources you trust\\r\\n[Allow] [Deny]\\r\\nPress Enter to confirm your choice\\r\\n');
async function input(bytes) {
  if (allowed || !bytes.toString().includes('\\r')) return;
  allowed = true;
  process.stdin.off('data', input);
  process.stdout.write('\\x1b[2J\\x1b[H');
  await import(pathToFileURL(${JSON.stringify(join(repo, 'scripts/xcli-simulated-model.mjs'))}));
}
process.stdin.on('data', input);
`);
    const syntax = spawnSync(process.execPath, ['--check', fixture], { env: environment(join(root, 'syntax')), encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const executables = {};
    for (const cli of ['claude']) {
      const executable = join(root, cli);
      fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' '${cli}' "$@"\n`, { mode: 0o700 });
      executables[cli] = executable;
    }
    let worker = join(repo, 'scripts/qualify-cross-cli.mjs');
    if (process.env.XCLI_STARTUP_BASELINE) {
      const baseline = spawnSync('git', ['show', process.env.XCLI_STARTUP_BASELINE + ':scripts/qualify-cross-cli.mjs'],
        { cwd: repo, encoding: 'utf8' });
      assert.equal(baseline.status, 0);
      let source = baseline.stdout;
      for (const name of ['xcli-lab.mjs', 'xcli-terminal.mjs'])
        source = source.replace("'./" + name + "'", JSON.stringify(pathToFileURL(join(repo, 'scripts', name)).href));
      worker = join(root, 'baseline-worker.mjs');
      fs.writeFileSync(worker, source);
    }
    const result = spawnSync(process.execPath, [worker, '--worker'], {
      cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      input: JSON.stringify({ sender: 'claude', receiver: 'claude', root, build: built.path,
        executables, timeoutMs: 60000, simulated: true,
        wake: parseWakeWindows(undefined, true), releaseOffsetMs: 0 }),
      encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0);
    const cell = JSON.parse(result.stdout);
    assert.notEqual(cell.cleanupFailed, true, JSON.stringify(cell.cleanupErrors));
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('c-')).length, 0);
    assert.equal(cell.status, 'simulated-OK', JSON.stringify(cell));
    assert.deepEqual(cell.evidence.filter(e => e.event === 'startup-ui').map(e => e.action),
      ['mcp-approval-allow', 'mcp-approval-allow']);
    assert.equal(cell.replyDelivered, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R15 (class-c RED): a trust dialog asking for a second confirmation (Muse
// 1.4.14) must get its second Enter. Red on the pre-fix worker
// (XCLI_STARTUP_BASELINE=HEAD): the single-shot guard turns the second
// screen into a no-op loop and the fixture exits unconfirmed.
test('a repeated trust screen gets its second confirmation before the round trip', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root);
    const fixture = join(root, 'trust-twice.mjs');
    fs.writeFileSync(fixture, `import { pathToFileURL } from 'node:url';
process.stdin.setRawMode(true);
process.stdin.resume();
let presses = 0, done = false;
process.stdout.write('Do you trust this workspace?\\r\\nTrust and continue\\r\\n');
const giveUp = setTimeout(() => { if (!done) process.exit(1); }, 25000);
async function input(bytes) {
  if (done || !bytes.toString().includes('\\r')) return;
  presses += 1;
  if (presses === 1) {
    process.stdout.write('Do you trust this workspace?\\r\\nTrust and continue (confirm again)\\r\\n');
    return;
  }
  done = true;
  clearTimeout(giveUp);
  process.stdin.off('data', input);
  process.stdout.write('\\x1b[2J\\x1b[H');
  await import(pathToFileURL(${JSON.stringify(join(repo, 'scripts/xcli-simulated-model.mjs'))}));
}
process.stdin.on('data', input);
`);
    const syntax = spawnSync(process.execPath, ['--check', fixture], { env: environment(join(root, 'syntax')), encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const executables = {};
    for (const cli of ['claude']) {
      const executable = join(root, cli);
      fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' '${cli}' "$@"\n`, { mode: 0o700 });
      executables[cli] = executable;
    }
    let worker = join(repo, 'scripts/qualify-cross-cli.mjs');
    if (process.env.XCLI_STARTUP_BASELINE) {
      const baseline = spawnSync('git', ['show', process.env.XCLI_STARTUP_BASELINE + ':scripts/qualify-cross-cli.mjs'],
        { cwd: repo, encoding: 'utf8' });
      assert.equal(baseline.status, 0);
      let source = baseline.stdout;
      for (const name of ['xcli-lab.mjs', 'xcli-terminal.mjs'])
        source = source.replace("'./" + name + "'", JSON.stringify(pathToFileURL(join(repo, 'scripts', name)).href));
      worker = join(root, 'baseline-worker.mjs');
      fs.writeFileSync(worker, source);
    }
    const result = spawnSync(process.execPath, [worker, '--worker'], {
      cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      input: JSON.stringify({ sender: 'claude', receiver: 'claude', root, build: built.path,
        executables, timeoutMs: 60000, simulated: true,
        wake: parseWakeWindows(undefined, true), releaseOffsetMs: 0 }),
      encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0);
    const cell = JSON.parse(result.stdout);
    assert.notEqual(cell.cleanupFailed, true, JSON.stringify(cell.cleanupErrors));
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('c-')).length, 0);
    assert.equal(cell.status, 'simulated-OK', JSON.stringify(cell));
    assert.deepEqual(cell.evidence.filter(e => e.event === 'startup-ui').map(e => e.action).sort(),
      ['trust-confirm-second', 'trust-confirm-second', 'trust-empty-workspace', 'trust-empty-workspace']);
    assert.equal(cell.replyDelivered, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R17 (P2-2 RED): no tool, permission or shell-command approval may ever be
// auto-answered. On the pre-fix worker the broad MCP heuristic sends \r to
// each of these screens and the cell dies at its deadline as
// mcp-not-loaded-before-deadline; the fix must block them closed without a
// single key press.
test('tool and shell-command approvals are never auto-approved, they block the cell', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root);
    for (const [name, screen] of [
      ['tool', 'Allow tool "bash" to run? [y/n]'],
      ['approve', 'Approve tool execution: rm -rf /? Press Enter to allow'],
      ['permission', 'Permission required: Allow tool write_file?'],
      ['shell', 'Allow this shell command? Press Enter to confirm'],
    ]) {
      const journal = join(root, `${name}-keys.jsonl`);
      const fixture = join(root, `${name}.mjs`);
      fs.writeFileSync(fixture, `import fs from 'node:fs';
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(${JSON.stringify(screen)} + '\\\\r\\\\n');
process.stdin.on('data', bytes => {
  fs.appendFileSync(${JSON.stringify(journal)}, JSON.stringify({ keys: bytes.toString() }) + '\\\\n');
});
`);
      const syntax = spawnSync(process.execPath, ['--check', fixture], { env: environment(join(root, 'syntax')), encoding: 'utf8' });
      assert.equal(syntax.status, 0, syntax.stderr);
      const executable = join(root, name);
      fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' 'claude' "$@"\n`, { mode: 0o700 });
      const result = spawnSync(process.execPath, [join(repo, 'scripts/qualify-cross-cli.mjs'), '--worker'], {
        cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
        input: JSON.stringify({ sender: 'claude', receiver: 'claude', root, build: built.path,
          executables: { claude: executable }, simulated: true, timeoutMs: 8000 }),
        encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
      });
      assert.equal(result.status, 0, result.stderr);
      const cell = JSON.parse(result.stdout);
      assert.notEqual(cell.cleanupFailed, true, JSON.stringify(cell.cleanupErrors));
      assert.equal(cell.status, 'blocked', JSON.stringify({ screen, status: cell.status, failure: cell.failure }));
      assert.equal(cell.blocker, 'tool-approval-required', JSON.stringify({ screen, blocker: cell.blocker }));
      const keys = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8') : '';
      assert.ok(!keys.includes('\\r'), `no Enter key may ever reach an approval screen: ${keys}`);
      assert.deepEqual(cell.evidence.filter(e => e.event === 'startup-ui'), [],
        'no approval screen may be recorded as a startup action');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R17 (P3-1 RED): a CLI that dies right after its startup press must be
// classified through the exited state — never spun on the stale startup
// screen until the deadline reports mcp-not-loaded-before-deadline.
test('a CLI that dies after a startup press is classified as exited, never deadline-failed', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root);
    const journal = join(root, 'keys.jsonl');
    const fixture = join(root, 'die-after-press.mjs');
    fs.writeFileSync(fixture, `import fs from 'node:fs';
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('Choose your permissions\\\\r\\\\nDefault (current)\\\\r\\\\nPress \u21b5 to continue\\\\r\\\\n');
process.stdin.on('data', bytes => {
  fs.appendFileSync(${JSON.stringify(journal)}, JSON.stringify({ keys: bytes.toString() }) + '\\\\n');
  process.exit(0);
});
`);
    const syntax = spawnSync(process.execPath, ['--check', fixture], { env: environment(join(root, 'syntax')), encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const executable = join(root, 'claude');
    fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' 'claude' "$@"\n`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [join(repo, 'scripts/qualify-cross-cli.mjs'), '--worker'], {
      cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      input: JSON.stringify({ sender: 'claude', receiver: 'claude', root, build: built.path,
        executables: { claude: executable }, simulated: true, timeoutMs: 8000 }),
      encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr);
    const cell = JSON.parse(result.stdout);
    assert.notEqual(cell.cleanupFailed, true, JSON.stringify(cell.cleanupErrors));
    assert.equal(cell.status, 'blocked', JSON.stringify({ status: cell.status, failure: cell.failure }));
    assert.equal(cell.blocker, 'cli-exited-before-ready', JSON.stringify({ blocker: cell.blocker, failure: cell.failure }));
    assert.ok(cell.evidence.some(e => e.event === 'cli-exit'), 'the exit itself is witnessed');
    const keys = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8') : '';
    assert.equal((keys.match(/\\r/g) ?? []).length, 1, 'the normal startup press happened exactly once');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
