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
  const bin = join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const [name, executable] of [['node', process.execPath], ['git', '/usr/bin/git'], ['sh', '/bin/sh']])
    fs.symlinkSync(executable, join(bin, name));
  fs.writeFileSync(join(bin, 'agy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: bin, HOME: dir, XDG_RUNTIME_DIR: dir, XDG_CONFIG_HOME: dir, XDG_STATE_HOME: dir,
    CODEX_HOME: join(dir, '.codex'), CLAUDE_CONFIG_DIR: join(dir, '.claude'), VIBE_HOME: join(dir, '.vibe') };
  for (const name of ['CLAUDE_PROJECT_DIR', 'CODEX_WORKSPACE_ROOT', 'H2A_SCOPE_SESSION', 'H2A_SCOPE_OWNER_KEY']) delete env[name];
  const script = `import {runCli} from ${JSON.stringify(join(root, 'dist/index.js'))};
    const rc=await runCli(JSON.parse(process.env.SCOPE_ARGS),{cwd:()=>process.cwd(),stdout:process.stdout,stderr:process.stderr});process.exitCode=rc;`;
  const cli = args => spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { cwd: dir, env: { ...env, SCOPE_ARGS: JSON.stringify(args) }, encoding: 'utf8' });
  const converge = host => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {convergeNativeHost} from ${JSON.stringify(join(root, 'dist/hosts/native-convergence.js'))};
     console.log(JSON.stringify(convergeNativeHost({host:${JSON.stringify(host)},version:'test',skills:[],renderGemini:()=>'',repair:true})));`],
    { cwd: dir, env, encoding: 'utf8' });
  return { dir, env, cli, converge };
}
test('packaged Claude and Codex plugins expose session binding and all-tool scope hooks', () => {
  const hooks = JSON.parse(fs.readFileSync(join(root, 'hooks/workspace-scope.opt-in.json'), 'utf8')).hooks;
  assert.ok(hooks.SessionStart.some(e => JSON.stringify(e).includes('workspace-scope-guard')));
  const scope = hooks.PreToolUse.find(e => JSON.stringify(e).includes('workspace-scope-guard'));
  assert.equal(scope.matcher, '.*');
  assert.equal(JSON.parse(fs.readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8')).hooks, './hooks/hooks.json');
});

for (const host of ['claude', 'codex', 'gemini', 'agy', 'muse', 'vibe']) {
  test('opt-in default: host plugin omits scope hooks for ' + host, t => {
    const f = fixture(t);
    const rendered = f.cli(['host', 'plugin', '--host', host, '--instance', 'test']);
    assert.equal(rendered.status, 0, rendered.stderr);
    const report = JSON.parse(rendered.stdout);
    assert.equal(report.workspaceScope.supported, false);
    assert.equal(report.workspaceScope.command, undefined);
    assert.doesNotMatch(report.rendered ?? report.record ?? '', /workspace-scope-guard/);
    const path = host === 'vibe' ? join(f.dir, '.vibe/hooks.toml') : join(f.dir, 'hooks.json');
    const written = f.cli(['host', 'plugin', '--host', host, '--instance', 'test', '--write', path]);
    assert.equal(written.status, 0, written.stderr);
    assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /workspace-scope-guard/);
  });
}

test('opt-in default: Codex scaffold omits scope hooks', t => {
  const f = fixture(t), target = join(f.dir, 'marketplace');
  const r = f.cli(['host', 'plugin', '--host', 'codex', '--instance', 'test', '--scaffold', target]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(fs.readFileSync(join(target, 'plugins/h2a-drumbeat/hooks/hooks.json'), 'utf8'), /workspace-scope-guard/);
});

for (const host of ['vibe', 'agy', 'gemini', 'muse']) {
  test('opt-in default: installation and convergence omit scope hooks for ' + host, t => {
    const f = fixture(t);
    const installed = f.cli(['install-skills', '--host', host]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(JSON.parse(installed.stdout).workspaceScope.supported, false);
    const path = host === 'vibe' ? join(f.dir, '.vibe/hooks.toml') : host === 'muse'
      ? join(f.dir, '.muse/hooks.json') : join(f.dir, '.gemini/config/hooks.json');
    if (fs.existsSync(path)) assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /workspace-scope-guard/);
    const repeated = f.cli(['install-skills', '--host', host]);
    assert.equal(repeated.status, 0, repeated.stderr);
    if (fs.existsSync(path)) assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /workspace-scope-guard/);
    const repaired = f.converge(host);
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.equal(JSON.parse(repaired.stdout).workspaceScope.supported, false);
    if (fs.existsSync(path)) assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /workspace-scope-guard/);
  });

  test('opt-in selection: native ' + host + ' retains explicit on and off through convergence', t => {
    const f = fixture(t);
    const path = host === 'vibe' ? join(f.dir, '.vibe/hooks.toml') : host === 'muse'
      ? join(f.dir, '.muse/hooks.json') : join(f.dir, '.gemini/config/hooks.json');
    for (const [mode, enabled] of [['on', true], [undefined, true], ['off', false], [undefined, false]]) {
      const args = ['install-skills', '--host', host];
      if (mode) args.push('--workspace-scope', mode);
      const r = f.cli(args);
      assert.equal(r.status, 0, r.stderr);
      const source = fs.readFileSync(path, 'utf8');
      assert.equal(JSON.parse(r.stdout).workspaceScope.supported, enabled);
      if (enabled) assert.match(source, /workspace-scope-guard/);
      else assert.doesNotMatch(source, /workspace-scope-guard/);
    }
  });

  test('opt-in migration: legacy ' + host + ' bindings do not authorize activation', t => {
    const f = fixture(t);
    const path = host === 'vibe' ? join(f.dir, '.vibe/hooks.toml') : host === 'muse'
      ? join(f.dir, '.muse/hooks.json') : join(f.dir, '.gemini/config/hooks.json');
    const profile = host === 'vibe' ? join(f.dir, '.vibe') : host === 'muse'
      ? join(f.dir, '.config/muse') : join(f.dir, '.gemini');
    const state = join(profile, ['agy', 'gemini'].includes(host) ? '.h2a-install-agy' : '.h2a-install');
    const manifestPath = join(state, ['agy', 'gemini'].includes(host) ? 'shared-owner.json' : 'manifest.json');
    const on = f.cli(['install-skills', '--host', host, '--workspace-scope', 'on']);
    assert.equal(on.status, 0, on.stderr);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.workspaceScope.enabled;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const migrated = host === 'muse' ? f.cli(['install-skills', '--host', host]) : f.converge(host);
    assert.equal(migrated.status, 0, migrated.stderr);
    const report = JSON.parse(migrated.stdout);
    assert.equal(report.workspaceScope.supported, false);
    assert.equal(report.installation, 'coherent');
    assert.ok(report.changed.includes(path), 'migration must rewrite the installed hooks');
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).workspaceScope.enabled, false);
    assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /workspace-scope-guard/);
  });
}

function mixedScopeHooks() {
  const guard = { type: 'command', command: 'node /fixture/workspace-scope-guard.mjs --initialize-session true' };
  const personal = { type: 'command', command: 'echo startup-retained', timeout: 7 };
  const manual = { type: 'command', command: 'node /fixture/deny-manual-h2a-cli.mjs' };
  const group = { matcher: '.*', timeout: 19, hooks: [guard, personal, manual, guard] };
  // A mention in metadata is not a guard command; preserve this group intact.
  const unrelated = { matcher: 'workspace-scope-guard.mjs', hooks: [personal] };
  return {
    original: { SessionStart: [group, { hooks: [guard] }, unrelated], PreToolUse: [group, { hooks: [guard] }, unrelated] },
    retained: { SessionStart: [{ ...group, hooks: [personal, manual] }, unrelated], PreToolUse: [{ ...group, hooks: [personal, manual] }, unrelated] }
  };
}

for (const host of ['claude', 'codex', 'gemini', 'agy', 'muse']) {
  test('opt-in removal preserves personal commands in mixed scope groups for ' + host, t => {
    const f = fixture(t), path = join(f.dir, 'mixed-hooks.json');
    const { original, retained } = mixedScopeHooks();
    for (const mode of ['off', undefined]) {
      fs.writeFileSync(path, JSON.stringify({ hooks: original }));
      const args = ['host', 'plugin', '--host', host, '--instance', 'test', '--write', path];
      if (mode) args.push('--workspace-scope', mode);
      for (let i = 0; i < 2; i++) {
        const result = f.cli(args);
        assert.equal(result.status, 0, result.stderr);
        const hooks = JSON.parse(fs.readFileSync(path, 'utf8')).hooks;
        for (const event of ['SessionStart', 'PreToolUse']) assert.deepEqual(hooks[event], retained[event]);
      }
    }
  });
}

test('opt-in removal preserves personal commands in mixed Muse installation groups', t => {
  const { original, retained } = mixedScopeHooks();
  for (const mode of ['off', undefined]) {
    const f = fixture(t), path = join(f.dir, '.muse/hooks.json');
    fs.mkdirSync(join(f.dir, '.muse'));
    fs.writeFileSync(path, JSON.stringify({ hooks: original }));
    const args = ['install-skills', '--host', 'muse'];
    if (mode) args.push('--workspace-scope', mode);
    for (let i = 0; i < 2; i++) {
      const result = f.cli(args);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(JSON.parse(fs.readFileSync(path, 'utf8')).hooks, retained);
    }
  }
});

for (const host of ['claude', 'codex', 'gemini', 'agy', 'muse']) {
  test('opt-in selection: host plugin can remove scope hooks and retain other hooks for ' + host, t => {
    const f = fixture(t), path = join(f.dir, 'hooks.json');
    const personal = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo retained' }] };
    fs.writeFileSync(path, JSON.stringify({ hooks: { PreToolUse: [personal] } }));
    const args = ['host', 'plugin', '--host', host, '--instance', 'test', '--write', path];
    const on = f.cli([...args, '--workspace-scope', 'on']);
    assert.equal(on.status, 0, on.stderr);
    assert.match(fs.readFileSync(path, 'utf8'), /workspace-scope-guard/);
    const off = f.cli([...args, '--workspace-scope', 'off']);
    assert.equal(off.status, 0, off.stderr);
    const source = fs.readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /workspace-scope-guard/);
    assert.deepEqual(JSON.parse(source).hooks.PreToolUse, [personal]);
    const again = f.cli(args);
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /workspace-scope-guard/);
  });
}

test('host plugin writes an idempotent scope hook, pins workspace/session and preserves other hooks', t => {
  const f = fixture(t), path = join(f.dir, 'settings.json');
  fs.writeFileSync(path, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo retained' }] }] } }));
  for (const host of ['claude', 'codex', 'gemini']) {
    const args = ['host', 'plugin', '--host', host, '--instance', 'test-instance', '--write', path,
      '--workspace', f.dir, '--owner-key', join(f.dir, 'owner.pub'), '--workspace-scope', 'on'];
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
  const r = f.cli(['host', 'plugin', '--host', 'codex', '--instance', 'test', '--scaffold', target, '--workspace-scope', 'on']);
  assert.equal(r.status, 0, r.stderr);
  const hooks = JSON.parse(fs.readFileSync(join(target, 'plugins/h2a-drumbeat/hooks/hooks.json'), 'utf8')).hooks;
  assert.ok(hooks.PreToolUse.some(e => JSON.stringify(e).includes('workspace-scope-guard')));
});
test('vibe installation ships an independent strict scope hook without MCP guard qualification', t => {
  const f = fixture(t), vibe = join(f.dir, '.vibe'); fs.mkdirSync(vibe);
  const r = f.cli(['install-skills', '--host', 'vibe', '--workspace-scope', 'on']);
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
    const r = f.cli(['host', 'plugin', '--host', host, '--instance', 'test', '--workspace-scope', 'on']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).workspaceScope.supported, true);
    assert.match(JSON.parse(r.stdout).workspaceScope.command, /--host' 'muse/);
  }
});

test('vibe refuses to claim protection when a project hook masks the scope guard', t => {
  const f = fixture(t); f.env.VIBE_HOME = join(f.dir, 'profile');
  fs.mkdirSync(join(f.dir, '.vibe'));
  fs.writeFileSync(join(f.dir, '.vibe/hooks.toml'), '[[hooks]]\nname="sentropic-h2a-workspace-scope"\ntype="pre_tool"\ncommand="true"\n');
  const off = f.cli(['install-skills', '--host', 'vibe']);
  assert.equal(off.status, 0, off.stderr);
  const r = f.cli(['install-skills', '--host', 'vibe', '--workspace-scope', 'on']);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /scope.*mask|mask.*scope/i);
});

test('R1 should install and execute the agy all-tool hook with native payloads', t => {
  const f = fixture(t), path = join(f.dir, 'hooks.json');
  const r = f.cli(['host','plugin','--host','agy','--instance','agy-session','--write',path,'--workspace',f.dir,'--workspace-scope','on']);
  assert.equal(r.status,0,r.stderr);
  const config = JSON.parse(fs.readFileSync(path,'utf8'));
  const hooks = config['sentropic-h2a-workspace-scope'];
  assert.equal(hooks?.enabled,true);
  const entry = hooks.PreToolUse.find(e => JSON.stringify(e).includes('workspace-scope-guard'));
  assert.ok(entry); assert.equal(entry.matcher,'.*');
  const start=spawnSync('sh',['-c',hooks.SessionStart[0].command],{cwd:f.dir,env:f.env,encoding:'utf8',
    input:JSON.stringify({conversationId:'agy-session',workspacePaths:[f.dir]})});
  assert.equal(start.status,0,start.stderr);assert.deepEqual(JSON.parse(start.stdout),{});
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
  const r=f.cli(['host','plugin','--host','vibe','--instance','selected-session','--owner-key',key,'--write',join(vibe,'hooks.toml'),'--workspace-scope','on']);
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
  const r=f.cli(['install-skills','--host','agy','--workspace-scope','on']); assert.equal(r.status,0,r.stderr);
  const path=join(f.dir,'.gemini/config/hooks.json'); assert.ok(fs.existsSync(path),'missing native agy hooks');
  const config=JSON.parse(fs.readFileSync(path,'utf8'));
  assert.equal(config.personal.PreInvocation[0].command, 'echo retained');
  const hooks=config['sentropic-h2a-workspace-scope'];
  assert.ok(hooks.SessionStart.some(e=>e.type==='command'&&e.command.includes('workspace-scope')));
  assert.ok(hooks.SessionStart.every(e=>!e.hooks),'agy startup handlers are flat');
  assert.ok(hooks.PreToolUse.some(e=>JSON.stringify(e).includes('workspace-scope')));
});

test('R1 should install Muse project hooks and execute the native denial protocol', t => {
  const f=fixture(t); const r=f.cli(['install-skills','--host','muse','--workspace-scope','on']); assert.equal(r.status,0,r.stderr);
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
  const first=f.cli(['install-skills','--host',host,'--owner-key',key,'--workspace-scope','on']);assert.equal(first.status,0,first.stderr);
  const next=f.cli(['install-skills','--host',host]);assert.equal(next.status,0,next.stderr);
  const path=host==='muse'?join(f.dir,'.muse/hooks.json'):join(f.dir,'.gemini/config/hooks.json');
  assert.ok(fs.readFileSync(path,'utf8').includes(key),'owner key selection was lost');
});

for (const install of ['install-skills','host-plugin']) test('T3 R1 should bind agy from workspacePaths at global hook cwd: ' + install, t => {
  const f=fixture(t), configDir=join(f.dir,'.gemini/config'), path=join(configDir,'hooks.json');
  fs.mkdirSync(configDir,{recursive:true});
  const args=install==='install-skills'?['install-skills','--host','agy','--workspace-scope','on']:
    ['host','plugin','--host','agy','--instance','installer-only','--workspace',f.dir,'--write',path,'--workspace-scope','on'];
  const installed=f.cli(args); assert.equal(installed.status,0,installed.stderr);
  const hooks=JSON.parse(fs.readFileSync(path,'utf8'))['sentropic-h2a-workspace-scope'];
  assert.ok(hooks.SessionStart?.length,'missing agy SessionStart');
  const pre=hooks.PreToolUse[0].hooks[0].command;
  assert.ok(!pre.includes('--workspace')&&!pre.includes("'--session'"),pre);
  const run=(command,payload)=>spawnSync('sh',['-c',command],{cwd:configDir,env:f.env,encoding:'utf8',input:JSON.stringify(payload)});
  for (const name of ['one','two']) {
    const workspace=join(f.dir,name);fs.mkdirSync(workspace);
    const native={conversationId:name,workspacePaths:[workspace]};
    const start=run(hooks.SessionStart[0].command,native);assert.equal(start.status,0,start.stderr);assert.deepEqual(JSON.parse(start.stdout),{});
    const check=(tool,args)=>run(pre,{...native,toolCall:{name:tool,args}});
    assert.equal(JSON.parse(check('write_to_file',{TargetFile:join(workspace,'src.js'),CodeContent:'x'}).stdout).decision,'allow');
    assert.equal(JSON.parse(check('run_command',{Cwd:workspace,CommandLine:'echo own'}).stdout).decision,'allow');
    assert.equal(JSON.parse(check('run_command',{CommandLine:'touch src.js'}).stdout).decision,'allow','agy defaults to the bound workspace, not the hook config cwd');
    assert.equal(JSON.parse(check('write_to_file',{TargetFile:path,CodeContent:'{}'}).stdout).code,'OWNER_ONLY');
    const changed=run(pre,{...native,workspacePaths:[f.dir],toolCall:{name:'write_to_file',args:{TargetFile:join(f.dir,'foreign.js'),CodeContent:'x'}}});
    assert.equal(JSON.parse(changed.stdout).decision,'deny','payload cannot rebind an existing native session');
  }
  assert.equal(fs.existsSync(join(configDir,'.h2a/workspace-scope/sessions.jsonl')),false,'global cwd must not become workspace');
});
test('T3 R1 should not create Muse project hooks during user convergence', t => {
  const f=fixture(t), profile=join(f.dir,'.config/muse');fs.mkdirSync(profile,{recursive:true});
  const script=`import {convergeNativeHost} from ${JSON.stringify(join(root,'dist/hosts/native-convergence.js'))};
    convergeNativeHost({host:'muse',root:${JSON.stringify(profile)},version:'test',skills:[],renderGemini:()=>'',repair:true});`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:f.dir,env:f.env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.equal(fs.existsSync(join(f.dir,'.muse')),false);
});
