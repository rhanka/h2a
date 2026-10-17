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
test('R1 should support the verified Muse project PreToolUse surface', t => {
  const f = fixture(t);
  for (const host of ['muse']) {
    const r = f.cli(['host', 'plugin', '--host', host, '--instance', 'test']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).workspaceScope.supported, true);
    assert.match(JSON.parse(r.stdout).workspaceScope.command, /--host' 'muse/);
  }
});

test('vibe refuses to claim protection when a project hook masks the scope guard', t => {
  const f = fixture(t); f.env.VIBE_HOME = join(f.dir, 'profile');
  fs.mkdirSync(join(f.dir, '.vibe'));
  fs.writeFileSync(join(f.dir, '.vibe/hooks.toml'), '[[hooks]]\nname="sentropic-h2a-workspace-scope"\ntype="pre_tool"\ncommand="true"\n');
  const r = f.cli(['install-skills', '--host', 'vibe']);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /scope.*mask|mask.*scope/i);
});

test('R1 should install and execute the agy all-tool hook with native payloads', t => {
  const f = fixture(t), path = join(f.dir, 'hooks.json');
  const r = f.cli(['host','plugin','--host','agy','--instance','agy-session','--write',path,'--workspace',f.dir]);
  assert.equal(r.status,0,r.stderr);
  const config = JSON.parse(fs.readFileSync(path,'utf8'));
  const hooks = config['sentropic-h2a-workspace-scope'];
  assert.equal(hooks?.enabled,true);
  const entry = hooks.PreToolUse.find(e => JSON.stringify(e).includes('workspace-scope-guard'));
  assert.ok(entry); assert.equal(entry.matcher,'.*');
  for (const args of [{CommandLine:'gh pr close -R foreign/repo 3'}, {command:'git push',cwd:join(f.dir,'foreign')}]) {
    const r = spawnSync('sh',['-c',entry.hooks[0].command],{cwd:f.dir,env:f.env,encoding:'utf8',
      input:JSON.stringify({conversationId:'agy-session',workspacePaths:[f.dir],toolCall:{name:'run_command',args}})});
    assert.equal(r.status,0,r.stderr); assert.equal(JSON.parse(r.stdout).decision,'deny');
  }
  const own = spawnSync('sh',['-c',entry.hooks[0].command],{cwd:f.dir,env:f.env,encoding:'utf8',
    input:JSON.stringify({conversationId:'agy-session',toolCall:{name:'write_to_file',args:{TargetFile:join(f.dir,'readme.txt'),CodeContent:'x'}}})});
  assert.equal(own.status,0,own.stderr); assert.equal(JSON.parse(own.stdout).decision,'allow');
});
test('R5 should refresh explicit Vibe session/key selections without pinning a global cwd', t => {
  const f = fixture(t), vibe = f.env.VIBE_HOME; fs.mkdirSync(vibe);
  assert.equal(f.cli(['install-skills','--host','vibe']).status,0);
  const key=join(f.dir,'owner.pub');
  const r=f.cli(['host','plugin','--host','vibe','--instance','selected-session','--owner-key',key,'--write',join(vibe,'hooks.toml')]);
  assert.equal(r.status,0,r.stderr);
  const source=fs.readFileSync(join(vibe,'hooks.toml'),'utf8');
  assert.ok(source.includes('selected-session')); assert.ok(source.includes(key));
  const scopeLine=source.split('\n').find(l=>l.includes('command')&&l.includes('workspace-scope-guard'));
  assert.ok(!scopeLine.includes('--workspace'),scopeLine);
  const guard=join(vibe,'.h2a-install/hooks/workspace-scope-guard.mjs');
  for (const dir of [f.dir,join(f.dir,'second')]) {
    fs.mkdirSync(dir,{recursive:true});
    const run=flags=>spawnSync(process.execPath,[guard,'--host','vibe',...flags],{cwd:dir,env:f.env,encoding:'utf8',
      input:JSON.stringify({session_id:'session-'+dir,tool_name:'bash',tool_input:{command:'git status'}})});
    assert.equal(run(['--initialize-session','true']).status,0);
    const check=run([]); assert.equal(JSON.parse(check.stdout).decision,'allow',check.stderr);
  }
});

test('R1 should converge agy startup binding and pre-action hooks on a temporary profile', t => {
  const f=fixture(t); fs.mkdirSync(join(f.dir,'.gemini'));
  fs.mkdirSync(join(f.dir,'.gemini/config'));
  fs.writeFileSync(join(f.dir,'.gemini/config/hooks.json'), JSON.stringify({ personal: { PreInvocation: [{ command: 'echo retained' }] } }));
  const r=f.cli(['install-skills','--host','agy']); assert.equal(r.status,0,r.stderr);
  const path=join(f.dir,'.gemini/config/hooks.json'); assert.ok(fs.existsSync(path),'missing native agy hooks');
  const config=JSON.parse(fs.readFileSync(path,'utf8'));
  assert.equal(config.personal.PreInvocation[0].command, 'echo retained');
  const hooks=config['sentropic-h2a-workspace-scope'];
  assert.ok(hooks.SessionStart.some(e=>e.type==='command'&&e.command.includes('workspace-scope')));
  assert.ok(hooks.SessionStart.every(e=>!e.hooks),'agy startup handlers are flat');
  assert.ok(hooks.PreToolUse.some(e=>JSON.stringify(e).includes('workspace-scope')));
});

test('R1 should install Muse project hooks and execute the native denial protocol', t => {
  const f=fixture(t); const r=f.cli(['install-skills','--host','muse']); assert.equal(r.status,0,r.stderr);
  const path=join(f.dir,'.muse/hooks.json'); assert.ok(fs.existsSync(path),'missing Muse project hooks');
  const hooks=JSON.parse(fs.readFileSync(path,'utf8')).hooks;
  const run=(event,input)=>spawnSync('sh',['-c',hooks[event].find(e=>JSON.stringify(e).includes('workspace-scope')).hooks[0].command],{
    cwd:f.dir,env:f.env,encoding:'utf8',input:JSON.stringify({session_id:'native-muse',hook_event_name:event,...input})});
  assert.equal(run('SessionStart',{}).status,0);
  const own=run('PreToolUse',{tool_name:'exec_command',tool_input:{cmd:'git status'}}); assert.equal(own.status,0,own.stderr);
  const foreign=run('PreToolUse',{tool_name:'exec_command',tool_input:{cmd:'gh pr close -R foreign/repo 3'}});
  const denial=JSON.parse(foreign.stdout);assert.equal(denial.hookSpecificOutput.permissionDecision,'deny');
  assert.ok(!('decision' in denial),'Muse rejects legacy PreToolUse decision');
});

for(const host of ['agy','muse']) test('R5 should retain the explicit owner key across ' + host + ' convergence', t => {
  const f=fixture(t), key=join(f.dir,'owner.pub');
  const first=f.cli(['install-skills','--host',host,'--owner-key',key]);assert.equal(first.status,0,first.stderr);
  const next=f.cli(['install-skills','--host',host]);assert.equal(next.status,0,next.stderr);
  const path=host==='muse'?join(f.dir,'.muse/hooks.json'):join(f.dir,'.gemini/config/hooks.json');
  assert.ok(fs.readFileSync(path,'utf8').includes(key),'owner key selection was lost');
});
