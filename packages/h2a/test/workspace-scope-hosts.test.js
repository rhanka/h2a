import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve('packages/h2a');
function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'scope-hosts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, HOME: dir, XDG_RUNTIME_DIR: dir, XDG_CONFIG_HOME: dir, XDG_STATE_HOME: dir,
    CODEX_HOME: join(dir, '.codex'), CLAUDE_CONFIG_DIR: join(dir, '.claude'), VIBE_HOME: join(dir, '.vibe') };
  const script = `import {runCli} from ${JSON.stringify(join(root, 'dist/index.js'))};
    const rc=await runCli(JSON.parse(process.env.SCOPE_ARGS),{cwd:()=>process.cwd(),stdout:process.stdout,stderr:process.stderr});process.exitCode=rc;`;
  const cli = args => spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { cwd: dir, env: { ...env, SCOPE_ARGS: JSON.stringify(args) }, encoding: 'utf8' });
  return { dir, env, cli };
}
test('packaged Claude and Codex plugins expose session binding and all-tool scope hooks', () => {
  const hooks = JSON.parse(fs.readFileSync(join(root, 'hooks/hooks.json'), 'utf8')).hooks;
  assert.ok(hooks.SessionStart.some(e => JSON.stringify(e).includes('workspace-scope-guard')));
  const scope = hooks.PreToolUse.find(e => JSON.stringify(e).includes('workspace-scope-guard'));
  assert.equal(scope.matcher, '.*');
  assert.equal(JSON.parse(fs.readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8')).hooks, './hooks/hooks.json');
});
test('host plugin writes an idempotent scope hook, pins workspace/session and preserves other hooks', t => {
  const f = fixture(t), path = join(f.dir, 'settings.json');
  fs.writeFileSync(path, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo retained' }] }] } }));
  for (const host of ['claude', 'codex', 'gemini']) {
    const args = ['host', 'plugin', '--host', host, '--instance', 'test-instance', '--write', path,
      '--workspace', f.dir, '--owner-key', join(f.dir, 'owner.pub')];
    for (let i = 0; i < 2; i++) { const r = f.cli(args); assert.equal(r.status, 0, r.stderr); }
    const hooks = JSON.parse(fs.readFileSync(path, 'utf8')).hooks.PreToolUse;
    assert.equal(hooks.length, 2);
    const scope = hooks.find(e => JSON.stringify(e).includes('workspace-scope-guard'));
    assert.equal(scope.matcher, '.*');
    assert.match(scope.hooks[0].command, /--workspace/); assert.ok(scope.hooks[0].command.includes(f.dir));
    assert.match(scope.hooks[0].command, /--session' 'test-instance'/);
    assert.match(scope.hooks[0].command, /--owner-key/);
    const invoke = spawnSync('sh', ['-c', scope.hooks[0].command], { cwd: f.dir, env: f.env,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh pr close -R foreign/repo 3' } }), encoding: 'utf8' });
    assert.equal(invoke.status, 2, invoke.stderr); assert.equal(JSON.parse(invoke.stdout).code, 'FOREIGN_WORKSPACE');
  }
});
test('codex scaffold includes a runnable workspace scope guard', t => {
  const f = fixture(t), target = join(f.dir, 'marketplace');
  const r = f.cli(['host', 'plugin', '--host', 'codex', '--instance', 'test', '--scaffold', target]);
  assert.equal(r.status, 0, r.stderr);
  const hooks = JSON.parse(fs.readFileSync(join(target, 'plugins/h2a-drumbeat/hooks/hooks.json'), 'utf8')).hooks;
  assert.ok(hooks.PreToolUse.some(e => JSON.stringify(e).includes('workspace-scope-guard')));
});
test('vibe installation ships an independent strict scope hook without MCP guard qualification', t => {
  const f = fixture(t), vibe = join(f.dir, '.vibe'); fs.mkdirSync(vibe);
  const r = f.cli(['install-skills', '--host', 'vibe']);
  assert.equal(r.status, 0, r.stderr);
  const hooks = fs.readFileSync(join(vibe, 'hooks.toml'), 'utf8');
  assert.match(hooks, /sentropic-h2a-workspace-scope/); assert.match(hooks, /strict = true/);
  for (const name of ['workspace-scope-guard.mjs', 'workspace-scope-shell.mjs', 'workspace-scope-state.mjs'])
    assert.ok(fs.existsSync(join(vibe, '.h2a-install/hooks', name)), name);
  const before = hooks;
  const again = f.cli(['install-skills', '--host', 'vibe']); assert.equal(again.status, 0, again.stderr);
  assert.equal(fs.readFileSync(join(vibe, 'hooks.toml'), 'utf8'), before);
  const guard = join(vibe, '.h2a-install/hooks/workspace-scope-guard.mjs');
  const denied = spawnSync(process.execPath, [guard, '--host', 'vibe', '--workspace', f.dir], { cwd: f.dir, env: f.env,
    input: JSON.stringify({ tool_name: 'bash', tool_input: { command: 'gh pr close -R foreign/repo 3' } }), encoding: 'utf8' });
  assert.equal(denied.status, 0); assert.equal(JSON.parse(denied.stdout).decision, 'deny');
});
test('agy and muse explicitly report the lack of verified pre-action enforcement', t => {
  const f = fixture(t);
  for (const host of ['agy', 'muse']) {
    const r = f.cli(['host', 'plugin', '--host', host, '--instance', 'test']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).workspaceScope.supported, false);
    assert.match(JSON.parse(r.stdout).workspaceScope.reason, /PreToolUse/);
  }
});

test('vibe refuses to claim protection when a project hook masks the scope guard', t => {
  const f = fixture(t); f.env.VIBE_HOME = join(f.dir, 'profile');
  fs.mkdirSync(join(f.dir, '.vibe'));
  fs.writeFileSync(join(f.dir, '.vibe/hooks.toml'), '[[hooks]]\nname="sentropic-h2a-workspace-scope"\ntype="pre_tool"\ncommand="true"\n');
  const r = f.cli(['install-skills', '--host', 'vibe']);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /scope.*mask|mask.*scope/i);
});
