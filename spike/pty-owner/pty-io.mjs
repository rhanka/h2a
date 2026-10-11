import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { original, hygienic } from './guardian.mjs';
import { identity, fdFlags, here } from './lab.mjs';

const require = createRequire(import.meta.url);
// Private, pinned node-pty API; no IPty object is fabricated. This module is the
// explicit experimental backend contract, including queued bytes and offsets.
export const native = require('node-pty/lib/utils').loadNativeModule('pty').module;
export const version = require('node-pty/package.json').version;
if (version !== '1.1.0') throw new Error(`unqualified node-pty ${version}`);
export function spawnSession(id, mode, safe, root) {
  const session = { id, mode, ring: [], seq: 0, dropped: 0, queued: [],
    offset: 0, epoch: 0, controller: null, exit: null, cols: 80, rows: 24,
    byteCount: 0, capacity: +(process.env.SPIKE_CAPACITY ?? 1048576) };
  const script = safe ? hygienic : original;
  const cli = mode === 'cat' ? ['/bin/cat'] : [process.execPath,
    path.join(here, 'sentinel.mjs'), String(id), mode];
  const args = ['--pdeathsig', 'SIGUSR2', '--', '/usr/bin/bash', '-c', script,
    'h2a-pty-guardian', String(process.pid), ...cli];
  const result = native.fork('/usr/bin/setpriv', args,
    Object.entries(process.env).map(([k, v]) => `${k}=${v}`), root, 80, 24, -1, -1,
    false, '/unused-linux-helper', (exitCode, signal) => {
      if (!session.exit) session.exit = { exitCode, signal, source: 'node-pty-waitpid' };
    });
  session.fd = result.fd; session.pid = result.pid;
  session.birth = identity(result.pid);
  session.tty = result.pty;
  return session;
}
export function collect(session) {
  if (session.closed) return;
  const buffer = Buffer.allocUnsafe(65536);
  for (let n = 0; n < 16; n++) {
    let bytes;
    try { bytes = fs.readSync(session.fd, buffer, 0, buffer.length, null); }
    catch (error) {
      if (error.code === 'EAGAIN') break;
      if (error.code !== 'EIO' && error.code !== 'EBADF') throw error;
      session.eof = true; break;
    }
    if (!bytes) { session.eof = true; break; }
    session.ring.push({ seq: ++session.seq, data: buffer.subarray(0, bytes).toString('base64') });
    session.byteCount += bytes;
    while (session.byteCount > session.capacity && session.ring.length > 1) {
      const old = session.ring.shift(); session.byteCount -= Buffer.from(old.data, 'base64').length;
      session.dropped = old.seq;
    }
  }
  if (session.eof && !session.exit) {
    try {
      const child = identity(session.pid);
      if (child.start !== session.birth.start) throw new Error('birth changed');
      if (child.state === 'Z') session.exit = {
        exitCode: child.exit >> 8, signal: child.exit & 127, source: 'proc-zombie',
      };
    } catch (error) {
      if (error.code === 'ENOENT' && session.adopted) session.exit = {
        unknown: true, source: 'waitpid-callback-lost-before-exec',
      }; else if (error.code !== 'ENOENT') throw error;
    }
  }
  if (session.exit && !session.closed) {
    fs.closeSync(session.fd); session.closed = true;
  }
}
export function flush(session, limit = Infinity) {
  let total = 0;
  while (session.queued.length && !session.closed && total < limit) {
    const buffer = Buffer.from(session.queued[0], 'base64');
    try {
      const count = fs.writeSync(session.fd, buffer, session.offset,
        Math.min(buffer.length - session.offset, limit - total));
      if (!count) break;
      session.offset += count; total += count;
      if (session.offset === buffer.length) { session.queued.shift(); session.offset = 0; }
    } catch (error) { if (error.code === 'EAGAIN') break; throw error; }
  }
  return total;
}
export function preflight(sessions) {
  if (typeof process.execve !== 'function') return { ok: false, reason: 'execve-unavailable', attempted: false };
  for (const session of sessions.filter(s => !s.closed)) {
    try {
      if (fdFlags(session.fd) & 0o2000000) throw new Error('CLOEXEC');
      const target = fs.readlinkSync(`/proc/self/fd/${session.fd}`);
      if (!['/dev/pts/ptmx', '/dev/ptmx'].includes(target)) throw new Error(`foreign type ${target}`);
      if (identity(session.pid).start !== session.birth.start) throw new Error('birth changed');
    } catch (error) { return { ok: false, reason: `bad-fd:${error.message}`, attempted: false }; }
  }
  return { ok: true };
}
export function replay(session, after = 0) {
  return { chunks: session.ring.filter(c => c.seq > after),
    gap: after < session.dropped, next: session.seq, exit: session.exit };
}
