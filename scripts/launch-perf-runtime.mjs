import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fixture, lab, memorySampler } from './launch-perf-safety.mjs';

if (process.argv.includes('--worker')) {
  const { executeH2aRunWithAsyncSpawn } = await import(join(process.env.H2A_PERF_BUILD, 'packages/h2a/dist/runtime/mcp/agent-launch.js'));
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const started = performance.now();
  console.log(JSON.stringify({ elapsedMs: 0, event: 'worker-imported' }));
  const result = await executeH2aRunWithAsyncSpawn(request, spawn, 120000);
  console.log(JSON.stringify({ elapsedMs: performance.now() - started, result }));
} else {
  const { root, output } = fixture(process.argv[2], process.argv[3]);
  const build = resolve(process.env.H2A_PERF_BUILD ?? '.');
  const baseline = existsSync(join(build, 'baseline-ref.txt'));
  const n = Number(process.argv[4] ?? 1);
  if (![1, 4, 17].includes(n)) throw new Error('Supported concurrency: 1, 4, 17');
  const privateDir = mkdtempSync(join(tmpdir(), 'h2a-perf-'));
  const home = join(output, 'home'), bin = join(output, 'bin'), workspace = join(output, 'workspace');
  for (const dir of [home, bin, workspace, join(home, '.config/sentropic/h2a')]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('scripts/launch-perf-provider.mjs'))} "$@"\n`, { mode: 0o700 });
  writeFileSync(join(bin, 'h2a'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(build, 'packages/h2a/dist/bin.js'))} "$@"\n`, { mode: 0o700 });
  const bashEnv = join(output, 'bash-env.sh');
  writeFileSync(bashEnv, `export HOME=${quote(home)}\nexport PATH=${quote(bin)}:/usr/bin:/bin\n`);
  writeFileSync(join(home, '.config/sentropic/h2a/config.json'), JSON.stringify({
    h2a: { enabled: true, command: `${quote(process.execPath)} ${quote(join(build, 'packages/h2a/dist/bin.js'))} mcp-serve --auto-open --host claude --auto-upgrade`, central: { enabled: false } }
  }));
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, XDG_RUNTIME_DIR: privateDir,
    REMOTE_CLI_CONFIG_HOME: home, XDG_CONFIG_HOME: join(home, '.config'), H2A_NATIVE_SOCKET: join(privateDir, 'host.sock'),
    H2A_ROOT: root, H2A_SESSION_HOST: 'native', BASH_ENV: bashEnv, NO_COLOR: '1',
    H2A_PERF_LAB: lab, H2A_PERF_OUTPUT: output, H2A_PERF_BUILD: build, H2A_MCP_TRACE: '1',
    NODE_OPTIONS: `--require=${resolve('scripts/launch-perf-preload.cjs')}` };
  const host = spawn(process.execPath, [join(build, 'packages/h2a-runtime/dist/native-terminal/process.js'), '--socket', env.H2A_NATIVE_SOCKET,
    '--registry-path', join(home, '.config/sentropic/h2a/registry.json')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let hostLog = ''; host.stderr.on('data', data => { hostLog += data; });
  const { NativeTerminalClient } = await import('../packages/h2a-runtime/dist/native-terminal/client.js');
  let client;
  const workers = [];
  const owned = [host];
  const sampler = memorySampler(owned);
  const results = [];
  const started = performance.now();
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { client = await NativeTerminalClient.connect(env.H2A_NATIVE_SOCKET); break; }
      catch { await new Promise(r => setTimeout(r, 50)); }
    }
    if (!client) throw new Error('isolated host failed: ' + hostLog);
    const hostMs = performance.now() - started;
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      const name = `perf-${Date.now()}-${i}`;
      const begin = performance.now();
      const readyFile = join(output, `${name}-ready.json`), readyNonce = randomUUID();
      let readyAtMs, ack;
      const readyCancel = new AbortController();
      const readiness = baseline ? (async () => {
        const deadline = Date.now() + 60_000;
        while (!readyCancel.signal.aborted && Date.now() < deadline) {
          try {
            const record = JSON.parse(readFileSync(readyFile, 'utf8'));
            if (record.kind !== 'h2a.mcp.ready' || record.version !== 1 || record.nonce !== readyNonce || !Number.isInteger(record.pid))
              throw new Error('invalid synthetic readiness ACK');
            ack = record; readyAtMs = performance.now() - begin; return;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!readyCancel.signal.aborted) throw new Error('baseline sidecar never reached identity_ready');
      })().catch(error => ({ error: error.message })) : undefined;
      const worker = spawn(process.execPath, [resolve('scripts/launch-perf-runtime.mjs'), '--worker'],
        { cwd: workspace, env: { ...env, CLAUDE_CODE_SESSION_ID: name,
          ...(baseline ? { H2A_MCP_READY_FILE: readyFile, H2A_MCP_READY_NONCE: readyNonce } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
      workers.push(worker);
      owned.push(worker);
      let stdout = '', stderr = '';
      worker.stdout.on('data', data => { stdout += data; });
      worker.stderr.on('data', data => { stderr += data; });
      worker.stdin.end(JSON.stringify({ profile: 'claude', name, workspace, prompt: 'SYNTHETIC_WITNESS', background: true, gateway: 'off', headless: false, h2aSidecar: true }));
      await new Promise((r, reject) => { worker.once('close', r); worker.once('error', reject); });
      const receiptMs = performance.now() - begin;
      writeFileSync(join(output, `${name}.log`), stderr + '\n' + stdout);
      const receipt = stdout.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return {}; } }).at(-1);
      if (!receipt?.result?.ok) readyCancel.abort();
      const observed = await readiness;
      readyCancel.abort();
      if (observed?.error) throw new Error(observed.error);
      if (ack) {
        const state = await client.state(`h2a-${name}.h2a`);
        let pid = ack.pid, matched = pid === state.pid;
        for (let depth = 0; !matched && pid > 1 && depth < 64; depth++) {
          const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
          const fields = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);
          if (Number(fields[2]) !== state.pid || ['Z', 'X'].includes(fields[0])) break;
          pid = Number(fields[1]); matched = pid === state.pid;
        }
        if (!matched || state.status !== 'running') throw new Error('baseline ACK is not from its owned live sidecar');
      }
      const elapsedMs = Math.max(receiptMs, readyAtMs ?? 0);
      results.push({ name, hostMs, elapsedMs, receiptMs, readyAtMs, receipt });
      for (const id of [`h2a-${name}.h2a`, `h2a-${name}`]) {
        try { const state = await client.state(id); await client.stopIfIncarnation(id, state.generation, state.incarnation, 'SIGKILL'); } catch {}
      }
    }));
  } finally {
    const memory = sampler.stop();
    for (const worker of workers) if (worker.exitCode === null) worker.kill('SIGTERM');
    client?.close(); host.kill('SIGTERM');
    await new Promise(r => host.exitCode !== null || host.signalCode !== null ? r() : host.once('exit', r));
    await sampler.waitForExit();
    writeFileSync(join(output, 'host.log'), hostLog);
    writeFileSync(join(output, 'runtime-result.json'), JSON.stringify({ n, results, memory }, null, 2));
  }
  console.log(JSON.stringify({ n, results }));
  if (results.some(row => !row.receipt?.result?.ok)) process.exitCode = 1;
}
