import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSession, collect, flush, native, replay, preflight, version } from './pty-io.mjs';
import { identity, fds, serve, json, read, here } from './lab.mjs';
import { transition } from './transition.mjs';
import { frontManager } from './front-manager.mjs';

export async function owner(build) {
  const root = process.env.SPIKE_ROOT;
  if (!root || process.env.HOME !== root || process.env.XDG_RUNTIME_DIR !== root)
    throw new Error('private environment required');
  const checkpoint = path.join(root, 'checkpoint.json');
  const front = frontManager(root);
  let state = process.env.SPIKE_RESUME ? read(checkpoint) : {
    schema: 1, generation: 0, sessions: [], birth: identity(process.pid), transitions: [],
  };
  if (state.schema !== 1) throw new Error('invalid schema');
  if (state.fault === 'adoption' || state.fault === 'rollback') {
    try { throw new Error('injected adoption exception'); }
    catch (error) {
      if (state.fault !== 'rollback') throw error;
      state.fault = null; state.rollback = true; state.rollbackError = error.message; json(checkpoint, state);
      process.execve(process.execPath, [process.execPath, path.join(here, `image-${(state.generation - 1) % 2}.mjs`)], process.env);
    }
  }
  if (state.birth.start !== identity(process.pid).start) throw new Error('owner birth changed');
  if (!process.env.SPIKE_RESUME) fs.writeFileSync(path.join(root, 'owner.lock'), JSON.stringify(state.birth), { flag: 'wx', mode: 0o600 });
  else if (read(path.join(root, 'owner.lock')).start !== state.birth.start) throw new Error('publisher fence changed');
  for (const session of state.sessions.filter(s => !s.closed)) {
    const proof = preflight([session]);
    // Ended child may be gone; collect will expose a lost waitpid result.
    if (!proof.ok && !proof.reason.includes('ENOENT')) throw new Error(proof.reason);
  }
  if (state.transitionAt) state.transitions.push({ generation: state.generation, build,
    pauseMs: performance.timeOrigin + performance.now() - state.transitionAt });
  state.quiescing = false;
  for (const session of state.sessions) {
    session.holdWrites = false;
    if (process.env.SPIKE_RESUME) session.adopted = true;
  }
  setInterval(() => {
    if (state.quiescing) return;
    for (const session of state.sessions) { collect(session); if (!session.holdWrites) flush(session); }
  }, 2);
  const listener = process.env.SPIKE_DIRECT_LISTENER === '1' ? 3 : 0;
  const server = serve(listener, async request => {
    const session = state.sessions.find(s => s.id === request.id);
    if (state.quiescing && ['acquire', 'release', 'exec', 'front-start', 'front-kill'].includes(request.op))
      return { error: 'upgrade-in-progress', retrySafe: true };
    if (request.op === 'front-start' || request.op === 'front-kill') return front(request);
    if (request.op === 'status') return { build, node: process.version, pty: version,
      owner: identity(process.pid), generation: state.generation, rollback: state.rollback, rollbackError: state.rollbackError,
      transitions: state.transitions, fd: fds(), rss: process.memoryUsage().rss,
      sessions: state.sessions.map(s => ({ ...s, ring: undefined, queued: undefined })),
      listenerFD: listener, listenerFlags: fds().find(f => f.fd === listener)?.flags };
    if (request.op === 'create' || request.op === 'ensure') {
      if (state.quiescing) return { error: 'upgrade-in-progress', creationAttempted: false, retrySafe: true };
      if (request.op === 'ensure') return { owner: state.birth, publicationCount: 1 };
      const id = state.sessions.length;
      const created = spawnSession(id, request.mode ?? 'tui', request.safe !== false, root);
      state.sessions.push(created); return { id, pid: created.pid, fd: created.fd };
    }
    if (request.op === 'exec') return transition(state, request);
    if (request.op === 'read') { if (!state.quiescing) collect(session); return replay(session, request.after); }
    if (request.op === 'acquire') {
      if (session.controller !== null) return { error: 'controller-busy' };
      session.controller = request.client; return { epoch: ++session.epoch };
    }
    if (request.op === 'release') {
      if (request.epoch !== undefined && session.epoch !== request.epoch) return { error: 'stale-lease' };
      session.epoch++; session.controller = null; return { ok: true };
    }
    if (request.op === 'write' || request.op === 'resize') {
      if (state.quiescing) return { error: 'upgrade-in-progress', retrySafe: true };
      if (session.controller !== request.client || session.epoch !== request.epoch) return { error: 'stale-lease' };
      if (request.op === 'resize') {
        native.resize(session.fd, request.cols, request.rows); session.cols = request.cols; session.rows = request.rows;
      } else {
        session.queued.push(Buffer.from(request.data).toString('base64'));
        session.holdWrites = request.hold === true; flush(session, request.limit);
      }
      return { ok: true };
    }
    if (request.op === 'close-master') { fs.closeSync(session.fd); session.closed = true; return { ok: true }; }
    if (request.op === 'signal-guardian') {
      if (identity(session.pid).start !== session.birth.start) throw new Error('birth changed');
      process.kill(session.pid, 'SIGUSR1'); return { ok: true };
    }
    if (request.op === 'exit-race') {
      session.queued.push(Buffer.from('EXIT:7\n').toString('base64')); flush(session);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      // Native waitpid has reaped child; callback is queued on this blocked JS thread.
      state.generation++; state.transitionAt = performance.timeOrigin + performance.now(); json(checkpoint, state);
      process.execve(process.execPath, [process.execPath, path.join(here, 'image-1.mjs')], { ...process.env, SPIKE_RESUME: '1' });
    }
    if (request.op === 'tty-transfer') {
      try { new net.Socket({ fd: session.fd }); return { unexpected: 'TTY accepted' }; }
      catch (error) { return { code: error.code, message: error.message }; }
    }
    if (request.op === 'die') { setTimeout(() => process.exit(0), 10); return { ok: true }; }
    return { error: 'unknown-operation' };
  });
  server.on('error', error => { throw error; });
  server.on('listening', () => json(path.join(root, 'ready.json'), { build, generation: state.generation }));
}
