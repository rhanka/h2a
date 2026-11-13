import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { environment, sourceBuild, cliPath, privateExecutable, compliantQualificationRoot } from './xcli-lab.mjs';
import { startupTerminal } from './xcli-terminal.mjs';

test('R36: the product submits one signed Muse wake instead of leaving a paste draft', async () => {
  const root = compliantQualificationRoot();
  let host, connection, session, terminal;
  try {
    const built = sourceBuild(root);
    const runtime = join(built.path, 'packages/h2a-runtime/dist');
    const product = join(built.path, 'packages/h2a/dist');
    const env = { ...environment(join(root, 'env')), H2A_NATIVE_SOCKET: join(root, 'h.sock') };
    const workspace = join(root, 'workspace');
    fs.mkdirSync(workspace); fs.mkdirSync(join(workspace, '.git'));
    const installed = cliPath('muse', process.env.PATH);
    assert.ok(installed, 'native Muse is mandatory for this local regression');
    const executable = privateExecutable('muse', installed, root);
    host = spawn(process.execPath, [join(runtime, 'native-terminal/process.js'),
      '--socket', env.H2A_NATIVE_SOCKET, '--generation', 'muse-wake-test',
      '--registry-path', join(root, 'host-registry.json')], { env, stdio: 'ignore' });
    const { NativeTerminalClient } = await import(pathToFileURL(join(runtime, 'native-terminal/client.js')));
    for (let i = 0; i < 100 && !connection; i++) {
      try { connection = await NativeTerminalClient.connect(env.H2A_NATIVE_SOCKET); } catch { await sleep(50); }
    }
    assert.ok(connection, 'private host starts');
    session = await connection.create({ id: 'muse-wake', command: executable.path,
      args: ['--provider', 'echo', '--trust-workspace', '--no-session-log', 'initial-marker'],
      cwd: workspace, env, cols: 140, rows: 40 });
    terminal = startupTerminal();
    let sequence = 0;
    const capture = async () => {
      const replay = await connection.readOutput(session.id, sequence);
      for (const chunk of replay.chunks) { sequence = chunk.seq; await terminal.write(chunk.data); }
      return terminal.screen();
    };
    const startup = await connection.acquireController(session.id, 'fixture-startup', 'automation');
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const screen = await capture();
      for (const reply of terminal.responses()) await connection.write(startup, reply);
      if (screen.includes('echo: initial-marker')) { ready = true; break; }
      await sleep(50);
    }
    await connection.releaseController(startup);
    terminal.freeze();
    assert.ok(ready, 'native echo provider finishes its initial turn without credentials');
    await sleep(2000);
    // Exercise the complete product CLI -> native op -> real Muse path.
    // Keys and registrations here are synthetic and live only in this test.
    const setup = `import {generateKeyPairSync} from 'node:crypto';import fs from 'node:fs';
import {createLocalStore} from ${JSON.stringify(pathToFileURL(join(product, 'index.js')).href)};
import {enroll} from ${JSON.stringify(pathToFileURL(join(runtime, 'registry.js')).href)};
const keys=generateKeyPairSync('ed25519');
fs.writeFileSync(${JSON.stringify(join(root, 'signer.pem'))},keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
createLocalStore({root:process.env.H2A_ROOT}).registerInstance({id:'muse:receiver',instance:'muse:receiver',
roles:['AGENTS'],scopes:['scope:fixture'],capabilities:['execute'],endpoints:[],acceptedPolicies:[],
publicKeys:[keys.publicKey.export({type:'spki',format:'pem'})],createdAt:new Date().toISOString()});
enroll({id:'receiver',label:'receiver',tool:'muse',kind:'local-native',cwd:${JSON.stringify(workspace)},
tmuxSession:'muse-wake',source:'run',sessionClass:'human'});`;
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', setup], {
      env, cwd: workspace, encoding: 'utf8', timeout: 10000,
    }).status, 0, 'synthetic signing and routing fixture initializes');
    const driven = spawnSync(process.execPath, [join(product, 'bin.js'), 'drive',
      '--root', env.H2A_ROOT, '--from', 'muse:receiver', '--to', 'muse:receiver',
      '--host', 'muse', '--instruction', 'wake-marker '.repeat(40),
      '--private-key', join(root, 'signer.pem'), '--driver', 'native'], {
      env, cwd: workspace, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(driven.status, 0, 'signed product drive succeeds');
    assert.equal(JSON.parse(driven.stdout).driven, true);
    let submitted = false, draft = false;
    for (let i = 0; i < 100; i++) {
      const screen = await capture();
      draft = /Pasted Content/.test(screen);
      if (/echo: \[h2a from=/.test(screen)) { submitted = true; break; }
      await sleep(50);
    }
    assert.equal(submitted, true, `one signed wake must start an echo turn; pasteDraft=${draft}`);
    assert.equal(draft, false);
    assert.equal((terminal.screen().match(/echo: \[h2a from=/g) ?? []).length, 1);
  } finally {
    try {
      if (connection && session) await connection.stopIfIncarnation(session.id, session.generation, session.incarnation, 'SIGKILL');
    } finally {
      connection?.close(); terminal?.dispose();
      try {
        if (host && host.exitCode === null && host.signalCode === null) { host.kill('SIGKILL'); await once(host, 'close'); }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  }
});
