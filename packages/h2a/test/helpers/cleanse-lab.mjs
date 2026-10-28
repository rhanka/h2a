// Extends restart-lab's confinement/process-generation pattern to two canonical
// endpoints and the installed candidate. Only the vendor and GUI are fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isolatedEnv, json } from './cleanse-artifact.mjs';

const dead = 2147483647; // Outside Linux pid_max, never an unrelated live process.
export async function eventually(read, predicate, ms = 5000) {
  const end = Date.now() + ms;
  let last;
  do {
    try { last = await read(); if (predicate(last)) return last; } catch (e) { last = e.message; }
    await pause(20);
  } while (Date.now() < end);
  assert.fail('Fixture readiness: ' + JSON.stringify(last));
}

export async function lab(t, artifact) {
  const root = mkdtempSync(join(tmpdir(), 'r-'));
  const env = isolatedEnv(root);
  env.XDG_RUNTIME_DIR = root;
  env.H2A_TEST_PROC_ROOT = join(root, 'proc');
  env.H2A_SESSION_HOST = 'native';
  env.TERM = 'xterm-256color';
  env.TMUX = '';
  env.TMUX_TMPDIR = root;
  env.LAB_PIDS = join(root, 'pids');
  mkdirSync(env.H2A_TEST_PROC_ROOT);
  env.NODE_OPTIONS = '--import=' + pathToFileURL(join(root, 'track.mjs')).href;
  writeFileSync(join(root, 'track.mjs'), `import {appendFileSync,readFileSync,symlinkSync} from 'node:fs';
    const start=readFileSync('/proc/self/stat','utf8').split(') ')[1].split(' ')[19];
    appendFileSync(process.env.LAB_PIDS,JSON.stringify({pid:process.pid,start,args:process.argv})+'\\n');
    try{symlinkSync('/proc/'+process.pid,process.env.H2A_TEST_PROC_ROOT+'/'+process.pid)}catch(e){if(e.code!=='EEXIST')throw e}
  `);
  writeFileSync(join(root, 'agent.mjs'), `import {appendFileSync} from 'node:fs';
    const args=process.argv.slice(2), i=args.indexOf('resume'), id=i<0?'fresh':args[i+1];
    appendFileSync(process.env.HOME+'/transcripts',JSON.stringify({id,pid:process.pid})+'\\n');
    process.stdout.write('agent-ready:'+id+'\\n');
    process.stdin.on('data',b=>process.stdout.write('ack:'+b));
    setInterval(()=>{},1000);
  `);
  writeFileSync(join(root, 'bin/codex'), `#!/bin/sh\nexec '${process.execPath}' '${join(root, 'agent.mjs')}' "$@"\n`, { mode: 0o700 });
  writeFileSync(join(env.HOME, '.bash_profile'), `export PATH='${env.PATH}'\n`);
  const children = [];
  function start(args, entry = artifact.cli, extra = {}) {
    const child = spawn(process.execPath, [entry, ...args], { cwd: env.HOME, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
    return { child, done, output: () => ({ stdout, stderr }) };
  }
  const recorded = () => existsSync(env.LAB_PIDS) ? readFileSync(env.LAB_PIDS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  t.after(async () => {
    for (const { pid, start } of recorded().reverse()) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
        if (stat[19] === start && !['Z', 'X'].includes(stat[0])) process.kill(pid, 'SIGKILL');
      } catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e; }
    }
    await Promise.all(children.map(c => c.exitCode === null && c.signalCode === null ? once(c, 'close') : undefined));
    await eventually(() => recorded().every(({ pid, start }) => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
        return stat[19] !== start || ['Z', 'X'].includes(stat[0]);
      } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
    }), Boolean);
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  const { NativeTerminalClient } = await import(pathToFileURL(join(artifact.runtime, 'native-terminal/client.js')));
  const { readBootId, readMachineId, readPidNamespaceId } = await import(pathToFileURL(join(artifact.runtime, 'proc-identity.js')));
  const frame = { pgidBootId: '00000000-0000-4000-8000-000000000000', pgidMachineId: readMachineId(), pgidPidNamespace: readPidNamespaceId() };
  assert.ok(frame.pgidMachineId && frame.pgidPidNamespace);
  assert.notEqual(frame.pgidBootId, readBootId());
  const nt = join(root, 'h2a-nt');
  mkdirSync(nt, { mode: 0o700 });
  const lockId = join(nt, '.h2a-native-terminal.lock-id');
  writeFileSync(lockId, randomUUID(), { mode: 0o600 });
  const lockBefore = { bytes: readFileSync(lockId, 'utf8'), ino: lstatSync(lockId).ino };
  const sockets = ['native-terminal.sock', 'native-terminal.lf1.sock'].map(n => join(nt, n));
  const config = join(env.HOME, '.config/sentropic/h2a');
  mkdirSync(config, { recursive: true });
  const registry = join(config, 'registry.json');
  const row = (id, sessionClass = 'human') => ({
    id, tool: 'codex', kind: 'local-native', cwd: env.HOME, tmuxSession: 'h2a-' + id,
    label: id, convId: randomUUID(), source: 'run', sessionClass,
    enrolledAt: '2026-10-28T00:00:00.000Z', lastSeenAt: '2026-10-28T00:00:00.000Z', bare: true, gatewayMode: 'direct',
  });
  const saved = [row('human-kept'), { ...row('unclassified-kept'), sessionClass: undefined }, row('background-dead', 'background')];
  Object.assign(saved[2], { ownerHostPid: dead, ownerHostStartTime: 1, ownerHostSocketPath: sockets[0], ...frame });
  const pgids = sockets.map((socket, i) => ({ ...row('pgid-' + i, 'background'), id: 'native-terminal-pty:old-' + i, kind: 'local',
    pgid: dead, pgidLeaderStartTime: 1, ownerHostPid: dead, ownerHostStartTime: 1, ownerHostSocketPath: socket, ...frame }));
  const save = rows => writeFileSync(registry, JSON.stringify({ version: 1, entries: [...rows, ...pgids] }));
  save(saved);
  const maps = join(root, 'sentropic-remote');
  mkdirSync(maps);
  const map = join(maps, `restore-${dead}-old-0.map`);
  writeFileSync(map, env.HOME + '\th2a run codex ' + env.HOME + ' --resume ' + randomUUID() + '\n');
  writeFileSync(map + '.lock', ''); // flock lockfile, not JSON.
  writeFileSync(map + '.tmp', readFileSync(map));
  const claims = join(config, 'resume-launch-claims');
  mkdirSync(claims);
  const seedClaim = (convId, barrier = false) => {
    const key = createHash('sha256').update(convId).digest('hex'), token = randomUUID();
    const path = join(claims, key + '.claim');
    writeFileSync(path, JSON.stringify({ token, pid: dead, convId }), { mode: 0o600 });
    if (barrier) linkSync(path, path + '.reclaim'); // Legacy unattributed barrier MUST be retained/refused.
    writeFileSync(join(claims, '.' + key + '.' + token + '.pending'), readFileSync(path), { mode: 0o600 });
    return path;
  };
  const deadClaimId = randomUUID(), barrierId = randomUUID();
  const deadClaim = seedClaim(deadClaimId), barrier = seedClaim(barrierId, true);
  const deadClaimBytes = readFileSync(deadClaim, 'utf8');
  mkdirSync(join(env.H2A_ROOT, 'identity'), { recursive: true });
  mkdirSync(join(env.H2A_ROOT, 'presence'), { recursive: true });
  const debris = [
    join(env.H2A_ROOT, 'identity/.lock.tmp.' + dead),
    join(env.H2A_ROOT, 'presence/old.json.tmp-' + dead + '-1-abcdef'),
    join(config, 'registry.json.tmp.' + dead),
  ];
  debris.forEach(p => writeFileSync(p, '{')); // Interrupted writes; uncertain legacy debris is retained.
  const transcripts = () => existsSync(join(env.HOME, 'transcripts')) ? readFileSync(join(env.HOME, 'transcripts'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  async function usable(socket, id) {
    const client = await eventually(() => NativeTerminalClient.connect(socket), Boolean);
    try {
      await eventually(() => client.readOutput(id, 0), r => r.chunks.some(c => c.data.includes('agent-ready:')));
      const lease = await client.acquireController(id, 'cleanse-l0');
      try {
        await client.write(lease, 'cleanse-io\n');
        await eventually(() => client.readOutput(id, 0), r => r.chunks.some(c => c.data.includes('ack:cleanse-io')));
      } finally { await client.releaseController(lease); }
    } finally { client.close(); }
  }
  async function inventory() {
    return Promise.all(sockets.map(async socket => {
      const client = await NativeTerminalClient.connect(socket);
      try { return { socket, ping: await client.ping(), sessions: await client.list() }; }
      finally { client.close(); }
    }));
  }
  function preserve() {
    assert.deepEqual({ bytes: readFileSync(lockId, 'utf8'), ino: lstatSync(lockId).ino }, lockBefore, 'stable lock-id must not rotate');
    const rows = json(registry).entries;
    for (const id of ['human-kept', 'unclassified-kept']) assert.ok(rows.some(r => r.id === id), id + ' must survive');
    assert.equal(lstatSync(barrier).ino, lstatSync(barrier + '.reclaim').ino, 'unattributed legacy barrier must survive');
    debris.forEach(p => assert.ok(existsSync(p), 'uncertain old-format debris is retained'));
  }
  return { root, env, start, recorded, row, saved, save, sockets, registry, config, map, deadClaimId, deadClaim, deadClaimBytes, barrierId, barrier,
    lockId, lockBefore, NativeTerminalClient, usable, inventory, transcripts, preserve };
}

export function files(root) {
  const out = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, e.name);
    if (e.isDirectory()) out.push(...files(path));
    else if (!e.isSymbolicLink()) out.push(path);
  }
  return out;
}

export function gui(f, artifact) {
  writeFileSync(join(f.root, 'bin/flock'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/flock-calls"\nexec /usr/bin/flock "$@"\n', { mode: 0o700 });
  writeFileSync(join(f.root, 'bin/h2a'), `#!/bin/sh\nexec '${process.execPath}' '${artifact.cli}' "$@" --background --no-attach --no-h2a\n`, { mode: 0o700 });
  writeFileSync(join(f.root, 'terminal.mjs'), `import {spawn} from 'node:child_process';import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
    import {NativeTerminalClient} from ${JSON.stringify(pathToFileURL(join(artifact.runtime, 'native-terminal/client.js')).href)};
    const args=process.argv.slice(2), sep=args.indexOf('--');
    if(sep<0)throw Error('missing dispatcher');
    const sockets=${JSON.stringify(f.sockets)}, ready=[];
    for(const socket of sockets){let client;try{client=await NativeTerminalClient.connect(socket);await client.ping();ready.push(true)}catch{ready.push(false)}finally{client?.close()}}
    writeFileSync(process.env.HOME+'/before-dispatch',JSON.stringify({ready}));
    appendFileSync(process.env.HOME+'/gui-args',JSON.stringify(args)+'\\n');
    for(const arg of args.slice(0,sep).filter(a=>a.startsWith('--working-directory='))){
      const child=spawn(args[sep+1],args.slice(sep+2),{cwd:arg.slice('--working-directory='.length),env:process.env,stdio:'ignore'});
      const start=readFileSync('/proc/'+child.pid+'/stat','utf8').split(') ')[1].split(' ')[19];
      appendFileSync(process.env.LAB_PIDS,JSON.stringify({pid:child.pid,start,args:args.slice(sep+1)})+'\\n');
      child.on('exit',code=>{if(code)process.exitCode=code;});
    }
  `);
  writeFileSync(join(f.root, 'bin/gnome-terminal'), `#!/bin/sh\nexec '${process.execPath}' '${join(f.root, 'terminal.mjs')}' "$@"\n`, { mode: 0o700 });
}
