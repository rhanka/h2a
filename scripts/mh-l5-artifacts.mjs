// Public registry artifacts only. No installed h2a, lifecycle scripts or native host.
import fs from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Node 22's default Happy Eyeballs per-family connect timeout is 250ms, which
// causes premature ETIMEDOUT failures against high-latency or dual-stack CDNs
// (notably ziglang.org) under CI load. Raise it to 5s before any fetch.
if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
  net.setDefaultAutoSelectFamilyAttemptTimeout(5_000);
}

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
// Escalating per-attempt timeouts across 6 attempts: abort a dead/stalled TCP
// stream early (30s) so a fresh connection recovers quickly, ride past 10-30s
// upstream rate-limit/connect-timeout windows (e.g. ziglang.org burst limits
// across 8 parallel CI shards), and still grant up to 120s for slow mirrors.
export const DEFAULT_ATTEMPT_TIMEOUTS_MS = [30_000, 45_000, 60_000, 90_000, 90_000, 120_000];

function isRetryableNetworkError(error) {
  if (!error) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  if (error instanceof TypeError) return true;
  const code = error.code ?? error.cause?.code;
  return typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code);
}

function describeError(error) {
  if (!error) return 'unknown error';
  const parts = [];
  if (error.name && error.name !== 'Error') parts.push(error.name);
  if (error.message) parts.push(error.message);
  const code = error.code ?? error.cause?.code;
  if (code) parts.push(`code=${code}`);
  return parts.join(': ') || String(error);
}

function parseRetryAfterMs(header, capMs = 30_000) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), capMs);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.min(Math.max(0, dateMs - Date.now()), capMs);
  return null;
}

export async function downloadWithRetry(url, {
  stage = 'download',
  attemptTimeoutsMs = DEFAULT_ATTEMPT_TIMEOUTS_MS,
  baseBackoffMs = 2_000,
  maxBackoffMs = 25_000,
  jitterMs = 1_500,
  fetchImpl = fetch,
  sleep = ms => new Promise(done => setTimeout(done, ms)),
  random = Math.random,
} = {}) {
  const timeouts = Array.isArray(attemptTimeoutsMs) && attemptTimeoutsMs.length > 0
    ? attemptTimeoutsMs
    : DEFAULT_ATTEMPT_TIMEOUTS_MS;
  const startedAt = performance.now();
  const attemptNotes = [];
  const computeBackoff = (attempt, retryAfterMs = null) =>
    retryAfterMs ?? (Math.min(maxBackoffMs, baseBackoffMs * (2 ** (attempt - 1))) + Math.floor(random() * jitterMs));

  for (let attempt = 1; attempt <= timeouts.length; attempt++) {
    const timeoutMs = timeouts[attempt - 1];
    const attemptStart = performance.now();
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const elapsedMs = Math.round(performance.now() - attemptStart);
        const status = response.status;
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
        try { await response.body?.cancel?.(); } catch {}
        attemptNotes.push(`attempt ${attempt}/${timeouts.length}: HTTP ${status} (${elapsedMs}ms)`);
        if (!RETRYABLE_HTTP_STATUS.has(status)) {
          const totalMs = Math.round(performance.now() - startedAt);
          throw new Error(`fixture_download_failed:${stage}:${status}:${url} (${totalMs}ms; ${attemptNotes.join('; ')})`);
        }
        if (attempt < timeouts.length) {
          await sleep(computeBackoff(attempt, retryAfterMs));
          continue;
        }
        const totalMs = Math.round(performance.now() - startedAt);
        throw new Error(`fixture_download_failed:${stage}:exhausted:${url} after ${timeouts.length} attempts in ${totalMs}ms (${attemptNotes.join('; ')})`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (typeof error?.message === 'string' && error.message.startsWith('fixture_download_failed:')) {
        throw error;
      }
      const elapsedMs = Math.round(performance.now() - attemptStart);
      attemptNotes.push(`attempt ${attempt}/${timeouts.length}: ${describeError(error)} (${elapsedMs}ms, timeout=${timeoutMs}ms)`);
      if (!isRetryableNetworkError(error) || attempt === timeouts.length) {
        const totalMs = Math.round(performance.now() - startedAt);
        throw new Error(
          `fixture_download_failed:${stage}:${attempt === timeouts.length ? 'exhausted' : 'fatal'}:${url} after ${attempt}/${timeouts.length} attempts in ${totalMs}ms (${attemptNotes.join('; ')})`,
          { cause: error },
        );
      }
      await sleep(computeBackoff(attempt));
    }
  }
  throw new Error(`fixture_download_failed:${stage}:unreachable:${url}`);
}

// Resumable chunked download for large archives behind throttled links.
// Measured 2026-11-24: ziglang.org trickles at ~70 KB/s, so the 49 MB
// zig.tar.xz needs ~650 s while a single fetch is capped at 120 s per
// attempt and CI runners abort 6/6 attempts at the deadline (run 45449703686
// bulk jobs). Fetch bytes=offset- probes range support; when the server
// answers 206, reassemble fixed-size chunks (each retried by
// downloadWithRetry, so a stall costs one chunk, not the file); otherwise
// fall back to a plain downloadWithRetry. Integrity stays with the caller
// (sha256 over the concatenated bytes); a dead link still fails explicitly.
export async function downloadWithResume(url, {
  stage = 'download',
  chunkBytes = 2 * 1024 * 1024,
  probeTimeoutMs = 30_000,
  attemptTimeoutsMs = DEFAULT_ATTEMPT_TIMEOUTS_MS,
  baseBackoffMs = 2_000,
  maxBackoffMs = 25_000,
  jitterMs = 1_500,
  fetchImpl = fetch,
  sleep = ms => new Promise(done => setTimeout(done, ms)),
  random = Math.random,
} = {}) {
  const fallback = () => downloadWithRetry(url, {
    stage, attemptTimeoutsMs, baseBackoffMs, maxBackoffMs, jitterMs, fetchImpl, sleep, random,
  });
  let total = null;
  try {
    const probe = await fetchImpl(url, {
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    try { await probe.body?.cancel?.(); } catch {}
    if (probe.status === 206) {
      const match = /\/(\d+)\s*$/.exec(probe.headers?.get?.('content-range') ?? '');
      const parsed = match ? Number(match[1]) : NaN;
      if (Number.isSafeInteger(parsed) && parsed > 0) total = parsed;
    }
  } catch {
    // Probe failure is not a verdict: fall through to the plain download,
    // whose own retries produce the explicit failure.
  }
  if (total === null || total <= chunkBytes) return fallback();
  const parts = [];
  for (let offset = 0; offset < total; offset += chunkBytes) {
    const end = Math.min(offset + chunkBytes - 1, total - 1);
    const rangedFetch = (u, opts = {}) => fetchImpl(u, {
      ...opts,
      headers: { ...(opts.headers ?? {}), Range: `bytes=${offset}-${end}` },
    });
    const bytes = await downloadWithRetry(url, {
      stage: `${stage}:range-${offset}-${end}`,
      attemptTimeoutsMs, baseBackoffMs, maxBackoffMs, jitterMs,
      fetchImpl: rangedFetch, sleep, random,
    });
    if (bytes.length !== end - offset + 1) return fallback();
    parts.push(bytes);
  }
  const out = Buffer.concat(parts);
  if (out.length !== total) return fallback();
  return out;
}

async function main() {
  process.umask(0o022);
  // MH_L5_ARTIFACTS_ROOT overrides the private root (owner rule: never the
  // real /tmp); unset keeps the historical /tmp prefix.
  const root = process.env.MH_L5_ARTIFACTS_ROOT
    ? fs.mkdtempSync(join(process.env.MH_L5_ARTIFACTS_ROOT, 'mh-l5-artifacts-'))
    : fs.mkdtempSync('/tmp/mh-l5-artifacts-');
  try {
    const env = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      npm_config_registry: 'https://registry.npmjs.org',
      npm_config_userconfig: join(root, 'npmrc'),
      npm_config_globalconfig: join(root, 'global-npmrc'),
      npm_config_fetch_retries: '5',
      npm_config_fetch_retry_mintimeout: '2000',
      npm_config_fetch_retry_maxtimeout: '15000',
    };
    for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) {
      env[key] = join(root, key); fs.mkdirSync(env[key], { mode: 0o700 });
    }
    fs.writeFileSync(env.npm_config_userconfig, ''); fs.writeFileSync(env.npm_config_globalconfig, '');
    const run = (command, args, cwd) => {
      const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      fs.appendFileSync(join(root, 'prepare.log'), `${command} ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit=${r.status}\n`);
      if (r.status !== 0) {
        const detail = [
          r.error ? `error=${r.error.message}` : '',
          r.signal ? `signal=${r.signal}` : '',
          r.status !== null ? `exit=${r.status}` : '',
          r.stderr?.trim() ? `stderr=${r.stderr.trim().slice(-500)}` : '',
        ].filter(Boolean).join(' | ');
        throw new Error(`artifact_command_failed:${command} ${args.join(' ')}:${root} (${detail})`);
      }
    };
    const runNpmCiWithRetry = async (directory, maxAttempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) fs.rmSync(join(directory, 'node_modules'), { recursive: true, force: true });
          run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < maxAttempts) {
            await new Promise(done => setTimeout(done, 2_000 * attempt));
          }
        }
      }
      throw lastError;
    };
    const profiles = [];
    for (const version of ['0.98.5', '0.98.6']) {
      const directory = join(root, version); fs.mkdirSync(directory);
      const lockBytes = fs.readFileSync(new URL(`../docs/plan/mh-l5/v1-lock-${version}.json`, import.meta.url));
      const lock = JSON.parse(lockBytes);
      fs.writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: lock.packages[''].dependencies }));
      fs.writeFileSync(join(directory, 'package-lock.json'), lockBytes);
      const packages = [];
      for (const name of ['h2a', 'h2a-runtime']) {
        const metaBytes = await downloadWithRetry(
          `https://registry.npmjs.org/@sentropic%2f${name}/${version}`,
          { stage: `mh-l5-artifacts:npm-metadata:${name}@${version}` },
        );
        const metadata = JSON.parse(metaBytes.toString('utf8'));
        const bytes = await downloadWithRetry(
          metadata.dist.tarball,
          { stage: `mh-l5-artifacts:npm-tarball:${name}@${version}` },
        );
        const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
        if (integrity !== metadata.dist.integrity) throw new Error(`published_integrity_mismatch:${name}@${version}`);
        const path = join(directory, `${name}.tgz`); fs.writeFileSync(path, bytes);
        packages.push({
          name: metadata.name, version, tarball: metadata.dist.tarball, integrity,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
      await runNpmCiWithRetry(directory);
      const central = join(directory, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central.js');
      profiles.push({
        version, packages,
        centralSha256: createHash('sha256').update(fs.readFileSync(central)).digest('hex'),
        lockSha256: createHash('sha256').update(fs.readFileSync(join(directory, 'package-lock.json'))).digest('hex'),
      });
    }
    // Exact public Node 24 runtime; its official SHASUMS verifies the archive.
    const nodeVersion = '24.21.0', name = `node-v${nodeVersion}-linux-${process.arch === 'x64' ? 'x64' : 'arm64'}`;
    const base = `https://nodejs.org/dist/v${nodeVersion}/`;
    const sums = (await downloadWithRetry(base + 'SHASUMS256.txt', { stage: 'mh-l5-artifacts:node-shasums' })).toString('utf8');
    const expected = sums.split('\n').find(line => line.endsWith(`  ${name}.tar.xz`))?.split(' ')[0];
    if (!expected) throw new Error('node_profile_missing');
    const archive = await downloadWithRetry(base + name + '.tar.xz', { stage: `mh-l5-artifacts:node-archive:${name}` });
    if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('node_integrity_mismatch');
    fs.writeFileSync(join(root, 'node24.tar.xz'), archive);
    run('tar', ['-xJf', join(root, 'node24.tar.xz'), '-C', root], root);
    const receipt = { root, profiles, node24: join(root, name, 'bin/node'), nodeArchiveSha256: expected };
    fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
