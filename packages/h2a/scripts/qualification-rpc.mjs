import { spawn } from 'node:child_process';
import { once } from 'node:events';
// Only this child is signalled. Unknown events never establish a qualification.
export function openQualificationRpc(command, args, { cwd, env, signal, observe = () => {}, serverRequest }) {
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let next = 0, buffer = '', failure;
  const requests = new Map();
  const fail = error => { failure = error; for (const request of requests.values()) request.reject(error); requests.clear(); };
  child.on('error', fail); child.on('exit', () => fail(new Error('native app-server exited')));
  child.stderr.on('data', () => {}); // Never persist stderr: native diagnostics can contain secrets.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', bytes => {
    buffer += bytes;
    if (buffer.length > 1_048_576) { fail(new Error('native frame bound exceeded')); child.kill('SIGTERM'); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && requests.has(message.id)) {
          const request = requests.get(message.id); requests.delete(message.id);
          if (message.error) request.reject(new Error('native RPC refused ' + request.method)); else request.resolve(message.result);
        } else if (message.id !== undefined) {
          if (serverRequest) {
            Promise.resolve(serverRequest(message)).then(result => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n'), () => {
              child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'qualification request refused' } }) + '\n');
            });
            continue;
          }
          // Unknown approvals are always refused; no blanket tool permission.
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'qualification approval not authorized' } }) + '\n');
          observe({ method: 'qualification/approval-refused' });
        } else observe(message);
      } catch { fail(new Error('invalid native NDJSON frame')); }
    }
  });
  const abort = () => { fail(new Error('qualification interrupted')); child.kill('SIGTERM'); };
  signal?.addEventListener('abort', abort, { once: true });
  return {
    child,
    notify(method, params = {}) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); },
    async request(method, params = {}) {
      if (failure) throw failure;
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { requests.delete(id); reject(new Error('native RPC timeout')); }, 15_000);
        requests.set(id, { method, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    async close() {
      signal?.removeEventListener('abort', abort); fail(new Error('qualification closed'));
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit'); child.stdin.end(); child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(force); }
    }
  };
}
