import { spawn } from 'node:child_process';

// Never use a shell. Bound scanner/test output and time; kill only our child.
export function command(executable, args, { cwd, input, timeout = 300_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const fail = message => { failure ??= new Error(message); child.kill('SIGKILL'); };
    const timer = setTimeout(() => fail(`${executable}: timeout`), timeout);
    for (const [stream, append] of [[child.stdout, text => { stdout += text; }], [child.stderr, text => { stderr += text; }]]) {
      stream.on('data', chunk => { append(chunk.toString()); if (stdout.length + stderr.length > 16_777_216) fail(`${executable}: output limit`); });
    }
    child.on('error', error => { failure = error; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

export async function checked(executable, args, options, execute = command) {
  const result = await execute(executable, args, options);
  if (result.code !== 0) throw new Error(`${executable} ${args[0]} failed (${result.code}): ${result.stderr.slice(-2000)}`);
  return result.stdout.trim();
}

export async function request(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok) throw new Error(`OSV HTTP ${response.status}`);
  let text = '';
  for await (const chunk of response.body) {
    text += new TextDecoder().decode(chunk);
    if (text.length > 8_388_608) throw new Error('OSV response limit');
  }
  return JSON.parse(text);
}
