import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const native = createRequire(import.meta.url)(join(process.env.SPIKE_BUILD, 'native.node'));
const old = process.argv[2] === 'old';
const owner = old ? 1 : 2;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const sessions = new Map(), guardians = new Map();
const emit = (event, values = {}) => process.send({ event, owner, ...values });
const reply = (request, value) => process.send({ reply: request, value });
let created = 0, stopping = false;

function register(s) {
  sessions.set(s.id, s);
  if (!s.reaped) guardians.set(s.guardian, s.id);
}
function write(s, data) {
  s.writes.push({ data: Buffer.from(data).toString('base64'), offset: 0 });
}
function pumpSession(s) {
  if (s.frozen) return;
  while (s.writes.length) {
    const pending = s.writes[0], data = Buffer.from(pending.data, 'base64');
    let count;
    try { count = native.write(s.master, data.subarray(pending.offset)); }
    catch (error) {
      if (!/Input\/output error/.test(error.message)) throw error;
      emit('write-failed', { id: s.id, error: error.message });
      s.writes.length = 0;
      break;
    }
    pending.offset += count;
    if (pending.offset === data.length) s.writes.shift();
    if (!count) break;
  }
  if (!s.eof) for (let i = 0; i < 16; i++) {
    const data = native.read(s.master);
    if (data === null) break;
    if (!data.length) { s.eof = true; emit('terminal-eof', { id: s.id }); break; }
    emit('output', { id: s.id, data: data.toString('base64') });
  }
  if (!s.controlEof) for (let i = 0; i < 8; i++) {
    const data = native.read(s.control);
    if (!data) break;
    if (!data.length) { s.controlEof = true; break; }
    s.controlText = (s.controlText ?? '') + data.toString();
    let cut;
    while ((cut = s.controlText.indexOf('\n')) >= 0) {
    const status = JSON.parse(s.controlText.slice(0, cut));
    s.controlText = s.controlText.slice(cut + 1);
    if (status.type === 'born') { s.pid = status.pid; emit('born', { id: s.id, ...status }); }
    if (status.type === 'exit') {
      s.exit = status;
      if (process.env.SPIKE_DISABLE_EXIT_CHANNEL !== '1') {
        emit('exit', { id: s.id, ...status, ownerWait: native.wait(status.pid).pid });
      }
      // Status is recorded in the receiving JS owner before the guardian may exit.
      try { native.send(s.control, 'A', []); }
      catch (error) {
        // A guardian confining a dead/closed session may already have exited.
        if (!/Broken pipe/.test(error.message)) throw error;
      }
    }
    }
  }
}
function reap() {
  for (const [pid, id] of guardians) {
    const result = native.wait(pid);
    if (result && result.pid > 0) {
      guardians.delete(pid);
      const s = sessions.get(id);
      if (s) s.reaped = result;
      emit('guardian-reaped', { id, ...result });
    } else if (result?.pid === -1 && sessions.get(id)?.controlEof) {
      // Migrated guardians are not our children (on either OS). Their CLI
      // wait status already arrived over the control stream. launchd or the
      // test-only Linux supervisor collects the guardian itself.
      guardians.delete(pid);
    }
  }
}
function closeSession(s) {
  native.close(s.master);
  native.close(s.control);
}

let transferFd, child, childGone = old;
const pending = new Map();
let serial = 0;
function workerRpc(op, values = {}) {
  return new Promise((resolve, reject) => {
    const request = ++serial;
    pending.set(request, { resolve, reject });
    child.send({ request, op, ...values });
  });
}
const routes = new Map(), queued = new Map(), staged = new Map(), outgoing = new Map();
if (old) transferFd = 3;
else {
  const pair = native.pair();
  transferFd = pair[0];
  child = fork(fileURLToPath(import.meta.url), ['old'], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe', pair[1], 'ipc'],
  });
  native.close(pair[1]);
  child.stdout.on('data', data => emit('diagnostic', { data: data.toString() }));
  child.stderr.on('data', data => emit('diagnostic', { data: data.toString() }));
  child.on('message', message => {
    if (message.reply) {
      const p = pending.get(message.reply); pending.delete(message.reply);
      if (message.error) p?.reject(new Error(message.error)); else p?.resolve(message.value);
    } else if (message.type === 'commit') {
      const batch = staged.get(message.batch);
      if (!batch) throw new Error('commit without prepared batch');
      for (const s of batch.sessions) {
        register(s); routes.set(s.id, 2);
        for (const data of queued.get(s.id) ?? []) write(s, data);
        queued.delete(s.id);
      }
      staged.delete(message.batch);
      emit('batch', { batch: message.batch, ids: batch.sessions.map(s => s.id),
        ms: now() - batch.started, stageMs: now() - batch.received,
        sendMs: message.sendMs, payloadBytes: message.payloadBytes,
        fdCount: batch.sessions.length * 2 });
    } else if (message.event) {
      if (message.event === 'guardian-reaped') guardians.delete(message.pid);
      process.send(message);
    }
  });
  child.on('exit', (code, signal) => {
    childGone = true;
    emit('old-exit', { pid: child.pid, code, signal });
    for (const p of pending.values()) p.reject(new Error(`old owner exited: ${code}/${signal}`));
    pending.clear();
  });
  emit('owners', { oldPid: child.pid, newPid: process.pid });
}

function receiveOffers() {
  if (old) return;
  for (let i = 0; i < 8; i++) {
    const packet = native.receive(transferFd);
    if (!packet || !packet.text) return;
    const offer = JSON.parse(packet.text);
    if (packet.fds.length !== offer.sessions.length * 2) throw new Error('bad transfer FD count');
    const ss = offer.sessions.map((meta, k) => ({ ...meta, frozen: false,
      master: packet.fds[2 * k], control: packet.fds[2 * k + 1] }));
    if (offer.fault === 'reject') {
      setTimeout(() => {
        for (const s of ss) closeSession(s);
        child.send({ type: 'abort', batch: offer.batch });
      }, offer.stageDelay);
      continue;
    }
    staged.set(offer.batch, { sessions: ss, started: offer.started, received: now() });
    emit('staged', { batch: offer.batch, ids: ss.map(s => s.id) });
    // No staged reader runs during this window. Output accumulates in the kernel.
    setTimeout(() => child.send({ type: 'prepared', batch: offer.batch }), offer.stageDelay);
  }
}

async function command(message) {
  const { op, id, data } = message;
  if (op === 'create') {
    if (!old) {
      const result = await workerRpc(op, message.values);
      routes.set(result.id, 1); guardians.set(result.guardian, result.id);
      return result;
    }
    const cli = message.kind === 'bash'
      ? ['/bin/bash', '--noprofile', '--norc', '-i']
      : [process.execPath, fileURLToPath(new URL('fixture.mjs', import.meta.url)), id];
    const handles = native.start([join(process.env.SPIKE_BUILD, 'guardian'),
      process.env.SPIKE_LEGACY_PARENT_DEATH ?? '0', String(process.pid), ...cli]);
    const s = { ...handles, id, writes: [], frozen: false };
    register(s); created++;
    return { id, ...handles };
  }
  if (op === 'write') {
    if (old || routes.get(id) === 2) { write(sessions.get(id), data); return true; }
    if (routes.get(id) === 'moving') { queued.get(id).push(data); return true; }
    return workerRpc(op, { id, data });
  }
  if (op === 'resize') {
    if (old || routes.get(id) === 2) { native.resize(sessions.get(id).master, message.rows, message.cols); return true; }
    return workerRpc(op, { id, rows: message.rows, cols: message.cols });
  }
  if (op === 'move') {
    const batch = `batch-${++serial}`;
    for (const key of message.ids) {
      if (routes.get(key) !== 1) throw new Error('session is not with owner 1');
    }
    for (const key of message.ids) { routes.set(key, 'moving'); queued.set(key, []); }
    const started = now();
    const result = await workerRpc('freeze', { batch, ids: message.ids, fault: message.fault,
      stageDelay: message.stageDelay ?? 25, started });
    if (!result.ok) {
      for (const key of message.ids) {
        // Fault-injection window for inputs arriving while rollback drains.
        if (message.abortDrainDelay) await new Promise(resolve => setTimeout(resolve, message.abortDrainDelay));
        // Keep accepting new inputs into this live queue until every earlier
        // item has been forwarded. Publishing route 1 before the awaited
        // drain lets fresh writes overtake the queued prefix.
        for (const value of queued.get(key)) await workerRpc('write', { id: key, data: value });
        routes.set(key, 1);
        queued.delete(key);
      }
      emit('batch-failed', { batch, ids: message.ids, ms: now() - started, why: result.why });
    }
    return result;
  }
  if (op === 'freeze') {
    const ss = message.ids.map(key => sessions.get(key));
    if (ss.some(s => !s || s.frozen)) throw new Error('invalid batch');
    for (const s of ss) s.frozen = true;
    const fds = ss.flatMap(s => [s.master, s.control]);
    if (message.fault === 'ebadf') fds[0] = -1;
    let sendMs, payloadBytes;
    try {
      const body = JSON.stringify({ ...message, sessions: ss.map(({ master, control, ...meta }) => meta) });
      payloadBytes = Buffer.byteLength(body);
      const sendStarted = now();
      native.send(transferFd, body, fds);
      sendMs = now() - sendStarted;
    } catch (error) {
      for (const s of ss) s.frozen = false;
      return { ok: false, why: error.message };
    }
    return new Promise(resolve => outgoing.set(message.batch, { ss, resolve, sendMs, payloadBytes }));
  }
  if (op === 'drop') {
    if (old || routes.get(id) !== 2) throw new Error('drop requires migrated session');
    const s = sessions.get(id);
    closeSession(s);
    guardians.delete(s.guardian); // Not our child; supervisor/launchd collects it.
    sessions.delete(id);
    return true;
  }
  if (op === 'stop') {
    stopping = true;
    if (!old && !childGone) await workerRpc('stop');
    for (const s of sessions.values()) {
      try { native.send(s.control, 'K', []); } catch { /* exited guardian */ }
      s.writes.length = 0;
      s.frozen = false;
    }
    return true;
  }
  throw new Error(`unknown operation: ${op}`);
}

process.on('message', message => {
  if (old && (message.type === 'prepared' || message.type === 'abort')) {
    const batch = outgoing.get(message.batch);
    if (!batch) throw new Error('unknown batch response');
    outgoing.delete(message.batch);
    if (message.type === 'abort') {
      for (const s of batch.ss) s.frozen = false;
      batch.resolve({ ok: false, why: 'receiver rejected staged batch' });
    } else {
      for (const s of batch.ss) { closeSession(s); sessions.delete(s.id); }
      process.send({ type: 'commit', batch: message.batch, sendMs: batch.sendMs, payloadBytes: batch.payloadBytes });
      batch.resolve({ ok: true });
    }
    return;
  }
  if (!message.request) return;
  command(message).then(value => reply(message.request, value), error => {
    process.send({ reply: message.request, error: error.stack });
  });
});

const timer = setInterval(() => {
  try {
    receiveOffers();
    for (const s of sessions.values()) pumpSession(s);
    reap();
    if (old && created && sessions.size === 0) {
      emit('empty', { pid: process.pid });
      clearInterval(timer);
      process.disconnect();
    }
    if (stopping && guardians.size === 0 && (old || childGone)) {
      for (const s of sessions.values()) closeSession(s);
      native.close(transferFd);
      emit('stopped', { pid: process.pid });
      clearInterval(timer);
      process.disconnect();
    }
  } catch (error) {
    emit('fatal', { error: error.stack });
    // Keep the owner/reaper alive for explicit cleanup, even on an assertion failure.
    clearInterval(timer);
  }
}, 2);
