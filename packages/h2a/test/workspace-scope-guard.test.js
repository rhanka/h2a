import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const hook = resolve('packages/h2a/hooks/workspace-scope-guard.mjs');
const grantCommand = resolve('packages/h2a/hooks/workspace-scope-grant.mjs');
function fixture(t, { privatePackage = false } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const own = join(root, 'own'), foreign = join(root, 'foreign');
  const env = { ...process.env, PATH: root + ':' + process.env.PATH, HOME: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, XDG_RUNTIME_DIR: root,
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  fs.writeFileSync(join(root, 'gh'), `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2), root = ${JSON.stringify(root)};
if (args[0] === 'api') {
  if (args.some(a => a.includes('/pulls/'))) {
    const pulls = root + '/pr.pulls.json';
    if (fs.existsSync(pulls)) process.stdout.write(fs.readFileSync(pulls));
    else process.stdout.write(JSON.stringify({ base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } }));
  } else process.stdout.write(fs.readFileSync(root + (args.some(a=>a.includes('ref=aaaa')) ? '/pr.base.json' : '/pr.head.json')));
} else if (args[1] === 'view') {
  const fields = args[args.indexOf('--json') + 1] ?? '';
  if (fields.includes('baseRefOid') || fields.includes('headRefOid')) { console.error('Unknown JSON field: "baseRefOid"'); process.exit(1); }
  console.log(JSON.stringify({number:327}));
} else process.stdout.write(fs.readFileSync(root + '/pr.diff'));
`, { mode: 0o755 });
  for (const name of ['base', 'head']) fs.writeFileSync(join(root, `pr.${name}.json`), '{"name":"published-fixture","version":"1.0.0"}');
  fs.writeFileSync(join(root, 'pr.pulls.json'), JSON.stringify({ base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } }));
  fs.writeFileSync(join(root, 'pr.diff'), '');
  function git(dir, ...args) {
    const r = spawnSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  }
  for (const dir of [own, foreign]) {
    fs.mkdirSync(dir); git(dir, 'init', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.invalid'); git(dir, 'config', 'user.name', 'Test');
    fs.writeFileSync(join(dir, 'package.json'), JSON.stringify({name:'published-fixture',version:'1.0.0',...(privatePackage?{private:true}:{})})+'\n');
    git(dir, 'add', 'package.json'); git(dir, 'commit', '-qm', 'initial');
    git(dir, 'remote', 'add', 'origin', `https://github.com/fixture/${dir === own ? 'own' : 'foreign'}.git`);
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(dir, 'checkout', '-qb', 'feat/test');
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = join(root, 'owner.pub'); fs.writeFileSync(key, publicKey.export({ type: 'spki', format: 'pem' }));
  const state = join(own, '.h2a/workspace-scope');
  const invoke = (input, extra = []) => spawnSync(process.execPath,
    [hook, '--workspace', own, '--session', 'session-test', '--owner-key', key, ...extra],
    { input: JSON.stringify(typeof input === 'string' ? { tool_name: 'Bash', tool_input: { command: input } } : input),
      cwd: own, env, encoding: 'utf8' });
  function grant(overrides = {}, signingKey = privateKey) {
    const grant = { schema: 1, owner: 'owner:test', workspace: fs.realpathSync(own), session: 'session-test',
      repo: 'github.com/fixture/foreign', action: 'gh.pr.merge', ref: '327',
      expires: new Date(Date.now() + 60_000).toISOString(), ...overrides };
    const signature = sign(null, Buffer.from(JSON.stringify(grant)), signingKey).toString('base64');
    fs.mkdirSync(state, { recursive: true });
    fs.appendFileSync(join(state, 'grants.jsonl'), JSON.stringify({ grant, signature }) + '\n');
    return grant;
  }
  return { root, own, foreign, env, git, key, privateKey, state, invoke, grant };
}
function denied(r, code = 'FOREIGN_WORKSPACE') {
  assert.equal(r.status, 2, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.code, code); assert.match(result.reason, /owning conductor/);
}

test('own repository actions and quoted prose stay untouched', t => {
  const f = fixture(t);
  for (const cmd of ['git push origin HEAD:feat/test', 'rtk git status', 'gh pr ready 12',
    'echo "gh pr merge -R fixture/foreign 327"', 'npm run build', 'git tag local-test']) {
    const r = f.invoke(cmd); assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
  }
  assert.equal(fs.existsSync(join(f.state, 'audit.jsonl')), false);
});

test('foreign git, GitHub, npm and release mutations are denied and audited', t => {
  const f = fixture(t);
  const commands = [`git -C '${f.foreign}' push origin HEAD`, `cd '${f.foreign}' && git merge main`,
    `git -C '${f.foreign}' tag v1`, `git -C '${f.foreign}' branch -D old`,
    `rtk git -C '${f.foreign}' rebase main`, 'gh pr merge -R fixture/foreign 327',
    'gh pr ready --repo=fixture/foreign 327', 'gh pr close https://github.com/fixture/foreign/pull/327',
    'GH_REPO=fixture/foreign gh pr review 327 --approve', 'gh release create v1 -R fixture/foreign',
    `npm --prefix '${f.foreign}' publish`, `npm --prefix '${f.foreign}' version patch`,
    `cd '${f.foreign}' && node scripts/release.mjs`, `bash -c "git -C '${f.foreign}' push"`,
    `GIT_WORK_TREE='${f.foreign}' git push`, `git --git-dir='${f.foreign}/.git' push`,
    'git push https://github.com/fixture/foreign.git HEAD:main'];
  for (const command of commands) denied(f.invoke(command), /bash -c|--git-dir/.test(command)?'UNVERIFIABLE':'FOREIGN_WORKSPACE');
  const events = fs.readFileSync(join(f.state, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.length, commands.length);
  assert.ok(events.every(e => ['FOREIGN_WORKSPACE','UNVERIFIABLE'].includes(e.code) && e.session === 'session-test'));
});

test('a sibling worktree and a symlink to a foreign workspace remain foreign', t => {
  const f = fixture(t), sibling = join(f.root, 'sibling');
  f.git(f.own, 'worktree', 'add', '-b', 'feat/sibling', sibling);
  fs.symlinkSync(f.foreign, join(f.own, 'foreign-link'), 'dir');
  denied(f.invoke(`git -C '${sibling}' push`));
  denied(f.invoke('git -C foreign-link push'),'UNVERIFIABLE');
});

test('valid exact owner grant is accepted and its use audited', t => {
  const f = fixture(t); f.grant();
  const r = f.invoke('gh pr merge -R fixture/foreign 327');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(join(f.state, 'audit.jsonl'), 'utf8')).type, 'grant-used');
});

for (const [name, overrides] of Object.entries({
  expired: { expires: '2020-01-01T00:00:00Z' }, workspace: { workspace: '/other' },
  session: { session: 'other' }, repository: { repo: 'github.com/other/repo' },
  action: { action: 'gh.pr.close' }, reference: { ref: '328' }, owner: { owner: '' },
})) test(`a ${name} grant cannot authorize a foreign mutation`, t => {
  const f = fixture(t); f.grant(overrides); denied(f.invoke('gh pr merge -R fixture/foreign 327'));
});

test('self-signed, tampered and malformed grants fail closed', t => {
  const f = fixture(t); f.grant({}, generateKeyPairSync('ed25519').privateKey);
  denied(f.invoke('gh pr merge -R fixture/foreign 327'));
  fs.appendFileSync(join(f.state, 'grants.jsonl'), '{forged}\n');
  denied(f.invoke('gh pr merge -R fixture/foreign 327'));
  denied(f.invoke(`node '${grantCommand}' --owner agent`), 'OWNER_ONLY');
});

test('published package version edits and release commands require release authorization', t => {
  const f = fixture(t);
  denied(f.invoke({ tool_name: 'Edit', tool_input: { file_path: join(f.own, 'package.json'),
    old_string: '1.0.0', new_string: '1.0.1' } }), 'VERSION_BUMP');
  for (const command of ['npm version patch', 'npm publish', 'npm run release', 'node scripts/release.mjs'])
    denied(f.invoke(command), 'RELEASE_ONLY');
  const ordinary = f.invoke({ tool_name: 'Edit', tool_input: { file_path: join(f.own, 'package.json'),
    old_string: 'published-fixture', new_string: 'renamed-fixture' } });
  assert.equal(ordinary.status, 0, ordinary.stderr);
  fs.mkdirSync(join(f.own,'private'));
  fs.writeFileSync(join(f.own, 'private/package.json'), '{"name":"private","version":"1.0.0","private":true}');
  const privateEdit = f.invoke({ tool_name: 'Write', tool_input: { file_path: join(f.own, 'private/package.json'),
    content: '{"name":"private","version":"1.0.1","private":true}' } });
  assert.equal(privateEdit.status, 0, privateEdit.stderr);
});

test('already committed bumps cannot leave a feature branch', t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"published-fixture","version":"1.0.1"}');
  f.git(f.own, 'add', 'package.json'); f.git(f.own, 'commit', '-qm', 'bump');
  denied(f.invoke('git push origin HEAD:feat/test'), 'VERSION_BUMP');
});

test('foreign edits and patches are denied; benign own edits pass', t => {
  const f = fixture(t);
  denied(f.invoke({ tool_name: 'Write', tool_input: { file_path: join(f.foreign, 'README.md'), content: 'x' } }));
  denied(f.invoke({ tool_name: 'apply_patch', tool_input: { patch: `*** Begin Patch\n*** Add File: ${f.foreign}/new.txt\n+x\n*** End Patch` } }));
  const r = f.invoke({ tool_name: 'Write', tool_input: { file_path: join(f.own, 'README.md'), content: 'x' } });
  assert.equal(r.status, 0, r.stderr);
});

test('owner command appends a verifiable grant without rewriting history', t => {
  const f = fixture(t), key = join(f.root, 'owner.pem');
  fs.writeFileSync(key, f.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const args = [grantCommand, '--key', key, '--workspace', f.own, '--session', 'session-test',
    '--owner', 'owner:test', '--repo', 'github.com/fixture/foreign', '--action', 'gh.pr.merge',
    '--ref', '327', '--expires', new Date(Date.now() + 60_000).toISOString()];
  for (let i = 0; i < 2; i++) {
    const r = spawnSync(process.execPath, args, { cwd: f.own, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  assert.equal(fs.readFileSync(join(f.state, 'grants.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(f.invoke('gh pr merge -R fixture/foreign 327').status, 0);
});

test('a remote PR bump requires a separate release grant even after scope authorization', t => {
  const f = fixture(t); f.grant();
  fs.writeFileSync(join(f.root, 'pr.diff'), 'diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-{"name":"published-fixture","version":"1.0.0"}\n+{"name":"published-fixture","version":"1.0.1"}\n');
  fs.writeFileSync(join(f.root, 'pr.head.json'), '{"name":"published-fixture","version":"1.0.1"}');
  denied(f.invoke('gh pr merge -R fixture/foreign 327'), 'VERSION_BUMP');
  f.grant({ action: 'release' });
  assert.equal(f.invoke('gh pr merge -R fixture/foreign 327').status, 0);
});

test('own release actions require and accept an exact owning-lane grant', t => {
  const f = fixture(t);
  f.grant({ repo: 'github.com/fixture/own', action: 'release', ref: 'patch' });
  assert.equal(f.invoke('npm version patch').status, 0);
});

test('multi-ref push, nested repositories, shell state writes and git config overrides cannot widen scope', t => {
  const f = fixture(t);
  f.grant({ action: 'git.push', ref: 'HEAD:main' });
  denied(f.invoke('git push https://github.com/fixture/foreign.git HEAD:other HEAD:main'));
  assert.equal(f.invoke(`git -C '${f.foreign}' tag --list v1`).status, 0);
  const nested = join(f.own, 'nested'); fs.mkdirSync(nested); f.git(nested, 'init');
  denied(f.invoke('git -C nested push'));
  denied(f.invoke('echo forged >> .h2a/workspace-scope/grants.jsonl'), 'OWNER_ONLY');
  denied(f.invoke('git -c remote.origin.pushurl=https://github.com/fixture/foreign.git push'), 'UNVERIFIABLE');
});

test('inline package patches and Codex command envelopes cannot bypass the guard', t => {
  const f = fixture(t);
  denied(f.invoke({ tool_name: 'apply_patch', tool_input: `*** Begin Patch\n*** Update File: ${f.own}/package.json\n@@\n-{"name":"published-fixture","version":"1.0.0"}\n+{"name":"published-fixture","version":"1.0.1"}\n*** End Patch` }), 'VERSION_BUMP');
  denied(f.invoke({ tool_name: 'functions.exec', tool_input: `const r = await tools.exec_command({cmd: "git -C ${f.foreign} push"}); text(r);` }));
  denied(f.invoke({ tool_name: 'exec_command', tool_input: { cmd: 'git push', workdir: f.foreign } }));
});

test('tampering a signed grant, symlink journals and broken audit storage refuse', t => {
  const f = fixture(t); f.grant();
  const file = join(f.state, 'grants.jsonl'), row = JSON.parse(fs.readFileSync(file, 'utf8'));
  row.grant.ref = '328'; fs.writeFileSync(file, JSON.stringify(row) + '\n');
  denied(f.invoke('gh pr merge -R fixture/foreign 328'));
  fs.rmSync(file); fs.symlinkSync(join(f.root, 'other-grants'), file);
  denied(f.invoke('gh pr merge -R fixture/foreign 327'));
  fs.rmSync(join(f.state, 'audit.jsonl'));
  fs.mkdirSync(join(f.state, 'audit.jsonl'), { recursive: true });
  denied(f.invoke('gh pr close -R fixture/foreign 327'), 'AUDIT_UNAVAILABLE');
});

test('foreign URL grants normalize consistently and npm script aliases retain release restrictions', t => {
  const f = fixture(t); f.grant();
  assert.equal(f.invoke('gh pr merge https://github.com/fixture/foreign/pull/327').status, 0);
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"published-fixture","version":"1.0.0","scripts":{"ship":"npm publish"}}');
  denied(f.invoke('npm run ship'), 'RELEASE_ONLY');
  denied(f.invoke('npm pkg set version=1.0.1'), 'RELEASE_ONLY');
});

test('own merge refuses an incoming committed package bump', t => {
  const f = fixture(t);
  f.git(f.own, 'checkout', '-qb', 'incoming');
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"published-fixture","version":"1.0.1"}');
  f.git(f.own, 'add', 'package.json'); f.git(f.own, 'commit', '-qm', 'bump');
  f.git(f.own, 'checkout', 'feat/test');
  denied(f.invoke('git merge incoming'), 'VERSION_BUMP');
});

test('packaged session binding rejects missing or changed workspace binding', t => {
  const f = fixture(t);
  const env = { ...f.env }; delete env.CLAUDE_PROJECT_DIR; delete env.CODEX_WORKSPACE_ROOT; delete env.H2A_SCOPE_SESSION;
  const run = (cwd, args = [], input = {}) => spawnSync(process.execPath, [hook, ...args], {
    cwd, env, input: JSON.stringify({ session_id: 'native-session', ...input }), encoding: 'utf8' });
  denied(run(f.own), 'UNVERIFIABLE');
  assert.equal(run(f.own, ['--initialize-session', 'true']).status, 0);
  assert.equal(run(f.own, [], { tool_input: { command: 'git status' } }).status, 0);
  denied(run(f.foreign, [], { tool_input: { command: 'git push' } }), 'UNVERIFIABLE');
});

test('heredocs refuse uncertainty while explicit own copies and null redirections pass', t => {
  const f = fixture(t);
  denied(f.invoke(`cat <<'EOF' > test.txt\ngh pr merge -R fixture/foreign 327\nEOF`),'UNVERIFIABLE');
  for (const command of [`cp '${f.foreign}/package.json' fixture.json`, 'git push origin HEAD:feat/test > /dev/null'])
    assert.equal(f.invoke(command).status, 0, command);
  denied(f.invoke(`bash <<'EOF'\ngit -C '${f.foreign}' push\nEOF`),'UNVERIFIABLE');
});

test('push default overrides and additional push destinations stay within the repository', t => {
  const f = fixture(t);
  f.git(f.own, 'remote', 'add', 'other', 'https://github.com/fixture/foreign.git');
  f.git(f.own, 'config', 'remote.pushDefault', 'other');
  denied(f.invoke('git push'));
  f.git(f.own, 'config', '--unset', 'remote.pushDefault');
  f.git(f.own, 'config', '--add', 'remote.origin.pushurl', 'https://github.com/fixture/own.git');
  f.git(f.own, 'config', '--add', 'remote.origin.pushurl', 'https://github.com/fixture/foreign.git');
  denied(f.invoke('git push origin HEAD:feat/test'));
});

test('pushed refs and the index are inspected even when the working file hides a bump', t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"published-fixture","version":"1.0.1"}');
  f.git(f.own, 'add', 'package.json');
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"published-fixture","version":"1.0.0"}');
  denied(f.invoke('git commit -m bump'), 'VERSION_BUMP');
  f.git(f.own, 'commit', '-qm', 'bump');
  denied(f.invoke('git push origin HEAD:feat/test'), 'VERSION_BUMP');
  f.git(f.own, 'branch', 'bumped'); f.git(f.own, 'reset', '--hard', 'main');
  denied(f.invoke('git push origin bumped:feat/test'), 'VERSION_BUMP');
});

test('remote private package versions and dependency metadata do not cause false bump refusals', t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.root, 'pr.diff'), 'diff --git a/package.json b/package.json\n@@ -2 +2 @@\n-  "version": "1.0.0",\n+  "version": "1.0.1",\n');
  fs.writeFileSync(join(f.root, 'pr.base.json'), '{"name":"fixture","version":"1.0.0","private":true}');
  fs.writeFileSync(join(f.root, 'pr.head.json'), '{"name":"fixture","version":"1.0.1","private":true}');
  assert.equal(f.invoke('gh pr merge 327').status, 0);
  fs.writeFileSync(join(f.root, 'pr.base.json'), '{"name":"published","version":"1.0.0","metadata":{"version":"1.0.0"}}');
  fs.writeFileSync(join(f.root, 'pr.head.json'), '{"name":"published","version":"1.0.0","metadata":{"version":"1.0.1"}}');
  assert.equal(f.invoke('gh pr merge 327').status, 0);
});

test('a remote PR with missing or invalid base/head SHAs stays unverifiable', t => {
  const f = fixture(t); f.grant();
  fs.writeFileSync(join(f.root, 'pr.diff'), 'diff --git a/package.json b/package.json\n@@ -2 +2 @@\n-  "version": "1.0.0",\n+  "version": "1.0.1",\n');
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  for (const pulls of [
    JSON.stringify({ head: { sha: b } }),
    JSON.stringify({ base: { sha: a }, head: {} }),
    JSON.stringify({ base: { sha: 'not-a-sha' }, head: { sha: b } }),
    JSON.stringify({ base: { sha: [a] }, head: { sha: b } }),
  ]) {
    fs.writeFileSync(join(f.root, 'pr.pulls.json'), pulls);
    denied(f.invoke('gh pr merge -R fixture/foreign 327'), 'UNVERIFIABLE');
  }
});

test('state mutation commands and inline URL rewrites cannot bypass authority', t => {
  const f = fixture(t);
  for (const command of ['tee .h2a/workspace-scope/grants.jsonl', 'rm -rf .h2a', 'touch .h2a/workspace-scope/audit.jsonl'])
    denied(f.invoke(command), 'OWNER_ONLY');
  f.git(f.own, 'config', 'url.https://github.com/fixture/foreign.git.pushInsteadOf', 'https://github.com/fixture/own.git');
  denied(f.invoke('git push https://github.com/fixture/own.git HEAD:feat/test'));
});

test('foreign GitHub REST mutations and package-manager cwd flags are scoped', t => {
  const f = fixture(t);
  denied(f.invoke('gh api -X PUT repos/fixture/foreign/pulls/327/merge'));
  denied(f.invoke(`pnpm -C '${f.foreign}' publish`));
});

test('native argv, environment selectors and nested exec workdirs retain the session boundary', t => {
  const f = fixture(t);
  for (const payload of [
    { tool_name: 'process.start', tool_input: { command: 'git', args: ['-C', f.foreign, 'push'] } },
    { tool_name: 'exec_command', tool_input: { cmd: ['git', '-C', f.foreign, 'push'] } },
    { tool_name: 'exec_command', tool_input: { cmd: 'gh pr close 327', env: { GH_REPO: 'fixture/foreign' } } },
    { tool_name: 'functions.exec', tool_input: `text(await tools.exec_command({cmd: "git push", workdir: ${JSON.stringify(f.foreign)}}));` },
  ]) denied(f.invoke(payload));
  denied(f.invoke(`env -C '${f.foreign}' git push`));
});

test('literal Codex patch envelopes preserve ordinary own edits and scope foreign edits', t => {
  const f = fixture(t);
  const code = path => `text(await tools.apply_patch(${JSON.stringify(`*** Begin Patch\n*** Add File: ${path}/README.md\n+test\n*** End Patch`)}));`;
  const own = f.invoke({ tool_name: 'functions.exec', tool_input: code(f.own) });
  assert.equal(own.status, 0, own.stderr);
  denied(f.invoke({ tool_name: 'functions.exec', tool_input: code(f.foreign) }));
});

test('own monorepo workspace builds and release prose remain ordinary work', t => {
  const f = fixture(t);
  fs.mkdirSync(join(f.own, 'packages/tool'), { recursive: true });
  fs.writeFileSync(join(f.own, 'packages/tool/package.json'), '{"name":"@fixture/tool","private":true,"scripts":{"build":"echo release"}}');
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"published-fixture","version":"1.0.0","workspaces":["packages/*"],"scripts":{"build":"npm run build -w @fixture/tool"}}');
  for (const command of ['npm run build', 'echo release', 'echo scripts/release.mjs']) {
    const r = f.invoke(command); assert.equal(r.status, 0, command + ': ' + r.stderr);
  }
});

test('the read-only npm version query remains allowed in the owning workspace', t => {
  const f = fixture(t); const r = f.invoke('npm version');
  assert.equal(r.status, 0, r.stderr);
});

test('npm version on a private owning package does not require published-package release authority', t => {
  const f = fixture(t,{privatePackage:true});
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"private-fixture","version":"1.0.0","private":true}');
  const r = f.invoke('npm version patch'); assert.equal(r.status, 0, r.stderr);
});

test('a published workspace cannot inherit a private sibling release exemption', t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.own, 'package.json'), '{"private":true,"workspaces":["packages/*"]}');
  for (const [name, isPrivate] of [['a', true], ['b', false]]) {
    fs.mkdirSync(join(f.own, 'packages', name), { recursive: true });
    fs.writeFileSync(join(f.own, 'packages', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: isPrivate }));
  }
  denied(f.invoke('npm version patch --workspaces'), 'RELEASE_ONLY');
});

test('reading the owner helper is ordinary work, while manual session initialization is owner-only', t => {
  const f = fixture(t);
  const read = f.invoke(`cat '${grantCommand}'`); assert.equal(read.status, 0, read.stderr);
});

test('agents cannot call the session initializer to establish a different workspace binding', t => {
  const f = fixture(t);
  denied(f.invoke(`cd '${f.foreign}' && node '${hook}' --initialize-session true`), 'OWNER_ONLY');
});

// Independent review #364, tour 2: each case must fail before its root fix.
const indirectForeign = [
  ['cd double dash', f => `cd -- '${f.foreign}' && git push`],
  ['cd physical', f => `cd -P '${f.foreign}' && git merge main`],
  ['cd logical', f => `cd -L '${f.foreign}' && git branch -D old`],
  ['pushd', f => `pushd '${f.foreign}' && git push`],
  ['subshell cwd', f => `cd '${f.foreign}' && (cd '${f.own}') && git push`],
  ['pipeline cwd', f => `cd '${f.foreign}' && echo ok | cd '${f.own}' && git push`],
  ['absolute shell heredoc', f => `/bin/bash <<'EOF'\ngit -C '${f.foreign}' push\nEOF`],
  ['env shell heredoc', f => `env bash <<'EOF'\ngit -C '${f.foreign}' push\nEOF`],
  ['piped shell heredoc', f => `cat <<'EOF' | sh\ngit -C '${f.foreign}' push\nEOF`],
  ['git namespace', f => `git --namespace ns -C '${f.foreign}' push`],
  ...['pull', 'apply p.diff', 'am p.mbox', 'branch -f main HEAD~1', 'branch --move old new', 'branch --copy old new'].map(sub =>
    [sub, f => `git -C '${f.foreign}' ${sub}`]),
  ['gh short approve', () => 'gh pr review -R fixture/foreign 327 -a'],
  ...['-t title', '-b body', '-F file', '--subject title', '--body-file file'].map(option =>
    ['gh merge ' + option, () => `gh pr merge ${option} https://github.com/fixture/foreign/pull/327`]),
  ['gh close comment', () => 'gh pr close -c note https://github.com/fixture/foreign/pull/327'],
  ['npm run-script', f => `npm --prefix '${f.foreign}' run-script build`],
  ...['pnpm -C', 'yarn --cwd', 'bun --cwd'].map(pm => [pm + ' shorthand', f => `${pm} '${f.foreign}' build`]),
];
for (const [name, command] of indirectForeign) test('R2 should deny foreign ' + name, t => {
  const f = fixture(t); denied(f.invoke(command(f)),name.includes('heredoc')?'UNVERIFIABLE':'FOREIGN_WORKSPACE');
});
for (const pm of ['npm run-script', 'pnpm', 'yarn', 'bun']) test('R2 should inspect script alias ' + pm, t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.own, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { ship: 'npm publish' } }));
  denied(f.invoke(pm + ' ship'), 'RELEASE_ONLY');
});
for (const command of ['echo forged>.h2a/workspace-scope/grants.jsonl',
  'echo forged>>.h2a/workspace-scope/sessions.jsonl', 'echo x >| .h2a/workspace-scope/grants.jsonl',
  'echo x &>.h2a/workspace-scope/grants.jsonl',
  `node -e "fs.appendFileSync('.h2a/workspace-scope/sessions.jsonl', 'x')"`,
  ...['bun', 'deno', 'zsh', 'npx'].map(exe => exe + ' workspace-scope-grant.mjs --owner agent')])
  test('R3 should protect owner state: ' + command, t => { const f = fixture(t); denied(f.invoke(command), 'OWNER_ONLY'); });
test('R3 should deny attached foreign redirections', t => {
  const f = fixture(t); denied(f.invoke(`echo x>${f.foreign}/file`));
});
test('R3 should inspect bracket exec envelopes', t => {
  const f = fixture(t); denied(f.invoke({tool_name:'functions.exec', tool_input:
    `await tools["exec_command"]({cmd: "git -C ${f.foreign} push"})`}));
});
test('R4 should inspect repository root from a child cwd', t => {
  const f = fixture(t); fs.mkdirSync(join(f.own, 'packages/other'), { recursive: true });
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"fixture","version":"1.0.1"}');
  f.git(f.own, 'add', 'package.json'); f.git(f.own, 'commit', '-qm', 'bump');
  denied(f.invoke('git -C packages/other push'), 'VERSION_BUMP');
});
test('R4 should refuse moving the version baseline', t => {
  const f = fixture(t); denied(f.invoke('git update-ref refs/remotes/origin/main HEAD'), 'OWNER_ONLY');
});
test('R4 should inspect path commits from the worktree', t => {
  const f = fixture(t); fs.writeFileSync(join(f.own, 'package.json'), '{"name":"fixture","version":"1.0.1"}');
  denied(f.invoke('git commit -m bump package.json'), 'VERSION_BUMP');
});
test('R4 should inspect matching push refspecs', t => {
  const f = fixture(t); fs.writeFileSync(join(f.own, 'package.json'), '{"name":"fixture","version":"1.0.1"}');
  f.git(f.own, 'add', 'package.json'); f.git(f.own, 'commit', '-qm', 'bump');
  denied(f.invoke('git push origin :'), 'VERSION_BUMP');
});
test('R4 should inspect MultiEdit versions', t => {
  const f = fixture(t); denied(f.invoke({tool_name:'MultiEdit',tool_input:{file_path:join(f.own,'package.json'),
    edits:[{old_string:'1.0.0',new_string:'1.0.1'}]}}), 'VERSION_BUMP');
});
test('R4 should require release authority after a foreign file grant', t => {
  const f = fixture(t), path = join(f.foreign,'package.json');
  f.grant({action:'file.write',ref:path});
  const payload = {tool_name:'Write',tool_input:{file_path:path,content:'{"name":"fixture","version":"1.0.1"}'}};
  denied(f.invoke(payload), 'VERSION_BUMP');
  f.grant({action:'release',ref:path}); assert.equal(f.invoke(payload).status,0);
});
for (const locator of ['fixture/foreign','https://github.com/FIXTURE/foreign.git']) test('R5 should normalize grant ' + locator, t => {
  const f = fixture(t), key = join(f.root,'owner.pem');
  fs.writeFileSync(key,f.privateKey.export({type:'pkcs8',format:'pem'}));
  const r = spawnSync(process.execPath,[grantCommand,'--key',key,'--workspace',f.own,'--session','session-test',
    '--owner','owner:test','--repo',locator,'--action','gh.pr.merge','--ref','327','--expires',new Date(Date.now()+60_000).toISOString()],
    {env:f.env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); assert.equal(f.invoke('gh pr merge -R fixture/foreign 327').status,0);
});
test('R5 should accept equals options', t => {
  const f = fixture(t); assert.equal(f.invoke('git status',['--host=claude']).status,0);
});
test('R5 should use the startup owner key for packaged sessions', t => {
  const f = fixture(t); f.grant({session:'native'});
  const run = args => spawnSync(process.execPath,[hook,...args],{cwd:f.own,env:{...f.env,H2A_SCOPE_OWNER_KEY:f.key},
    input:JSON.stringify({session_id:'native',tool_name:'Bash',tool_input:{command:'gh pr merge -R fixture/foreign 327'}}),encoding:'utf8'});
  assert.equal(run(['--initialize-session','true']).status,0);
  const r = run([]); assert.equal(r.status,0,r.stderr);
});
for (const command of ["git commit -m 'fix: handle $PATH'", "git commit -m 'fix \u0060foo\u0060'",
  'git add --all', 'git commit --all -m msg',
  'node --test packages/h2a/test/publish-rehearsal.test.js','node --test test/release-check.test.js','gh pr ready'])
  test('R6 should allow ordinary own command ' + command, t => {
    const f = fixture(t), r = f.invoke(command); assert.equal(r.status,0,r.stderr);
  });
for (const command of [`git commit -m "$(cat <<'EOF'\nfix: handle $PATH\nEOF\n)"`,
  'tmp=$(mktemp -d); HOME=$tmp npm run build']) test('T4 should request explicit form for dynamic own command ' + command, t => {
  const f=fixture(t);denied(f.invoke(command),'UNVERIFIABLE');
});
for (const option of ['--show-current','--contains','--merged','--no-merged','--color'])
  test('R6 should allow foreign branch reads ' + option, t => {
    const f = fixture(t), r = f.invoke(`git -C '${f.foreign}' branch ${option}`); assert.equal(r.status,0,r.stderr);
  });
for (const mode of ['template','object']) test('R6 should support literal patch envelope ' + mode, t => {
  const f = fixture(t);
  for (const dir of [f.own, f.foreign]) {
    const patch = `*** Begin Patch\n*** Add File: ${dir}/readme.txt\n+x\n*** End Patch`;
    const arg = mode === 'template' ? '\u0060' + patch + '\u0060' : '{patch:' + JSON.stringify(patch) + '}';
    const r = f.invoke({tool_name:'functions.exec',tool_input:'await tools.apply_patch(' + arg + ')'});
    if (dir === f.own) assert.equal(r.status,0,r.stderr); else denied(r);
  }
});
test('R7 should expose exact grant selectors in stdout and stderr', t => {
  const f = fixture(t), r = f.invoke('gh pr close -R fixture/foreign 327'); denied(r);
  for (const output of [r.stdout,r.stderr]) for (const value of ['github.com/fixture/foreign','327','session-test']) assert.ok(output.includes(value),output);
});

test('R5 should bind each Vibe native session once in the profile and reject cwd rebinding', t => {
  const f=fixture(t), profile=join(f.root,'profile'); fs.mkdirSync(profile);
  const run=(cwd,session,command)=>spawnSync(process.execPath,[hook,'--host','vibe','--session-store',profile],{
    cwd,env:f.env,encoding:'utf8',input:JSON.stringify({session_id:session,tool_name:'bash',tool_input:{command}})});
  assert.equal(JSON.parse(run(f.own,'one','git status').stdout).decision,'allow');
  const foreign=run(f.foreign,'one','git push'); assert.equal(JSON.parse(foreign.stdout).decision,'deny');
  assert.equal(JSON.parse(foreign.stdout).code,'FOREIGN_WORKSPACE');
  assert.equal(JSON.parse(run(f.foreign,'two','git status').stdout).decision,'allow');
  const mutate=f.invoke({tool_name:'Write',tool_input:{file_path:join(profile,'.h2a/workspace-scope/sessions.jsonl'),content:'x'}},['--session-store',profile]);
  denied(mutate,'OWNER_ONLY');
});
test('R2 should resolve executable heredocs and substitutions in their actual command cwd', t => {
  const f=fixture(t);
  for (const command of [`cd '${f.foreign}' && /bin/sh <<'EOF'\ngit push\nEOF`,
    `cd '${f.foreign}' && echo $(git push)`]) denied(f.invoke(command),'UNVERIFIABLE');
});
test('R3 should reject dynamic redirection destinations and indirect tool references', t => {
  const f=fixture(t);
  for (const command of ['echo x>$DEST', 'echo --help>.h2a/workspace-scope/grants.jsonl']) {
    const r=f.invoke(command); denied(r,command.includes('$DEST')?'UNVERIFIABLE':'OWNER_ONLY');
  }
  for (const source of ['const run=tools.exec_command; await run({cmd:"git push"})',
    'await tools["exec_"+"command"]({cmd:"git push"})'])
    denied(f.invoke({tool_name:'functions.exec',tool_input:source}),'UNVERIFIABLE');
});
test('R4 should preserve the version baseline when a local main branch moves', t => {
  const f=fixture(t); assert.equal(f.invoke('git status').status,0);
  fs.writeFileSync(join(f.own,'package.json'),'{"name":"fixture","version":"1.0.1"}');
  f.git(f.own,'add','package.json'); f.git(f.own,'commit','-qm','bump');
  f.git(f.own,'update-ref','refs/remotes/origin/main','HEAD'); f.git(f.own,'branch','-f','main','HEAD');
  denied(f.invoke('git push origin HEAD:feat/test'),'VERSION_BUMP');
});

for (const host of ['claude','codex','agy','muse','vibe','gemini']) test('R1/R5 should enforce own, foreign, signed grants and bumps for ' + host, t => {
  const f=fixture(t), options=['--host',host];
  const run=input=>f.invoke(input,options);
  const check=(r,code)=>{ assert.equal(r.status,['agy','vibe'].includes(host)?0:2,r.stderr);assert.equal(JSON.parse(r.stdout).code,code); };
  const own=run('git status');assert.equal(own.status,0,own.stderr);
  check(run('gh pr close -R fixture/foreign 327'),'FOREIGN_WORKSPACE');
  f.grant({action:'gh.pr.close'}); const granted=run('gh pr close -R fixture/foreign 327');assert.equal(granted.status,0,granted.stderr);
  const edit=host==='agy'?{toolCall:{name:'replace_file_content',args:{TargetFile:join(f.own,'package.json'),TargetContent:'1.0.0',ReplacementContent:'1.0.1'}}}:
    {tool_name:'Edit',tool_input:{file_path:join(f.own,'package.json'),old_string:'1.0.0',new_string:'1.0.1'}};
  check(run(edit),'VERSION_BUMP');
  f.grant({repo:'github.com/fixture/own',action:'release',ref:join(f.own,'package.json')});
  assert.equal(run(edit).status,0);
});
for (const host of ['claude','codex']) test('R5 should authorize grants through the actual packaged ' + host + ' hooks', t => {
  const f=fixture(t), entries=JSON.parse(fs.readFileSync(resolve('packages/h2a/hooks/hooks.json'),'utf8')).hooks;
  f.grant({session:'packaged-native',action:'gh.pr.close'});
  const env={...f.env,H2A_SCOPE_OWNER_KEY:f.key,[host==='claude'?'CLAUDE_PLUGIN_ROOT':'CODEX_PLUGIN_ROOT']:resolve('packages/h2a')};
  delete env[host==='claude'?'CODEX_PLUGIN_ROOT':'CLAUDE_PLUGIN_ROOT'];
  const run=event=>spawnSync('sh',['-c',entries[event].find(e=>JSON.stringify(e).includes('workspace-scope-guard')).hooks[0].command],{
    cwd:f.own,env,encoding:'utf8',input:JSON.stringify({session_id:'packaged-native',tool_name:'Bash',tool_input:{command:'gh pr close -R fixture/foreign 327'}})});
  assert.equal(run('SessionStart').status,0);const r=run('PreToolUse');assert.equal(r.status,0,r.stderr);
});
test('R2 should preserve cwd and environment across wrappers and subshells', t => {
  const f=fixture(t);
  for(const command of [`cd '${f.foreign}' && env -C '${f.own}' echo ok; git push`,
    'GH_REPO=fixture/foreign; (GH_REPO=fixture/own); gh pr close 327',
    'GH_REPO=fixture/foreign bash -c "gh pr close 327"']) denied(f.invoke(command),command.includes('bash -c')?'UNVERIFIABLE':'FOREIGN_WORKSPACE');
});
test('R6 should keep release scripts gated when a test-looking argument follows the script', t => {
  const f=fixture(t);denied(f.invoke('node scripts/release.mjs --test'),'RELEASE_ONLY');
});

test('R1/R4 should inspect native agy replacement chunks and protected file writes', t => {
  const f=fixture(t);
  const invoke=(name,args)=>f.invoke({conversationId:'native-agy',toolCall:{name,args}},['--host','agy']);
  const bump=invoke('multi_replace_file_content',{TargetFile:join(f.own,'package.json'),
    ReplacementChunks:[{TargetContent:'1.0.0',ReplacementContent:'1.0.1'}]});
  assert.equal(JSON.parse(bump.stdout).code,'VERSION_BUMP');
  const owner=invoke('write_to_file',{TargetFile:join(f.state,'sessions.jsonl'),CodeContent:'forged'});
  assert.equal(JSON.parse(owner.stdout).code,'OWNER_ONLY');
});

test('R3 should reject spread members in Codex command objects', t => {
  const f=fixture(t);denied(f.invoke({tool_name:'functions.exec',tool_input:
    'await tools.exec_command({cmd:"git status", ...overrides})'}),'UNVERIFIABLE');
});

// Independent review #364, tour 3: the hook inspects these commands; none executes.
const reviewShell = [
  ['brace group', f => `{ git -C '${f.foreign}' push; }`],
  ['if', f => `if true; then git -C '${f.foreign}' push; fi`],
  ['for', f => `for x in 1; do git -C '${f.foreign}' push; done`],
  ['while', f => `while true; do git -C '${f.foreign}' push; done`],
  ['until', f => `until false; do git -C '${f.foreign}' push; done`],
  ...['!', 'time', 'nice', 'nice -n 2', 'timeout 10', 'timeout -s TERM 10', 'stdbuf -oL', 'setsid', 'command --', 'builtin'].map(prefix =>
    [prefix, f => `${prefix} git -C '${f.foreign}' push`]),
  ['builtin cd', f => `builtin cd '${f.foreign}' && git push`],
  ['function parens', f => `cd '${f.foreign}' && f() { :; } && git push`],
  ['case parens', f => `cd '${f.foreign}' && case 1 in 1) ;; esac && git push`],
  ['negated subshell', f => `cd '${f.foreign}' && ! (false) && git push`],
  ['comment parens', f => `cd '${f.foreign}'\n# )\ngit push`],
  ['cd oldpwd', f => `cd '${f.foreign}' && cd '${f.own}' && cd - && git push`],
  ['cd home', f => `HOME='${f.foreign}'; cd; git push`],
  ['pushd swap', f => `pushd '${f.foreign}' && pushd '${f.own}' && pushd && git push`],
  ['git continuation', f => `git \\\n -C '${f.foreign}' push`],
  ['gh continuation', () => 'gh \\\n pr merge -R fixture/foreign 327'],
  ['eval', f => `eval "git -C '${f.foreign}' push"`],
  ['eval cwd state', f => `eval "cd '${f.foreign}'"; git push`],
  ['export repo state', () => 'export GH_REPO=fixture/foreign; gh pr close 327'],
  ['readonly repo state', () => 'readonly GH_REPO=fixture/foreign; gh pr close 327'],
  ['conditional cwd reset', f => `cd '${f.foreign}' || cd '${f.own}'; git push`],
  ['conditional repo reset', () => 'GH_REPO=fixture/foreign; false && GH_REPO=fixture/own; gh pr close 327'],
  ['brace expansion subcommand', f => `git -C '${f.foreign}' {pu,xx}sh`],
  ['here string', f => `sh <<< "git -C '${f.foreign}' push"`],
  ['pipeline stdin', f => `echo "git -C '${f.foreign}' push" | sh`],
  ['pipeline stage cwd', f => `cd '${f.foreign}' && cd '${f.own}' | git push`],
  ['pipeline nested cwd', f => `echo own | (cd '${f.foreign}'; git push)`],
  ['quoted shell heredoc', f => `"bash" <<'EOF'\ngit -C '${f.foreign}' push\nEOF`],
  ...['-ce', '-cu', '-cx'].map(flag => [flag, f => `sh ${flag} "git -C '${f.foreign}' push"`]),
  ['variable executable', f => `CMD="git -C '${f.foreign}' push"; $CMD`],
  ['git dir over worktree', f => `GIT_DIR='${f.foreign}/.git' GIT_WORK_TREE='${f.own}' git push`],
  ['git dir over C', f => `git --git-dir='${f.foreign}/.git' -C '${f.own}' push`],
  ['git attr source', f => `git --attr-source HEAD -C '${f.foreign}' push`],
  ['remote mutation before push', () => 'git remote set-url origin https://github.com/fixture/foreign.git && git push origin HEAD:main'],
];
for (const [name, command] of reviewShell) test('T3 R2 should fail closed for ' + name, t => {
  const f = fixture(t), r = f.invoke(command(f));
  assert.equal(r.status, 2, r.stderr || command(f));
  assert.ok(['FOREIGN_WORKSPACE', 'UNVERIFIABLE'].includes(JSON.parse(r.stdout).code));
});
for (const command of ['{ npm publish; }', 'npm \\\n publish']) test('T3 R2 should gate release ' + command, t => {
  const f = fixture(t); denied(f.invoke(command), 'RELEASE_ONLY');
});
for (const command of ['{ rm -rf .h2a/workspace-scope; }', '{ node workspace-scope-grant.mjs --owner x; }',
  `node --eval="fs.appendFileSync('.h2a/workspace-scope/grants.jsonl','x')"`,
  `node -e"fs.appendFileSync('.h2a/workspace-scope/grants.jsonl','x')"`,
  `node --print="fs.appendFileSync('.h2a/workspace-scope/grants.jsonl','x')"`,
  `node -p"fs.appendFileSync('.h2a/workspace-scope/grants.jsonl','x')"`,
  `true;node <<'EOF'\nfs.appendFileSync('.h2a/workspace-scope/grants.jsonl','x')\nEOF`,
  'cp -t .h2a/workspace-scope package.json', 'cp --target-directory=.h2a/workspace-scope package.json',
  'dd of=.h2a/workspace-scope/grants.jsonl', 'ln -sf package.json .h2a/workspace-scope/grants.jsonl',
  'git clean -fdx .h2a/workspace-scope', 'git clean -fdx', 'git apply forged.diff'])
  test('T3 R3 should protect trust from ' + command, t => { const f = fixture(t); denied(f.invoke(command),command.includes('<<')?'UNVERIFIABLE':'OWNER_ONLY'); });
for (const path of ['.muse/hooks.json', '.muse/.h2a-scope-install/manifest.json', '.claude/settings.json', '.agents/hooks.json', '.vibe/hooks.toml'])
  test('T3 R3 should protect project hook ' + path, t => {
    const f = fixture(t); denied(f.invoke({tool_name:'Write',tool_input:{file_path:join(f.own,path),content:'{}'}}), 'OWNER_ONLY');
  });
test('T3 R3 should reject tool aliases and computed property names', t => {
  const f = fixture(t);
  for (const source of [`const t=tools; await t["exec_"+"command"]({cmd:"git -C ${f.foreign} push"})`,
    `const {exec_command: run}=tools; await run({cmd:"git -C ${f.foreign} push"})`])
    denied(f.invoke({tool_name:'functions.exec',tool_input:source}), 'UNVERIFIABLE');
});
for (const option of ['--author "A <a@b.c>"', '--date yesterday', '-F message.txt', '-C HEAD', '-c HEAD', '--cleanup strip', '--trailer "X: y"'])
  test('T3 R4 should inspect the index with commit ' + option, t => {
    const f = fixture(t), path=join(f.own,'package.json'), original=fs.readFileSync(path,'utf8');
    fs.writeFileSync(path,original.replace('1.0.0','1.0.1')); f.git(f.own,'add','package.json'); fs.writeFileSync(path,original);
    denied(f.invoke('git commit ' + option + ' -m bump'), 'VERSION_BUMP');
  });
for (const flag of ['--branches', '--tags']) test('T3 R4 should inspect every pushed ref with ' + flag, t => {
  const f = fixture(t); fs.writeFileSync(join(f.own,'package.json'),'{"name":"fixture","version":"1.0.1"}');
  f.git(f.own,'add','package.json'); f.git(f.own,'commit','-qm','bump'); f.git(f.own,'branch','bumped'); f.git(f.own,'tag','bumped-tag');
  f.git(f.own,'reset','--hard','main'); denied(f.invoke('git push origin ' + flag),'VERSION_BUMP');
});
test('T3 R4 should select exact manifest patch sections in a monorepo', t => {
  const f=fixture(t); fs.mkdirSync(join(f.own,'packages/sub'),{recursive:true});
  fs.writeFileSync(join(f.own,'packages/sub/package.json'),'{"name":"sub","version":"1.0.0"}');
  denied(f.invoke({tool_name:'apply_patch',tool_input:'*** Begin Patch\n*** Update File: package.json\n@@\n-{"name":"published-fixture","version":"1.0.0"}\n+{"name":"published-fixture","version":"1.0.0","description":"after"}\n*** Update File: packages/sub/package.json\n@@\n-{"name":"sub","version":"1.0.0"}\n+{"name":"sub","version":"1.0.1"}\n*** End Patch'}),'VERSION_BUMP');
});
for (const multi of [false,true]) test('T3 R4 should honor agy line ranges ' + multi, t => {
  const f=fixture(t), path=join(f.own,'package.json');
  fs.writeFileSync(path,'{\n "name":"fixture",\n "description":"1.0.0",\n "version":"1.0.0"\n}\n');
  const edit={StartLine:4,EndLine:4,TargetContent:'"1.0.0"',ReplacementContent:'"1.0.1"'};
  const r=f.invoke({toolCall:{name:multi?'multi_replace_file_content':'replace_file_content',args:{TargetFile:path,...(multi?{ReplacementChunks:[edit]}:edit)}}},['--host','agy']);
  assert.equal(JSON.parse(r.stdout).code,'VERSION_BUMP',r.stderr);
});
for (const word of ['apply_patch', 'exec_command']) test('T3 R5 should allow tool names in JS strings and comments ' + word, t => {
  const f=fixture(t);
  for (const code of [`await tools.exec_command({cmd:"git commit -m 'fix ${word}'"})`,
    `// ${word}(\nawait tools.exec_command({cmd:"git status"})`,
    `/* ${word} */ await tools["exec_command"]({cmd:"git status"})`]) {
    const r=f.invoke({tool_name:'functions.exec',tool_input:code}); assert.equal(r.status,0,r.stderr);
  }
});

for (const host of ['claude','codex','agy','muse','vibe']) test('T3 matrix should enforce the reviewed shell and trust boundary on ' + host, t => {
  const f=fixture(t);
  const code=r=>{assert.equal(r.status,['agy','vibe'].includes(host)?0:2,r.stderr);return JSON.parse(r.stdout).code;};
  for (const [,command] of reviewShell) assert.ok(['FOREIGN_WORKSPACE','UNVERIFIABLE'].includes(code(f.invoke(command(f),['--host',host]))),command(f));
  for (const command of ['{ rm -rf .h2a/workspace-scope; }','cp -t .h2a/workspace-scope package.json','git clean -fdx','git apply forged.diff'])
    assert.equal(code(f.invoke(command,['--host',host])),'OWNER_ONLY',command);
  for (const path of ['.muse/hooks.json','.claude/settings.json','.agents/hooks.json','.vibe/hooks.toml'])
    assert.equal(code(f.invoke({tool_name:'Write',tool_input:{file_path:join(f.own,path),content:'{}'}},['--host',host])),'OWNER_ONLY');
  const own=f.invoke({tool_name:'functions.exec',tool_input:'// apply_patch\nawait tools.exec_command({cmd:"git commit -m \'fix exec_command\'"})'},['--host',host]);
  assert.equal(own.status,0,own.stderr);
  assert.equal(f.invoke('{ git status; } # )',['--host',host]).status,0);
  const path=join(f.own,'package.json'),original=fs.readFileSync(path,'utf8');
  fs.writeFileSync(path,original.replace('1.0.0','1.0.1'));f.git(f.own,'add','package.json');fs.writeFileSync(path,original);
  assert.equal(code(f.invoke('git commit --author "A <a@b.c>" -m bump',['--host',host])),'VERSION_BUMP');
});
test('T3 R3 should reject reflective and escaped JS capabilities', t => {
  const f=fixture(t);
  for (const source of ['const t=globalThis["to"+"ols"]; await t["exec_"+"command"]({cmd:"git push"})',
    'await to\\u006fls.exec_command({cmd:"git push"})'])
    denied(f.invoke({tool_name:'functions.exec',tool_input:source}),'UNVERIFIABLE');
});
test('T3 R2 should fail closed for unknown wrapper option operands', t => {
  const f=fixture(t);
  for (const prefix of ['sudo --user agent','nice --unknown value','command -x value']) {
    const r=f.invoke(`${prefix} git -C '${f.foreign}' push`);assert.equal(r.status,2,r.stderr);
  }
});
test('T3 R3 should not let git apply inspection flags authorize writes', t => {
  const f=fixture(t);
  for (const flag of ['--stat','--numstat','--summary','--check']) denied(f.invoke(`git apply ${flag} --apply forged.diff`),'OWNER_ONLY');
});
for (const quote of ["'",'`']) test('T3 R3 should decode JS escapes before classifying commands: ' + quote, t => {
  const f=fixture(t);
  denied(f.invoke({tool_name:'functions.exec',tool_input:`await tools.exec_command({cmd: ${quote}git -C ${f.foreign} pu\\x73h${quote}})`}));
});
test('T3 R2 should not erase the initial foreign cwd after a skipped cd', t => {
  const f=fixture(t), r=f.invoke({tool_name:'exec_command',tool_input:{workdir:f.foreign,cmd:`false && cd '${f.own}'; git push`}});
  assert.equal(r.status,2,r.stderr);
});
for (const command of ['true && NODE_ENV=production npm run build', 'true && git commit -m cd'])
  test('T3 R5 should allow own command data without treating it as shell state: ' + command, t => {
    const f=fixture(t),r=f.invoke(command);assert.equal(r.status,0,r.stderr);
  });

// Tour 4: examples are inspected by the hook, never executed as shell scripts.
const failClosedShell = [
  ['comment heredoc', f => `# <<true\ngit -C '${f.foreign}' push\ntrue`],
  ['quoted heredoc', f => `echo "<<true"\ngit -C '${f.foreign}' push\ntrue`],
  ['comment trust heredoc', () => '# <<true\nrm -rf .h2a/workspace-scope\ntrue'],
  ['sh options', f => `sh -c -- "git -C '${f.foreign}' push"`],
  ['bash options', f => `bash -c -e "git -C '${f.foreign}' push"`],
  ...['sh -s arg','sh /dev/stdin','sh /proc/self/fd/0','node','bun','tsx','ts-node'].map(exe =>
    ['stdin ' + exe, f => `echo "git -C '${f.foreign}' push" | ${exe}`]),
  ['deno eval', () => `deno eval "Deno.removeSync('.h2a/workspace-scope')"`],
  ['ts heredoc', () => `ts-node <<EOF\nfs.rmSync('.h2a/workspace-scope')\nEOF`],
  ['variable git', f => `P=push; git -C '${f.foreign}' $P`],
  ...['$"push"', "$'push'", '$(echo push)'].map(word => [word, f => `git -C '${f.foreign}' ${word}`]),
  ['variable gh', () => 'V=merge; gh pr $V -R fixture/foreign 327'],
  ['variable npm', () => 'P=publish; npm $P'],
  ['variable shell flag', f => `C=-c; sh $C "git -C '${f.foreign}' push"`],
  ['variable trust path', () => 'D=.h2a/workspace-scope; rm -rf $D'],
  ['variable foreign path', f => `D='${f.foreign}'; rm -rf $D`],
  ['variable helper', () => 'S=workspace-scope-grant.mjs; node $S --owner x'],
  ['variable eval', () => `E=-e; node $E "fs.appendFileSync('.h2a/workspace-scope/grants.jsonl','x')"`],
  ['variable executable directory', f => `DIR='${f.foreign}'; $DIR/outil push`],
  ['conflicting git selectors', f => `git -C '${f.foreign}' --git-dir='${f.own}/.git' reset --hard`],
  ['remote flags', () => 'git remote -v set-url origin https://github.com/fixture/foreign.git && git push'],
  ['send-pack', () => 'git send-pack https://github.com/fixture/foreign.git HEAD:refs/heads/main'],
];
for (const [name, command] of failClosedShell) test('T4 should refuse uncertainty: ' + name, t => {
  const f=fixture(t), r=f.invoke(command(f));
  denied(r, 'UNVERIFIABLE'); assert.match(JSON.parse(r.stdout).reason, /plain explicit form.*grant/i);
});
for (const command of ['cp package.json .h2a/workspace-scope/grants.jsonl -S .bak',
  'install package.json .h2a/workspace-scope/grants.jsonl -m 600',
  'ln -sf package.json .h2a/workspace-scope/grants.jsonl -S .bak',
  'git clean -fdx -- .h2a/workspace-scope -n']) test('T4 should protect explicit trust destination: ' + command, t => {
    const f=fixture(t); denied(f.invoke(command),'OWNER_ONLY');
  });
for (const sub of ['restore .','worktree remove wt','config --unset user.name']) test('T4 should protect foreign git ' + sub, t => {
  const f=fixture(t); denied(f.invoke(`git -C '${f.foreign}' ${sub}`),sub.startsWith('config')?'UNVERIFIABLE':'FOREIGN_WORKSPACE');
});
for (const comment of ['// }\n','/* } */']) test('T4 should parse JS object comments ' + comment, t => {
  const f=fixture(t); denied(f.invoke({tool_name:'functions.exec',tool_input:
    `await tools.exec_command({cmd:"git status", x:1 ${comment}, cmd:"git -C ${f.foreign} push"})`}),'UNVERIFIABLE');
});
for (const command of ['cp package.json .','mv sub/file.txt .','mkdir -p .',
  'git status && cd . && git status','mkdir -p build && cd build && npm test',
  'git status && cd sub && git push origin HEAD:feat/test']) test('T4 should allow explicit own operation: ' + command, t => {
    const f=fixture(t);fs.mkdirSync(join(f.own,'sub'));fs.writeFileSync(join(f.own,'sub/file.txt'),'ok');
    const r=f.invoke(command);assert.equal(r.status,0,r.stderr);
  });
for (const escape of ["\\'",'\\x66','\\u0066','\\v','\\0','\\\n']) test('T4 should allow double quoted JS escape ' + escape, t => {
  const f=fixture(t),command=escape==="\\'"?"git commit -m \\'fix\\'":`git commit -m '${escape}fix'`;
  const r=f.invoke({tool_name:'functions.exec',tool_input:`await tools.exec_command({cmd:"${command}"})`});
  assert.equal(r.status,0,r.stderr);
});
test('T4 should inspect explicit push refspecs together with tags', t => {
  const f=fixture(t);fs.writeFileSync(join(f.own,'package.json'),'{"name":"published-fixture","version":"1.0.1"}');
  f.git(f.own,'add','package.json');f.git(f.own,'commit','-qm','bump');
  denied(f.invoke('git push origin HEAD:feat/test --tags'),'VERSION_BUMP');
});
for (const duplicate of [false,true]) test('T4 should diff full proposed manifest for patch ' + duplicate, t => {
  const f=fixture(t),path=join(f.own,'package.json');
  fs.writeFileSync(path,'{\n"name":"published-fixture",\n"version":"1.0.0"\n}\n');
  const prefix=duplicate?'*** Update File: package.json\n@@\n-"name":"published-fixture",\n+"name":"published-fixture-renamed",\n':'';
  const patch=`*** Begin Patch\n${prefix}*** Update File: package.json\n@@\n-"version":"1.0.0"\n+"version":\n+"1.0.1"\n*** End Patch`;
  denied(f.invoke({tool_name:'apply_patch',tool_input:patch}),'VERSION_BUMP');
});
for (const tool of ['Write','Edit','apply_patch','npm']) test('T4 should retain baseline publication after private toggle: ' + tool, t => {
  const f=fixture(t),path=join(f.own,'package.json'),original=fs.readFileSync(path,'utf8');
  const privateContent=JSON.stringify({...JSON.parse(original),private:true});
  assert.equal(f.invoke({tool_name:'Write',tool_input:{file_path:path,content:privateContent}}).status,0);
  fs.writeFileSync(path,privateContent);
  if(tool==='npm') { denied(f.invoke('npm version patch'),'RELEASE_ONLY');return; }
  const input=tool==='Write'?{file_path:path,content:original.replace('1.0.0','1.0.1')}:
    tool==='Edit'?{file_path:path,old_string:'1.0.0',new_string:'1.0.1'}:
    `*** Begin Patch\n*** Update File: package.json\n@@\n-${privateContent}\n+${privateContent.replace('1.0.0','1.0.1')}\n*** End Patch`;
  denied(f.invoke({tool_name:tool,tool_input:input}),'VERSION_BUMP');
});
test('T4 should refuse an unbound session before writing its baseline', t => {
  const f=fixture(t),r=spawnSync(process.execPath,[hook],{cwd:f.own,env:f.env,encoding:'utf8',input:JSON.stringify({session_id:'unbound',tool_name:'Bash',tool_input:{command:'git status'}})});
  denied(r,'UNVERIFIABLE');assert.equal(fs.existsSync(join(f.state,'baselines.jsonl')),false);
});
for (const command of ['git -C own-link push','cd own-link && git push','touch own-link/new-file',
  'echo ok > own-link/new-file','GIT_WORK_TREE=own-link git push']) test('T4 should refuse symlink uncertainty: ' + command, t => {
  const f=fixture(t);fs.symlinkSync(f.own,join(f.own,'own-link'),'dir');denied(f.invoke(command),'UNVERIFIABLE');
});
test('T4 should check both own cwd alternatives before a relative git selector', t => {
  const f=fixture(t);fs.mkdirSync(join(f.own,'sub'));
  denied(f.invoke('true && cd sub; git -C ../foreign push'),'UNVERIFIABLE');
});
test('T4 should compare full PR manifests with a multiline version value', t => {
  const f=fixture(t);fs.writeFileSync(join(f.root,'pr.diff'),'diff --git a/package.json b/package.json\n@@\n-"version":"1.0.0"\n+"version":\n+"1.0.1"\n');
  fs.writeFileSync(join(f.root,'pr.head.json'),'{"name":"published-fixture","version":"1.0.1"}');
  denied(f.invoke('gh pr merge 327'),'VERSION_BUMP');
});
for (const command of ['git push origin --all','git merge main','git tag local-test','git branch -D old',
  'git rebase main && git push origin HEAD:feat/test','gh pr close 327','gh pr review 327 --approve'])
  test('T4 should allow explicit own protected action: ' + command, t => {
    const f=fixture(t),r=f.invoke(command);assert.equal(r.status,0,r.stderr);
  });
for (const kind of ['cwd','file']) test('T4 should refuse a native symlink ' + kind, t => {
  const f=fixture(t);fs.symlinkSync(f.own,join(f.own,'own-link'),'dir');
  const input=kind==='cwd'?{tool_name:'exec_command',tool_input:{cmd:'git push',workdir:join(f.own,'own-link')}}:
    {tool_name:'Write',tool_input:{file_path:join(f.own,'own-link/README.md'),content:'ok'}};
  denied(f.invoke(input),'UNVERIFIABLE');
});
for (const command of ['env -C own-link git push','npm --prefix own-link publish','cp sub/file.txt .'])
  test('T4 should retain uncertainty across destination resolution: ' + command, t => {
    const f=fixture(t);fs.symlinkSync(f.own,join(f.own,'own-link'),'dir');
    fs.mkdirSync(join(f.own,'sub'));fs.writeFileSync(join(f.own,'sub/file.txt'),'ok');
    fs.symlinkSync(join(f.own,'README.md'),join(f.own,'file.txt'));
    denied(f.invoke(command),'UNVERIFIABLE');
  });
