import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventually, json, readJson, pause, readable } from './support.mjs';

async function nativeFixture(lab, name, previous = false) {
  const dir = join(lab.root, name); mkdirSync(dir, { mode: 0o700 });
  const socket = join(dir, 'n.sock');
  assert.ok(Buffer.byteLength(socket) < 104, `Unix socket path too long: ${socket}`);
  const runtime = previous ? join(lab.root, 'previous/node_modules/@sentropic/h2a-runtime') : lab.runtime;
  const host = lab.start(process.execPath, [join(runtime, 'dist/native-terminal/process.js'), '--socket', socket,
    '--generation', name, '--replay-bytes', '1048576', '--registry-path', join(dir, 'host-registry.json')]);
  const { NativeTerminalClient } = await import(pathToFileURL(join(lab.runtime, 'dist/native-terminal/client.js')));
  const client = await eventually(async () => {
    if (!existsSync(socket)) return;
    try { return await NativeTerminalClient.connect(socket); } catch { return; }
  }, Boolean, `Native host ${name}: ${host.output.stderr}`, 15000);
  const env = { ...lab.env, H2A_NATIVE_SOCKET: socket };
  const sessions = [];
  return { dir, socket, host, client, env, sessions,
    async create(label, { profile = 'codex', background = false, job = false, sameProject = false } = {}) {
      const id = `h2a-${label}`;
      const cwd = join(lab.env.HOME, 'src', sameProject ? name : label); mkdirSync(cwd, { recursive: true });
      const statePath = join(dir, `${label}.json`);
      const state = await client.create({ id, command: process.execPath, args: ['/lab-tools/tui.mjs', statePath], cwd, env, cols: 120, rows: 30 });
      await eventually(() => existsSync(statePath) && readJson(statePath), Boolean, 'Readline fixture ready');
      const ttys = [0, 1, 2].map(fd => readlinkSync(`/proc/${state.pid}/fd/${fd}`));
      assert.ok(ttys.every(p => /^\/dev\/pts\/\d+$/.test(p)), 'Expected real native PTY');
      const session = { id, label, cwd, statePath, state, profile, background, job, ttys,
        ...(label === 'human-one' ? { convId: 'e626e60f-36d0-48ef-8473-61201c492cf5' } : {}) };
      sessions.push(session);
      return session;
    },
    async close() { client.close(); await lab.stop(host); json(join(lab.evidence, `${name}-host.json`), host.output); },
  };
}

async function mcp(lab, f, session) {
  const child = lab.start(process.execPath, [join(lab.core, 'dist/bin.js'), 'mcp-serve', '--root', lab.env.H2A_ROOT,
    '--auto-open', '--host', session.profile, '--wake', 'auto'], {
    cwd: session.cwd, env: { ...f.env, H2A_NATIVE_TARGET_SESSION: session.id, GIT_CEILING_DIRECTORIES: lab.env.HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const replies = new Map(); let buffer = '', seq = 0;
  child.stdout.on('data', b => {
    buffer += b;
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const msg = JSON.parse(line); if (msg.id !== undefined) replies.set(msg.id, msg); } catch { /* stdout evidence retained */ }
    }
  });
  async function rpc(method, params) {
    const id = ++seq; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const response = await eventually(() => replies.get(id), Boolean, `MCP ${method}: ${child.output.stderr}`, 20000);
    assert.equal(response.error, undefined, JSON.stringify(response.error)); return response.result;
  }
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'owner-lab', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const call = async (name, args) => {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const identity = await eventually(() => call('h2a_identity_status', {}), x => x.state === 'identity_ready', 'MCP identity', 25000);
  await eventually(() => child.output.stderr, x => x.includes('inbox-wake armed'), 'MCP inbox wake arming');
  return { child, identity, call, async close() {
    child.stdin.end(); await lab.stop(child); json(join(lab.evidence, `${session.label}-mcp.json`), child.output);
  } };
}

async function enroll(lab, f) {
  Object.assign(process.env, f.env);
  const module = await import(pathToFileURL(join(lab.runtime, 'dist/registry.js')));
  const path = join(lab.env.REMOTE_CLI_CONFIG_HOME, '.config/sentropic/remote-cli/registry.json');
  for (const s of f.sessions) module.enroll({ id: s.label, label: s.label, tool: s.profile, kind: 'local-native',
    cwd: s.cwd, tmuxSession: s.id, source: 'run', gatewayMode: 'direct',
    ...(s.convId ? { convId: s.convId } : {}),
    ...(s.job ? { sessionClass: 'background', role: 'job', jobState: 'running' } : s.background ? { sessionClass: 'background' } : { sessionClass: 'human' }),
  }, path);
  return path;
}

async function terminalAdapter(lab, f) {
  for (const file of ['terminal-ready.json', 'terminal-windows.json']) rmSync(join(lab.root, file), { force: true });
  const child = lab.start(process.execPath, ['/lab-tools/terminal.mjs', '--serve'], { env: { ...f.env, OWNER_LAB_CORE: lab.core,
    OWNER_LAB_TERMINAL_EVIDENCE: join(lab.evidence, f.dir.split('/').at(-1) + '-terminals.json') } });
  child.stderr.on('data', () => json(join(lab.evidence, f.dir.split('/').at(-1) + '-terminal-daemon.json'), child.output));
  const ready = await eventually(() => existsSync(join(lab.root, 'terminal-ready.json')) && readJson(join(lab.root, 'terminal-ready.json')), Boolean, `Private terminal adapter: ${child.output.stderr}`);
  return { child, url: ready.url, async write(session, data) {
    const r = await fetch(ready.url + '/write', { method: 'POST', body: JSON.stringify({ session, data }) });
    assert.ok(r.ok, await r.text());
  } };
}

export async function nativeScenarios(lab, scenario) {
  await scenario(5, 'Send attaché et brouillon humain préservé', async () => {
    const f = await nativeFixture(lab, 's5'); const peers = []; let terminal;
    try {
      const left = await f.create('sender'), right = await f.create('recipient');
      await enroll(lab, f);
      const a = await mcp(lab, f, left); peers.push(a);
      const b = await mcp(lab, f, right); peers.push(b);
      terminal = await terminalAdapter(lab, f);
      const map = join(f.dir, 'attached-window.map');
      writeFileSync(map, `${right.cwd}\th2a attach '${right.id}'\n`);
      const opened = await fetch(terminal.url + '/open', { method: 'POST', body: JSON.stringify(['--window', '--', 'bash', '-lc', 'unused', 'owner-lab', map]) });
      assert.ok(opened.ok, await opened.text());
      await eventually(() => f.client.state(right.id), x => x.controlled === true, 'Recipient window attached through h2a attach');
      assert.equal((await f.client.state(right.id)).controlled, true);
      const core = await import(pathToFileURL(join(lab.core, 'dist/index.js')));
      const store = core.createLocalStore({ root: lab.env.H2A_ROOT });
      const send = message => lab.cli(['send', b.identity.instance, message, '--from', a.identity.instance, '--root', lab.env.H2A_ROOT], { cwd: left.cwd, env: f.env, label: `s5-send-${message}` });
      // Both idle-attached wake and a draft under the same live controller must work.
      const failures = [];
      for (const draft of ['', 'human draft with spaces — do not overwrite']) {
        if (draft) {
          await terminal.write(right.id, draft);
          await eventually(() => readJson(right.statePath).draft, x => x === draft, 'Human draft typed');
        }
        const before = readJson(right.statePath).lines.length;
        const receipt = await send(draft ? 'draft' : 'idle');
        const envelope = JSON.parse(receipt.stdout).envelope;
        assert.ok(envelope, 'CLI did not return its sent envelope');
        assert.deepEqual(store.readInbox(b.identity.instance).at(-1), envelope, 'Durable envelope not delivered');
        assert.ok(store.listInstanceKeys(a.identity.instance).some(key => core.verifyEnvelopeSignature(envelope, key, { by: a.identity.instance })), 'Message signature invalid');
        try {
          await eventually(() => readJson(right.statePath), x => x.lines.slice(before).some(line => line.includes('h2a-wake')), 'Attached recipient wake line', 5000);
          const state = readJson(right.statePath);
          const newLines = state.lines.slice(before);
          assert.equal(newLines.length, 1, 'Wake duplicated or inserted an extra submission');
          const parsed = core.parseSignedDriveInstruction(newLines[0]);
          assert.ok(parsed, 'Wake was not a signed drive instruction');
          assert.equal(parsed.payload.to, b.identity.instance);
          assert.match(parsed.payload.instruction, new RegExp('h2a-wake reason=inbox from=' + a.identity.instance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
          assert.ok(core.verifySignedDriveInstruction(newLines[0], { resolvePublicKeys: instance => store.listInstanceKeys(instance), guard: core.createReplayGuard(), now: Date.parse(parsed.payload.at) }).ok, 'Wake signature invalid');
          assert.equal(state.draft, draft, 'Human draft was overwritten');
          assert.ok(state.lines.slice(before).every(line => !draft || !line.includes(draft)), 'Human draft submitted by automation');
          assert.equal((await f.client.state(right.id)).controlled, true, 'Human window detached by wake');
          await terminal.write(right.id, 'x\u007f');
          await eventually(() => readJson(right.statePath).draft, x => x === draft, 'Original human window still accepts input');
        } catch (error) { failures.push(error.message); }
        json(join(lab.evidence, `s5-${draft ? 'draft' : 'idle'}.json`), { receipt, attached: await f.client.state(right.id), tui: readJson(right.statePath), failures: [...failures] });
        assert.ok(store.popInboxMessage(b.identity.instance, envelope.id));
        await pause(100);
      }
      assert.deepEqual(failures, []);
      return 's5-idle.json + s5-draft.json: wake reçu avec contrôleur humain et brouillon intact';
    } finally { if (terminal) await lab.stop(terminal.child); for (const peer of peers.reverse()) await peer.close(); await f.close(); }
  });
  let upgrade;
  await scenario(6, 'Restore après upgrade, sans doublon ni délégué', async () => {
    const f = await nativeFixture(lab, 's6', true);
    let terminal;
    try {
      const one = await f.create('human-one', { sameProject: true });
      const two = await f.create('human-two', { sameProject: true, profile: 'claude' });
      await f.create('delegated-job', { sameProject: true, job: true });
      await f.create('background-worker', { sameProject: true, background: true });
      await enroll(lab, f);
      const before = await f.client.list(), ping = await f.client.ping();
      // Run candidate upgrade code (not the previous release's command).
      upgrade = await lab.cli(['upgrade', '--host', 'codex', '--root', lab.env.H2A_ROOT], { cwd: one.cwd, env: f.env, check: false, timeout: 240000, label: 's6-upgrade' });
      json(join(lab.evidence, 's6-upgrade-state.json'), { status: upgrade.status, beforeVersion: readJson(join(lab.root, 'manifests.json')).find(m => m.manifest.name === '@sentropic/h2a').manifest.version,
        installedVersion: readJson(join(lab.core, 'package.json')).version });
      assert.equal(upgrade.status, 0, upgrade.stderr + upgrade.stdout);
      assert.equal(readJson(join(lab.core, 'package.json')).version, '9999.0.0', 'Real staging/swap did not install the future fixture');
      terminal = await terminalAdapter(lab, f);
      const env = { ...f.env, OWNER_LAB_TERMINAL: terminal.url };
      symlinkSync('/lab-tools/terminal.mjs', join(lab.root, 'bin/gnome-terminal'));
      const restored = await lab.cli(['restore', '--no-gw'], { cwd: one.cwd, env, label: 's6-restore', timeout: 30000 });
      await eventually(() => f.client.list(), rows => [one, two].every(s => rows.some(r => r.id === s.id && r.controlled === true)), 'Restored human controllers', 10000);
      const windows = readJson(join(lab.root, 'terminal-windows.json'));
      assert.deepEqual(windows.map(w => w.session).sort(), [one.id, two.id].sort(), 'Delegated/missing/duplicate restore');
      for (const s of [one, two]) {
        const marker = `resume-in-place-${s.id}`;
        await terminal.write(s.id, marker + '\r');
        await eventually(() => readJson(s.statePath).lines, lines => lines.includes(marker), 'Resumed CLI I/O');
      }
      const again = await lab.cli(['restore', '--no-gw'], { cwd: one.cwd, env, label: 's6-restore-again', timeout: 30000 });
      await pause(200);
      assert.equal(readJson(join(lab.root, 'terminal-windows.json')).length, 2, 'Second restore duplicated windows');
      const after = await f.client.list(), afterPing = await f.client.ping();
      assert.equal(afterPing.hostPid, ping.hostPid); assert.equal(afterPing.generation, ping.generation);
      const identities = rows => rows.map(s => ({ id: s.id, pid: s.pid, incarnation: s.incarnation })).sort((a,b) => a.id.localeCompare(b.id));
      assert.deepEqual(identities(after), identities(before), 'CLI was restarted or duplicated');
      json(join(lab.evidence, 's6.json'), { previousHost: lab.previous, before, after, ping, afterPing, windows, restored, again });
      readable(restored.stdout + restored.stderr); readable(again.stdout + again.stderr);
      return 's6.json: 2 CLIs repris en place; 2 délégués exclus; second restore sans doublon';
    } finally { if (terminal) await lab.stop(terminal.child); await f.close(); }
  });
  await scenario(7, 'Sortie upgrade lisible avec convergence des hosts', async () => {
    assert.ok(upgrade, 'No actual candidate upgrade command executed');
    assert.equal(upgrade.status, 0, 'Upgrade itself failed; output cannot qualify');
    readable(upgrade.stdout + upgrade.stderr);
    assert.ok((upgrade.stdout + upgrade.stderr).split('\n').every(line => line.length <= 300), 'Upgrade output has an unreadable long line');
    assert.match(upgrade.stdout + upgrade.stderr, /9999\.0\.0/);
    return 's6-upgrade.log: staging/swap + doctor, texte lisible sans JSON échappé';
  });
}
