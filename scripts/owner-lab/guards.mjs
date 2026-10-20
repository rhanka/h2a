import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { json, readJson, safeCounts } from './support.mjs';

const code = result => { try { return JSON.parse(result.stdout).code ?? 'no code'; } catch { return result.stderr.trim(); } };
async function fixture(lab, id, github = false) {
  const root = join(lab.root, id); mkdirSync(root);
  const bare = join(root, 'remote.git');
  const own = join(root, 'own');
  await lab.run('git', ['init', '--bare', '--initial-branch=main', bare]);
  await lab.run('git', ['clone', bare, own]);
  await lab.git(own, 'config', 'user.name', 'Owner lab'); await lab.git(own, 'config', 'user.email', 'owner-lab@example.invalid');
  json(join(own, 'package.json'), { name: 'published-fixture', version: '1.0.0', description: 'baseline' });
  await lab.git(own, 'add', 'package.json'); await lab.git(own, 'commit', '-m', 'test: baseline'); await lab.git(own, 'push', 'origin', 'main');
  if (github) await lab.git(own, 'remote', 'set-url', 'origin', 'https://github.com/fixture/own.git');
  const lot = join(own, 'tmp/worktrees/lot');
  await lab.git(own, 'worktree', 'add', '-b', 'feature', lot);
  return { root, bare, own, lot };
}

async function hooks(lab, f) {
  const entry = join(lab.core, 'hooks/workspace-scope-guard.mjs');
  assert.ok(existsSync(entry), 'Candidate does not ship its opt-in guard');
  const session = f.root.split('/').at(-1);
  const env = { ...lab.env, CLAUDE_PLUGIN_ROOT: lab.core, CODEX_PLUGIN_ROOT: lab.core,
    CLAUDE_PROJECT_DIR: f.lot, CODEX_WORKSPACE_ROOT: f.lot, H2A_SCOPE_SESSION: session };
  const settings = join(f.root, 'opt-in-settings.json');
  await lab.cli(['host', 'plugin', '--host', 'claude', '--instance', session, '--workspace', f.lot,
    '--workspace-scope', 'on', '--write', settings], { cwd: f.lot, env });
  const installed = readJson(settings);
  const pre = installed.hooks?.PreToolUse?.flatMap(row => row.hooks ?? []).find(h => h.command.includes('workspace-scope-guard'));
  assert.ok(pre, 'Explicit opt-in installer did not register its workspace guard');
  const packaged = readJson(join(lab.core, 'hooks/hooks.json'));
  const start = (installed.hooks?.SessionStart ?? packaged.hooks?.SessionStart ?? []).flatMap(row => row.hooks ?? []).find(h => h.command.includes('workspace-scope-guard'));
  const invoke = async (payload, initialize = false) => lab.run('/bin/sh', ['-c', initialize ? start?.command ?? 'true' : pre.command], {
    cwd: f.lot, env, input: JSON.stringify({ session_id: session, cwd: f.lot, ...payload }), check: false,
  });
  const started = await invoke({}, true); assert.equal(started.status, 0, started.stderr);
  return { env, session, invoke, async command(command) {
    const guarded = await invoke({ tool_name: 'Bash', tool_input: { command } });
    assert.equal(guarded.status, 0, guarded.stdout + guarded.stderr);
    return lab.run('/bin/sh', ['-c', command], { cwd: f.lot, env });
  } };
}

export async function guardScenarios(lab, scenario) {
  await scenario(1, 'Commit dans le worktree du lot', async () => {
    const f = await fixture(lab, 's1'); const h = await hooks(lab, f);
    const parent = await lab.git(f.own, 'rev-parse', 'HEAD');
    writeFileSync(join(f.lot, 'owner-lab.txt'), 'owner workflow\n');
    await h.command('git add owner-lab.txt && git commit -m "test: owner workflow"');
    const committed = await lab.git(f.lot, 'rev-parse', 'HEAD');
    assert.notEqual(committed, parent); assert.equal(await lab.git(f.own, 'rev-parse', 'HEAD'), parent);
    json(join(lab.evidence, 's1.json'), { parent, committed, lot: f.lot });
    return 's1.json: commit créé dans tmp/worktrees/lot; parent intact';
  });
  await scenario(2, 'Merge PR package.json et voie release', async () => {
    const f = await fixture(lab, 's2', true); const h = await hooks(lab, f);
    const base = await lab.git(f.own, 'rev-parse', 'HEAD');
    const manifests = { before: readFileSync(join(f.lot, 'package.json'), 'utf8') };
    let bump = false;
    let head, diff;
    const calls = [];
    const server = createServer(async (req, res) => {
      calls.push({ method: req.method, url: req.url });
      try {
        const path = new URL(req.url, 'http://local');
        if (path.pathname.endsWith('/pulls/42')) res.end(JSON.stringify({ number: 42, base: { sha: base, ref: 'main' }, head: { sha: head, ref: 'feature' } }));
        else if (path.pathname.endsWith('.diff')) res.end(diff);
        else if (path.pathname.endsWith('.view')) res.end(JSON.stringify({ number: 42, headRefOid: head, baseRefName: 'main', headRefName: 'feature' }));
        else if (path.pathname.includes('/contents/package.json')) res.end(path.searchParams.get('ref') === base ? manifests.before : manifests.after);
        else if (path.pathname.endsWith('/merge') && req.method === 'PUT') {
          await lab.git(f.own, 'fetch', f.bare, 'main');
          await lab.git(f.own, 'merge', '--no-ff', head, '-m', bump ? 'test: release merge' : 'test: ordinary merge');
          await lab.git(f.own, 'push', f.bare, 'HEAD:main'); res.end('{"merged":true}\n');
        } else { res.statusCode = 404; res.end('Unknown GitHub fixture endpoint'); }
      } catch (error) { res.statusCode = 500; res.end(error.message); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    h.env.OWNER_LAB_GITHUB = `http://127.0.0.1:${server.address().port}`;
    symlinkSync('/lab-tools/gh.mjs', join(lab.root, 'bin/gh'));
    const outcomes = [];
    try {
      for (const isBump of [false, true]) {
        bump = isBump;
        json(join(f.lot, 'package.json'), { name: 'published-fixture', version: bump ? '1.0.1' : '1.0.0', description: 'ordinary metadata change', nested: { version: '9.9.9' } });
        manifests.after = readFileSync(join(f.lot, 'package.json'), 'utf8');
        await lab.git(f.lot, 'add', 'package.json'); await lab.git(f.lot, 'commit', '-m', bump ? 'test: published bump' : 'test: manifest metadata');
        head = await lab.git(f.lot, 'rev-parse', 'HEAD'); diff = await lab.git(f.lot, 'diff', base, head);
        const command = 'gh pr merge 42 --repo github.com/fixture/own --merge';
        const result = await h.invoke({ tool_name: 'Bash', tool_input: { command } });
        outcomes.push({ bump, status: result.status, stdout: result.stdout, stderr: result.stderr });
        if (!bump && result.status === 0) await lab.run('gh', ['pr', 'merge', '42', '--repo', 'github.com/fixture/own', '--merge'], { env: h.env, cwd: f.lot });
        if (bump && result.status === 2 && result.stdout.includes('VERSION_BUMP')) {
          // The release lane uses an owner-signed, exact grant; the agent cannot mint it.
          const { privateKey, publicKey } = generateKeyPairSync('ed25519');
          const key = join(f.root, 'owner.pub'); writeFileSync(key, publicKey.export({ type: 'spki', format: 'pem' }));
          h.env.H2A_SCOPE_OWNER_KEY = key;
          const grant = { schema: 1, owner: 'owner:lab', workspace: f.lot, session: h.session, repo: 'github.com/fixture/own', action: 'release', ref: '42', expires: new Date(Date.now() + 60000).toISOString() };
          const state = join(f.lot, '.h2a/workspace-scope'); mkdirSync(state, { recursive: true });
          appendFileSync(join(state, 'grants.jsonl'), JSON.stringify({ grant, signature: sign(null, Buffer.from(JSON.stringify(grant)), privateKey).toString('base64') }) + '\n');
          await h.command(command);
        }
      }
      json(join(lab.evidence, 's2.json'), { calls, outcomes, base, head, remote: await lab.git(f.bare, 'rev-parse', 'main') });
      assert.equal(outcomes[0].status, 0, `Non-bump PR refused: ${code(outcomes[0])}`);
      assert.equal(outcomes[1].status, 2, 'Published bump must require release authorization');
      assert.match(outcomes[1].stdout, /VERSION_BUMP/);
      assert.ok(calls.some(c => c.url === '/repos/fixture/own/pulls/42'), 'REST pulls/<n> was not exercised');
      assert.equal(await lab.git(f.bare, 'show', 'main:package.json'), manifests.after.trim());
      return 's2.json: non-bump fusionné; bump bloqué puis fusionné par grant release';
    } finally { json(join(lab.evidence, 's2-api.json'), calls); await new Promise(done => server.close(done)); }
  });
  await scenario(3, 'Push après bumps upstream déjà publiés', async () => {
    const f = await fixture(lab, 's3'); const h = await hooks(lab, f);
    await h.command('git status --short');
    const baseline = await lab.git(f.lot, 'rev-parse', 'HEAD');
    json(join(f.own, 'package.json'), { name: 'published-fixture', version: '1.0.1' });
    await lab.git(f.own, 'add', 'package.json'); await lab.git(f.own, 'commit', '-m', 'test: upstream published release'); await lab.git(f.own, 'push', 'origin', 'main');
    const published = await lab.git(f.own, 'rev-parse', 'HEAD');
    await lab.git(f.lot, 'fetch', 'origin'); await lab.git(f.lot, 'merge', 'origin/main');
    writeFileSync(join(f.lot, 'source.txt'), 'ordinary work\n');
    await lab.git(f.lot, 'add', 'source.txt'); await lab.git(f.lot, 'commit', '-m', 'test: ordinary work after release');
    const command = 'git push origin HEAD:feature';
    const guarded = await h.invoke({ tool_name: 'Bash', tool_input: { command } });
    json(join(lab.evidence, 's3.json'), { baseline, published, head: await lab.git(f.lot, 'rev-parse', 'HEAD'), guarded });
    assert.equal(guarded.status, 0, `Published upstream bump blocks ordinary push: ${code(guarded)}`);
    await lab.run('/bin/sh', ['-c', command], { cwd: f.lot, env: h.env });
    assert.equal(await lab.git(f.bare, 'rev-parse', 'feature'), await lab.git(f.lot, 'rev-parse', 'HEAD'));
    // A fresh unpublished bump still must be refused after accepting upstream changes.
    json(join(f.lot, 'package.json'), { name: 'published-fixture', version: '1.0.2' });
    await lab.git(f.lot, 'add', 'package.json'); await lab.git(f.lot, 'commit', '-m', 'test: unpublished bump control');
    const denied = await h.invoke({ tool_name: 'Bash', tool_input: { command } });
    assert.equal(denied.status, 2); assert.match(denied.stdout, /VERSION_BUMP/);
    return 's3.json: push accepté; nouveau bump non publié refusé';
  });
  await scenario(4, 'Guard opt-in, protections et auto-protection', async () => {
    const defaultHooks = readJson(join(lab.core, 'hooks/hooks.json'));
    const active = Object.values(defaultHooks.hooks ?? {}).flatMap(rows => rows.flatMap(row => row.hooks ?? [])).filter(h => h.command?.includes('workspace-scope-guard'));
    const f = await fixture(lab, 's4');
    const defaultSettings = join(f.root, 'default-settings.json');
    await lab.cli(['host', 'plugin', '--host', 'claude', '--instance', 'default-s4', '--workspace', f.lot, '--write', defaultSettings], { cwd: f.lot });
    const defaultInstalled = readJson(defaultSettings);
    const h = await hooks(lab, f);
    const denied = await h.invoke({ tool_name: 'Edit', tool_input: { file_path: join(lab.core, 'hooks/workspace-scope-guard.mjs'), old_string: 'unused', new_string: 'modified' } });
    assert.equal(denied.status, 2); assert.match(denied.stdout, /OWNER_ONLY/);
    // Run the narrowly selected upstream guard suite against the INSTALLED hooks.
    const testRoot = join(lab.root, 'guard-tests'); mkdirSync(join(testRoot, 'packages/h2a/test'), { recursive: true });
    json(join(testRoot, 'package.json'), { type: 'module' });
    cpSync(join(lab.core, 'hooks'), join(testRoot, 'packages/h2a/hooks'), { recursive: true });
    // The internal suite's packaged-hook cases describe an explicitly enabled plugin.
    // Supply that opt-in manifest while preserving the candidate's default manifest separately.
    const command = 'node "${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT}}/hooks/workspace-scope-guard.mjs"';
    json(join(testRoot, 'packages/h2a/hooks/hooks.json'), { hooks: {
      SessionStart: [{ matcher: '.*', hooks: [{ type: 'command', command: command + ' --initialize-session true' }] }],
      PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command }] }],
    } });
    cpSync(join(lab.source, 'packages/h2a/test/workspace-scope-guard.test.js'), join(testRoot, 'packages/h2a/test/workspace-scope-guard.test.js'));
    const suite = await lab.run(process.execPath, ['--test', '--test-reporter=tap', 'packages/h2a/test/workspace-scope-guard.test.js'], { cwd: testRoot, env: lab.env, check: false, label: 's4-opt-in-suite' });
    json(join(lab.evidence, 's4.json'), { defaultGuardHooks: active, defaultInstalled, suiteStatus: suite.status, selfProtection: denied });
    const counts = safeCounts(suite.stdout + suite.stderr);
    json(join(lab.evidence, 's4.json'), { defaultGuardHooks: active, defaultInstalled, counts, selfProtection: denied });
    assert.equal(suite.status, 0);
    const installedDefaultGuard = JSON.stringify(defaultInstalled).includes('workspace-scope-guard');
    assert.ok(active.length === 0 && !installedDefaultGuard, `Workspace guard active by default: ${active.length} packaged hooks; host installer=${installedDefaultGuard}`);
    return `s4.json: défaut inactif, opt-in ${counts.pass} tests exécutés sans skip`;
  });
}
