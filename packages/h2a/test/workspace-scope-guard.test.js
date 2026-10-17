import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const hook = resolve('packages/h2a/hooks/workspace-scope-guard.mjs');
const grantCommand = resolve('packages/h2a/hooks/workspace-scope-grant.mjs');
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const own = join(root, 'own'), foreign = join(root, 'foreign');
  const env = { ...process.env, PATH: root + ':' + process.env.PATH, HOME: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, XDG_RUNTIME_DIR: root,
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  fs.writeFileSync(join(root, 'gh'), `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2), root = ${JSON.stringify(root)};
if (args[0] === 'api') process.stdout.write(fs.readFileSync(root + (args.some(a=>a.includes('ref=aaaa')) ? '/pr.base.json' : '/pr.head.json')));
else if (args[1] === 'view') console.log(JSON.stringify({baseRefOid:'a'.repeat(40),headRefOid:'b'.repeat(40)}));
else process.stdout.write(fs.readFileSync(root + '/pr.diff'));
`, { mode: 0o755 });
  for (const name of ['base', 'head']) fs.writeFileSync(join(root, `pr.${name}.json`), '{"name":"published-fixture","version":"1.0.0"}');
  fs.writeFileSync(join(root, 'pr.diff'), '');
  function git(dir, ...args) {
    const r = spawnSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  }
  for (const dir of [own, foreign]) {
    fs.mkdirSync(dir); git(dir, 'init', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.invalid'); git(dir, 'config', 'user.name', 'Test');
    fs.writeFileSync(join(dir, 'package.json'), '{"name":"published-fixture","version":"1.0.0"}\n');
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
  for (const command of commands) denied(f.invoke(command));
  const events = fs.readFileSync(join(f.state, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.length, commands.length);
  assert.ok(events.every(e => e.code === 'FOREIGN_WORKSPACE' && e.session === 'session-test'));
});

test('a sibling worktree and a symlink to a foreign workspace remain foreign', t => {
  const f = fixture(t), sibling = join(f.root, 'sibling');
  f.git(f.own, 'worktree', 'add', '-b', 'feat/sibling', sibling);
  fs.symlinkSync(f.foreign, join(f.own, 'foreign-link'), 'dir');
  denied(f.invoke(`git -C '${sibling}' push`));
  denied(f.invoke('git -C foreign-link push'));
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
  fs.writeFileSync(join(f.own, 'package.json'), '{"name":"private","version":"1.0.0","private":true}');
  const privateEdit = f.invoke({ tool_name: 'Write', tool_input: { file_path: join(f.own, 'package.json'),
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

test('ordinary own heredocs, read-only copy sources and null redirections remain allowed', t => {
  const f = fixture(t);
  for (const command of [`cat <<'EOF' > test.txt\ngh pr merge -R fixture/foreign 327\nEOF`,
    `cp '${f.foreign}/package.json' fixture.json`, 'git push origin HEAD:feat/test > /dev/null'])
    assert.equal(f.invoke(command).status, 0, command);
  denied(f.invoke(`bash <<'EOF'\ngit -C '${f.foreign}' push\nEOF`));
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
  const f = fixture(t);
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
