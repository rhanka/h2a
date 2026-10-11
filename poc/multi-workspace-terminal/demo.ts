import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { renderTerminalScreen } from '../../packages/h2a-runtime/src/native-terminal/screen.ts';
import { control, runClient, WorkspaceTerminal } from './client.ts';
import { connectHost, isolatedEnv, poc, repo, startSandbox, waitUntil, type Sandbox } from './sandbox.ts';

const execute = promisify(execFile);
const uiId = '__poc_observer_ui'; // Never placed in the POC workspace metadata.
async function seed(sandbox: Sandbox) {
  const alpha = join(sandbox.root, 'workspaces', 'repo-alpha'), beta = join(sandbox.root, 'workspaces', 'repo-beta');
  await mkdir(alpha, { recursive: true }); await mkdir(beta, { recursive: true });
  const model = new WorkspaceTerminal(sandbox, await connectHost(sandbox));
  try {
    const counter = await model.open({ workspace: alpha, name: 'counter', command: [process.execPath, join(poc, 'stub.mjs'), 'counter'] });
    const question = await model.open({ workspace: alpha, name: 'question', command: [process.execPath, join(poc, 'stub.mjs'), 'question'] });
    const idle = await model.open({ workspace: beta, name: 'idle', command: [process.execPath, join(poc, 'stub.mjs'), 'idle'] });
    return { alpha, beta, counter, question, idle };
  } finally { await model.close(); }
}
async function op(sandbox: Sandbox, operation: string, id: string): Promise<any> {
  const { stdout } = await execute(process.execPath, ['--import', 'tsx', join(repo, 'packages/h2a-runtime/src/native-terminal/op.ts'),
    operation, '--socket', sandbox.socket, '--id', id], { cwd: repo, env: isolatedEnv(sandbox.root), maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}
async function cliRun(sandbox: Sandbox, workspace: string, name: string, mode: string): Promise<any> {
  const { stdout } = await execute(process.execPath, ['--import', 'tsx', join(poc, 'cli.ts'), 'run', '--sandbox', join(sandbox.root, 'sandbox.json'),
    '--workspace', workspace, '--name', name, '--', process.execPath, join(poc, 'stub.mjs'), mode],
    { cwd: repo, env: isolatedEnv(sandbox.root) });
  return JSON.parse(stdout);
}

export async function recordDemo(artifacts: string) {
  await mkdir(artifacts, { recursive: true });
  const isolated = await startSandbox();
  const sandbox = isolated.sandbox;
  const host = await connectHost(sandbox);
  const sections: string[] = ['# Isolated multi-workspace terminal demo',
    'Native worktree host; 160×48 client PTY. All screenshots below come from the native capture operation, with an explicit temporary socket.'];
  let success = false;
  try {
    const sessions = await seed(sandbox);
    const ui = await host.create({ id: uiId, command: process.execPath, args: ['--import', 'tsx', join(poc, 'cli.ts'), 'client',
      '--sandbox', join(sandbox.root, 'sandbox.json')], cwd: repo, env: isolatedEnv(sandbox.root), cols: 160, rows: 48 });
    const lease = await host.acquireController(uiId, 'poc-demo-driver');
    const snapshot = () => control(sandbox, { op: 'snapshot' });
    await waitUntil(async () => {
      try { return await snapshot(); }
      catch (error) {
        if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          if ((await host.state(uiId)).status === 'exited') {
            const replay = await host.readOutput(uiId, 0);
            throw new Error(`client exited before readiness: ${replay.chunks.map(chunk => chunk.data).join('')}`);
          }
          return undefined;
        }
        throw error;
      }
    });
    const uiText = async () => {
      const replay = await host.readOutput(uiId, 0);
      assert.equal(replay.gap, null, 'demo UI replay must remain complete');
      return renderTerminalScreen(replay.chunks.map(chunk => chunk.data).join(''), 160, 48);
    };
    const expectUI = (text: string) => waitUntil(async () => (await uiText()).includes(text) ? true : undefined);
    const capture = async (label: string, expected: string) => {
      await expectUI(expected);
      const result = await op(sandbox, 'capture', uiId);
      assert.ok(result.text.includes(expected), `${label}: ${expected}`);
      // Keep visible content; remove only blank terminal padding for versioning.
      const captured = result.text.split('\n').map((line: string) => line.trimEnd()).join('\n').trimEnd() + '\n';
      await writeFile(join(artifacts, `${label}.txt`), captured);
      const lines = captured.trimEnd().split('\n');
      sections.push(`## ${label}\n\n\`\`\`text\n${lines.filter((line: string, index: number) => index < 2 || line.trim()).slice(0, 9).join('\n')}\n\`\`\``);
    };
    await waitUntil(async () => (await snapshot()).sessions.find((s: any) => s.name === 'idle')?.status === 'idle' ? true : undefined);
    await capture('01-counter-and-aggregated-question', 'counter =');
    const first = await snapshot();
    assert.ok(first.headers[0].includes('repo-alpha[waiting-for-input-question]'));
    assert.ok(first.headers[0].includes('repo-beta[idle]'));
    assert.equal(first.sessions.length, 3);

    await host.write(lease, '\x0e'); // Ctrl-N: counter → question.
    await capture('02-switch-session-question', '*question[waiting-for-input-question]');
    await host.write(lease, 'y\r');
    await capture('03-forward-answer', 'answer accepted: y');
    assert.notEqual((await snapshot()).sessions.find((s: any) => s.name === 'question').status, 'waiting-for-input-question');

    await host.write(lease, '\x17'); // Ctrl-W: repo-alpha → repo-beta.
    await capture('04-switch-workspace-idle', 'Idle session ready');
    await host.write(lease, '\x17'); // Back to remembered question session.
    await capture('05-remember-workspace-selection', '*question[');
    await host.write(lease, '\x10'); // Ctrl-P back to counter with retained VT state.
    await capture('06-restore-counter-screen', '*counter[running]');

    const existing = await cliRun(sandbox, sessions.alpha, 'counter', 'counter');
    assert.equal(existing.created, false); assert.equal(existing.pid, sessions.counter.pid);
    assert.equal((await host.state(uiId)).pid, ui.pid, 'open-or-focus must reuse the same client PTY');
    await capture('07-run-focuses-existing-same-pty', '*counter[running]');
    assert.equal((await host.list()).length, 4, '3 sessions plus the same observer UI, no duplicate');

    const created = await cliRun(sandbox, sessions.beta, 'new-idle', 'idle');
    assert.equal(created.created, true);
    await capture('08-run-creates-and-focuses', '*new-idle[');
    const concurrent = await Promise.all([cliRun(sandbox, sessions.beta, 'raced-idle', 'idle'), cliRun(sandbox, sessions.beta, 'raced-idle', 'idle')]);
    assert.equal(concurrent.filter(result => result.created).length, 1);
    assert.equal(concurrent[0].pid, concurrent[1].pid);

    const exited = await cliRun(sandbox, sessions.beta, 'short', 'exit');
    await waitUntil(async () => (await snapshot()).sessions.find((s: any) => s.name === 'short')?.status === 'exited' ? true : undefined);
    await capture('09-exited-badge', '*short[exited]');
    const probe = await op(sandbox, 'probe', exited.id);
    assert.equal(probe.verdict, 'dead');
    const restarted = await cliRun(sandbox, sessions.beta, 'short', 'idle');
    assert.equal(restarted.created, true); assert.notEqual(restarted.incarnation, exited.incarnation);
    await capture('10-reopen-exited-session', 'Idle session ready');

    sections.push(`## Open-or-focus receipts\n\n\`\`\`json\n${JSON.stringify({ clientPtyPid: ui.pid, counterPid: sessions.counter.pid,
      existing, created, concurrent, exited, probe: probe.verdict, restarted }, null, 2)}\n\`\`\``);
    await writeFile(join(artifacts, 'demo-transcript.md'), sections.join('\n\n') + '\n');
    // Ctrl-\\ detaches the UI; native sessions remain until demo teardown.
    await host.write(lease, '\x1c');
    await waitUntil(async () => (await host.state(uiId)).status === 'exited' ? true : undefined);
    const list = await host.list();
    assert.ok(list.some(s => s.id === sessions.counter.id && s.status === 'running'));
    await assert.rejects(lstat(sandbox.focusSocket), { code: 'ENOENT' });
    await assert.rejects(lstat(join(sandbox.root, 'ui-lock')), { code: 'ENOENT' });
    // With no existing UI, run starts a client on this same observer terminal.
    await host.create({ id: uiId, command: process.execPath, args: ['--import', 'tsx', join(poc, 'cli.ts'), 'run',
      '--sandbox', join(sandbox.root, 'sandbox.json'), '--workspace', sessions.alpha, '--name', 'counter', '--',
      process.execPath, join(poc, 'stub.mjs'), 'counter'], cwd: repo, env: isolatedEnv(sandbox.root), cols: 160, rows: 48 });
    await waitUntil(async () => {
      try { const current = await snapshot(); return current.focused === sessions.counter.id ? current : undefined; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    });
    assert.equal((await host.state(sessions.counter.id)).pid, sessions.counter.pid);
    await capture('11-run-starts-client-when-detached', '*counter[running]');
    await writeFile(join(artifacts, 'demo-transcript.md'), sections.join('\n\n') + '\n');
    const secondLease = await host.acquireController(uiId, 'poc-demo-driver-relaunch');
    await host.write(secondLease, '\x1c');
    await waitUntil(async () => (await host.state(uiId)).status === 'exited' ? true : undefined);
    success = true;
    return { counterPid: sessions.counter.pid, existing, created, concurrent, exited, restarted };
  } finally {
    if (!success) {
      await writeFile(join(artifacts, 'partial-transcript.md'), sections.join('\n\n') + '\n');
      const replay = await host.readOutput(uiId, 0).catch(() => undefined);
      await writeFile(join(artifacts, 'failed-ui-output.txt'), replay?.chunks.map(chunk => chunk.data).join('') ?? 'UI not created');
    }
    host.close(); await isolated.close();
  }
}

async function main() {
  if (process.argv[2] === '--record') {
    const artifacts = resolve(process.argv[3] ?? join(poc, 'artifacts'));
    const proof = await recordDemo(artifacts);
    process.stdout.write(`PASS isolated demo: 11 native UI captures; 3 initial sessions / 2 workspaces; switching, input, same PID reuse, create, concurrent reuse, exited restart, detach and cold UI run.\n${join(artifacts, 'demo-transcript.md')}\n${JSON.stringify(proof)}\n`);
    return;
  }
  const isolated = await startSandbox();
  try {
    const sessions = await seed(isolated.sandbox);
    process.stdout.write(`Isolated demo: ${join(isolated.sandbox.root, 'sandbox.json')}\nCtrl-W workspace | Ctrl-N/P session | Ctrl-\\ detach and stop demo\n`);
    process.stdout.write(`From another terminal (same worktree):\nrtk node --import tsx ${join(poc, 'cli.ts')} run --sandbox ${join(isolated.sandbox.root, 'sandbox.json')} --workspace ${sessions.alpha} --name counter -- ${process.execPath} ${join(poc, 'stub.mjs')} counter\n`);
    await runClient(isolated.sandbox);
  } finally { await isolated.close(); }
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : error}\n`); process.exitCode = 1; });
}
