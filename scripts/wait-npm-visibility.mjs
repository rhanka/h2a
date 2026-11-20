#!/usr/bin/env node
// Bounded registry visibility and tarball CDN availability waiter for npm
// post-publish propagation. Polls exact `npm view <pkg>@<version> version`,
// optional abbreviated install packument (`application/vnd.npm.install-v1+json`),
// optional exact `dist.tarball` availability (HTTP 200 HEAD + ranged GET of
// the first bytes), and optional streamed `dist.integrity` SRI verification
// under a strict wall-clock budget. No Python; no external deps.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';
export const DEFAULT_BACKOFF_SECONDS = [10, 15, 20, 30, 45, 60];
export const DEFAULT_VIEW_TIMEOUT_MS = 30_000;
export const DEFAULT_PACKUMENT_TIMEOUT_MS = 20_000;
export const DEFAULT_TARBALL_TIMEOUT_MS = 20_000;
export const DEFAULT_INTEGRITY_TIMEOUT_MS = 120_000;
export const TARBALL_RANGE_HEADER = 'bytes=0-15';

const SRI_RE = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/;

export function parsePackageSpec(raw) {
  if (typeof raw !== 'string') {
    throw new Error(`Invalid package spec: expected string, got ${typeof raw}`);
  }
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1 || /\s/.test(trimmed)) {
    throw new Error(`Invalid package spec "${raw}": expected <name>@<version>`);
  }
  const name = trimmed.slice(0, at);
  const version = trimmed.slice(at + 1);
  if (name === '@' || name.endsWith('/')) {
    throw new Error(`Invalid package name in "${raw}"`);
  }
  return { name, version, spec: `${name}@${version}` };
}

export function packumentUrl(registryUrl, packageName) {
  const base = String(registryUrl || DEFAULT_REGISTRY_URL).replace(/\/+$/, '');
  const encoded = packageName.startsWith('@')
    ? `@${encodeURIComponent(packageName.slice(1))}`
    : encodeURIComponent(packageName);
  return `${base}/${encoded}`;
}

export async function probeNpmView(
  spec,
  {
    execFileImpl = execFileAsync,
    timeoutMs = DEFAULT_VIEW_TIMEOUT_MS,
    registryArg,
  } = {},
) {
  const args = ['view', spec.spec, 'version'];
  if (registryArg) {
    args.push('--registry', registryArg);
  }
  try {
    const { stdout } = await execFileImpl('npm', args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    const observed = String(stdout ?? '').trim();
    if (observed === spec.version) {
      return { ok: true, observedVersion: observed, detail: 'npm view ok' };
    }
    return {
      ok: false,
      observedVersion: observed,
      detail: `npm view returned "${observed || '<empty>'}", expected "${spec.version}"`,
    };
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim().split('\n').filter(Boolean).slice(-2).join(' | ');
    const reason = stderr || error?.code || error?.message || 'unknown error';
    return {
      ok: false,
      observedVersion: '',
      detail: `npm view failed: ${reason}`,
    };
  }
}

export async function probePackument(
  spec,
  {
    registryUrl = DEFAULT_REGISTRY_URL,
    requireDistTag,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_PACKUMENT_TIMEOUT_MS,
  } = {},
) {
  const url = packumentUrl(registryUrl, spec.name);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.npm.install-v1+json',
        'cache-control': 'no-cache',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        ok: false,
        detail: `packument HTTP ${response.status} from ${url}`,
      };
    }
    const doc = await response.json();
    const entry = doc && typeof doc === 'object' && doc.versions && typeof doc.versions === 'object'
      ? doc.versions[spec.version]
      : undefined;
    if (!entry || typeof entry !== 'object' || entry.version !== spec.version) {
      return {
        ok: false,
        detail: `packument missing versions["${spec.version}"]`,
      };
    }
    if (typeof entry.dist?.tarball !== 'string' || entry.dist.tarball.length === 0) {
      return {
        ok: false,
        detail: `packument versions["${spec.version}"] missing dist.tarball`,
      };
    }
    if (requireDistTag) {
      const tagged = doc['dist-tags']?.[requireDistTag];
      if (tagged !== spec.version) {
        return {
          ok: false,
          detail: `packument dist-tags.${requireDistTag}="${tagged ?? '<unset>'}", expected "${spec.version}"`,
        };
      }
    }
    return {
      ok: true,
      tarballUrl: entry.dist.tarball,
      integrity: typeof entry.dist?.integrity === 'string' ? entry.dist.integrity : '',
      detail: 'packument ok',
    };
  } catch (error) {
    return {
      ok: false,
      detail: `packument request failed: ${error?.message || String(error)}`,
    };
  }
}

function unwrapMaybeJsonString(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed.trim();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function parseSri(raw) {
  const value = unwrapMaybeJsonString(raw);
  const match = value.match(SRI_RE);
  if (!match) return null;
  return { algorithm: match[1], integrity: value };
}

function isHtmlContentType(headers) {
  const ct = String(headers?.get?.('content-type') ?? '').toLowerCase();
  return ct.includes('text/html');
}

export async function probeNpmDistTarball(
  spec,
  {
    execFileImpl = execFileAsync,
    timeoutMs = DEFAULT_VIEW_TIMEOUT_MS,
    registryArg,
  } = {},
) {
  const args = ['view', spec.spec, 'dist.tarball'];
  if (registryArg) {
    args.push('--registry', registryArg);
  }
  try {
    const { stdout } = await execFileImpl('npm', args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    const observed = unwrapMaybeJsonString(stdout);
    if (!observed) {
      return { ok: false, tarballUrl: '', detail: 'npm view dist.tarball returned empty output' };
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(observed);
    } catch {
      return { ok: false, tarballUrl: '', detail: `npm view dist.tarball returned invalid URL "${observed}"` };
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { ok: false, tarballUrl: '', detail: `npm view dist.tarball returned unsupported scheme "${parsedUrl.protocol}"` };
    }
    return { ok: true, tarballUrl: observed, detail: 'npm view dist.tarball ok' };
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim().split('\n').filter(Boolean).slice(-2).join(' | ');
    const reason = stderr || error?.code || error?.message || 'unknown error';
    return {
      ok: false,
      tarballUrl: '',
      detail: `npm view dist.tarball failed: ${reason}`,
    };
  }
}

export async function probeNpmDistIntegrity(
  spec,
  {
    execFileImpl = execFileAsync,
    timeoutMs = DEFAULT_VIEW_TIMEOUT_MS,
    registryArg,
  } = {},
) {
  const args = ['view', spec.spec, 'dist.integrity', '--json'];
  if (registryArg) {
    args.push('--registry', registryArg);
  }
  try {
    const { stdout } = await execFileImpl('npm', args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = parseSri(stdout);
    if (!parsed) {
      return {
        ok: false,
        integrity: '',
        algorithm: '',
        detail: `npm view dist.integrity returned invalid SRI "${String(stdout ?? '').trim() || '<empty>'}"`,
      };
    }
    return {
      ok: true,
      integrity: parsed.integrity,
      algorithm: parsed.algorithm,
      detail: 'npm view dist.integrity ok',
    };
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim().split('\n').filter(Boolean).slice(-2).join(' | ');
    const reason = stderr || error?.code || error?.message || 'unknown error';
    return {
      ok: false,
      integrity: '',
      algorithm: '',
      detail: `npm view dist.integrity failed: ${reason}`,
    };
  }
}

export async function probeTarball(
  tarballUrl,
  {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TARBALL_TIMEOUT_MS,
  } = {},
) {
  try {
    const headRes = await fetchImpl(tarballUrl, {
      method: 'HEAD',
      headers: {
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (headRes.status !== 200) {
      return {
        ok: false,
        detail: `tarball HEAD returned HTTP ${headRes.status} for ${tarballUrl}`,
      };
    }
    if (isHtmlContentType(headRes.headers)) {
      return {
        ok: false,
        detail: `tarball HEAD returned unexpected text/html content-type for ${tarballUrl}`,
      };
    }
    const rawLen = headRes.headers?.get?.('content-length');
    if (rawLen !== null && rawLen !== undefined && String(rawLen).trim() !== '') {
      const parsedLen = Number(rawLen);
      if (!Number.isInteger(parsedLen) || parsedLen <= 0) {
        return {
          ok: false,
          detail: `tarball HEAD returned invalid content-length="${rawLen}" for ${tarballUrl}`,
        };
      }
    }

    const rangeRes = await fetchImpl(tarballUrl, {
      method: 'GET',
      headers: {
        range: TARBALL_RANGE_HEADER,
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (rangeRes.status !== 206 && rangeRes.status !== 200) {
      return {
        ok: false,
        detail: `tarball range GET returned HTTP ${rangeRes.status} for ${tarballUrl}`,
      };
    }
    if (isHtmlContentType(rangeRes.headers)) {
      return {
        ok: false,
        detail: `tarball range GET returned unexpected text/html content-type for ${tarballUrl}`,
      };
    }

    let bytesRead = 0;
    if (rangeRes.body && typeof rangeRes.body.getReader === 'function') {
      const reader = rangeRes.body.getReader();
      try {
        while (bytesRead < 16) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            bytesRead += value.byteLength;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } else if (typeof rangeRes.arrayBuffer === 'function') {
      const buf = await rangeRes.arrayBuffer();
      bytesRead = buf.byteLength;
    }

    if (bytesRead <= 0) {
      return {
        ok: false,
        detail: `tarball range GET returned empty body for ${tarballUrl}`,
      };
    }
    return {
      ok: true,
      status: headRes.status,
      rangeStatus: rangeRes.status,
      bytesRead,
      detail: `tarball HEAD 200 + range GET ${rangeRes.status} (${bytesRead}B) ok`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `tarball probe failed for ${tarballUrl}: ${error?.message || String(error)}`,
    };
  }
}

export async function probeTarballIntegrity(
  tarballUrl,
  expectedIntegrity,
  {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_INTEGRITY_TIMEOUT_MS,
  } = {},
) {
  const parsed = parseSri(expectedIntegrity);
  if (!parsed) {
    return {
      ok: false,
      fatal: true,
      detail: `invalid expected dist.integrity "${expectedIntegrity}"`,
    };
  }
  try {
    const res = await fetchImpl(tarballUrl, {
      method: 'GET',
      headers: {
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200) {
      return {
        ok: false,
        fatal: false,
        detail: `tarball download returned HTTP ${res.status} for ${tarballUrl}`,
      };
    }
    if (isHtmlContentType(res.headers)) {
      return {
        ok: false,
        fatal: false,
        detail: `tarball download returned unexpected text/html content-type for ${tarballUrl}`,
      };
    }
    const hash = createHash(parsed.algorithm);
    let bytesDownloaded = 0;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            hash.update(value);
            bytesDownloaded += value.byteLength;
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else if (typeof res.arrayBuffer === 'function') {
      const buf = Buffer.from(await res.arrayBuffer());
      hash.update(buf);
      bytesDownloaded = buf.byteLength;
    }

    if (bytesDownloaded <= 0) {
      return {
        ok: false,
        fatal: false,
        detail: `tarball download returned empty body for ${tarballUrl}`,
      };
    }

    const observed = `${parsed.algorithm}-${hash.digest('base64')}`;
    if (observed !== parsed.integrity) {
      return {
        ok: false,
        fatal: true,
        observedIntegrity: observed,
        expectedIntegrity: parsed.integrity,
        bytesDownloaded,
        detail: `tarball dist.integrity mismatch for ${tarballUrl}: expected ${parsed.integrity}, got ${observed} (${bytesDownloaded} bytes)`,
      };
    }
    return {
      ok: true,
      fatal: false,
      algorithm: parsed.algorithm,
      integrity: observed,
      bytesDownloaded,
      detail: `tarball dist.integrity ok (${parsed.algorithm}, ${bytesDownloaded} bytes)`,
    };
  } catch (error) {
    return {
      ok: false,
      fatal: false,
      detail: `tarball download failed for ${tarballUrl}: ${error?.message || String(error)}`,
    };
  }
}

function formatSeconds(ms) {
  return Math.max(0, Math.round(ms / 1000));
}

export async function waitForRegistryVisibility({
  packages,
  budgetSeconds,
  checkPackument = false,
  checkTarball = false,
  verifyTarballIntegrity = false,
  requireDistTag,
  backoffSeconds = DEFAULT_BACKOFF_SECONDS,
  registryUrl = process.env.NPM_REGISTRY_URL || process.env.npm_config_registry || DEFAULT_REGISTRY_URL,
  registryArg,
  warnOnly = false,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  probeView,
  probePackumentFn,
  probeTarballUrlFn,
  probeTarballFn,
  probeIntegrityFn,
  probeTarballIntegrityFn,
  log = (line) => process.stdout.write(`${line}\n`),
  err = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('At least one --package <name>@<version> is required');
  }
  if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0) {
    throw new Error(`--budget-seconds must be a positive number (got ${budgetSeconds})`);
  }
  if (!Array.isArray(backoffSeconds) || backoffSeconds.length === 0 ||
      backoffSeconds.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error('backoffSeconds must be a non-empty array of non-negative numbers');
  }

  const parsed = packages.map((entry) => (typeof entry === 'string' ? parsePackageSpec(entry) : entry));
  const pending = new Map(parsed.map((spec) => [spec.spec, { spec, lastDetail: 'not checked yet' }]));
  const visible = [];

  const runView = probeView ?? ((spec) => probeNpmView(spec, { registryArg }));
  const runPackument = probePackumentFn ?? ((spec) => probePackument(spec, { registryUrl, requireDistTag }));
  const runTarballUrl = probeTarballUrlFn ?? ((spec) => probeNpmDistTarball(spec, { registryArg }));
  const runTarball = probeTarballFn ?? ((tarballUrl) => probeTarball(tarballUrl));
  const runIntegrityMeta = probeIntegrityFn ?? ((spec) => probeNpmDistIntegrity(spec, { registryArg }));
  const runTarballIntegrity = probeTarballIntegrityFn ?? ((tarballUrl, expected) => probeTarballIntegrity(tarballUrl, expected));

  const checksLabel = ['npm view'];
  if (checkPackument) checksLabel.push('packument');
  if (checkTarball) checksLabel.push('tarball');
  if (verifyTarballIntegrity) checksLabel.push('dist.integrity');

  const startMs = now();
  const deadlineMs = startMs + budgetSeconds * 1000;
  let attempts = 0;
  let fatalFailure = false;

  while (pending.size > 0) {
    attempts += 1;
    for (const [key, state] of [...pending.entries()]) {
      const viewResult = await runView(state.spec);
      if (!viewResult.ok) {
        state.lastDetail = viewResult.detail;
        continue;
      }
      let packResult;
      if (checkPackument) {
        packResult = await runPackument(state.spec);
        if (!packResult.ok) {
          state.lastDetail = packResult.detail;
          continue;
        }
      }
      if (checkTarball || verifyTarballIntegrity) {
        const urlResult = await runTarballUrl(state.spec);
        if (!urlResult.ok) {
          state.lastDetail = urlResult.detail;
          continue;
        }
        if (checkPackument && packResult?.tarballUrl && packResult.tarballUrl !== urlResult.tarballUrl) {
          state.lastDetail = `tarball URL mismatch: npm view="${urlResult.tarballUrl}" vs packument="${packResult.tarballUrl}"`;
          continue;
        }
        if (checkTarball) {
          const tarballResult = await runTarball(urlResult.tarballUrl);
          if (!tarballResult.ok) {
            state.lastDetail = tarballResult.detail;
            continue;
          }
        }
        if (verifyTarballIntegrity) {
          const integrityMeta = await runIntegrityMeta(state.spec);
          if (!integrityMeta.ok) {
            state.lastDetail = integrityMeta.detail;
            continue;
          }
          const integrityResult = await runTarballIntegrity(urlResult.tarballUrl, integrityMeta.integrity);
          if (!integrityResult.ok) {
            state.lastDetail = integrityResult.detail;
            if (integrityResult.fatal) {
              fatalFailure = true;
              break;
            }
            continue;
          }
        }
      }
      pending.delete(key);
      visible.push(key);
      const elapsedSec = formatSeconds(now() - startMs);
      log(`${key} is visible on registry (${checksLabel.join(' + ')}) after ${elapsedSec}s (attempt ${attempts}).`);
    }

    if (fatalFailure) {
      break;
    }

    if (pending.size === 0) {
      return {
        ok: true,
        warned: false,
        attempts,
        elapsedSeconds: formatSeconds(now() - startMs),
        visible,
        pending: [],
        details: {},
      };
    }

    const currentMs = now();
    const remainingMs = deadlineMs - currentMs;
    if (remainingMs <= 0) {
      break;
    }

    const scheduledSec = backoffSeconds[Math.min(attempts - 1, backoffSeconds.length - 1)];
    const sleepMs = Math.min(scheduledSec * 1000, remainingMs);
    const pendingList = [...pending.keys()].join(', ');
    const detailList = [...pending.entries()].map(([k, s]) => `${k}: ${s.lastDetail}`).join('; ');
    const elapsedSec = formatSeconds(currentMs - startMs);
    err(
      `${pendingList} not visible on registry yet (${detailList}); retrying in ${formatSeconds(sleepMs)}s (attempt ${attempts}, elapsed ${elapsedSec}s/${budgetSeconds}s).`,
    );
    await sleep(sleepMs);
  }

  const elapsedSeconds = formatSeconds(now() - startMs);
  const pendingKeys = [...pending.keys()];
  const pendingList = pendingKeys.join(', ');
  const details = Object.fromEntries([...pending.entries()].map(([k, s]) => [k, s.lastDetail]));
  const detailList = Object.entries(details).map(([k, d]) => `${k}: ${d}`).join('; ');

  if (fatalFailure) {
    err(
      `::error::${pendingList} failed fatal registry verification (${elapsedSeconds}s elapsed, ${attempts} attempts; ${detailList}).`,
    );
    return { ok: false, warned: false, fatal: true, attempts, elapsedSeconds, visible, pending: pendingKeys, details };
  }

  if (warnOnly) {
    err(
      `::warning::${pendingList} was published but is not visible on registry after ${elapsedSeconds}s (${attempts} attempts, budget ${budgetSeconds}s) — registry propagation lag (${detailList}); not failing the step.`,
    );
    return { ok: false, warned: true, attempts, elapsedSeconds, visible, pending: pendingKeys, details };
  }

  err(
    `::error::${pendingList} did not become visible on registry within ${budgetSeconds}s (${elapsedSeconds}s elapsed, ${attempts} attempts; ${detailList}).`,
  );
  return { ok: false, warned: false, attempts, elapsedSeconds, visible, pending: pendingKeys, details };
}

function parseBackoffCsv(raw) {
  const values = String(raw)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
  if (values.length === 0 || values.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`Invalid --backoff-seconds "${raw}": expected comma-separated non-negative numbers`);
  }
  return values;
}

async function main() {
  const { values } = parseArgs({
    options: {
      package: { type: 'string', multiple: true },
      'budget-seconds': { type: 'string' },
      'check-packument': { type: 'boolean', default: false },
      'check-tarball': { type: 'boolean', default: false },
      'verify-tarball-integrity': { type: 'boolean', default: false },
      'require-dist-tag': { type: 'string' },
      'backoff-seconds': { type: 'string' },
      registry: { type: 'string' },
      'warn-only': { type: 'boolean', default: false },
    },
  });

  const packages = values.package ?? [];
  const budgetSeconds = Number(values['budget-seconds']);
  const backoffSeconds = values['backoff-seconds'] !== undefined
    ? parseBackoffCsv(values['backoff-seconds'])
    : DEFAULT_BACKOFF_SECONDS;
  const registryArg = values.registry;
  const registryUrl = registryArg || process.env.NPM_REGISTRY_URL || process.env.npm_config_registry || DEFAULT_REGISTRY_URL;

  const result = await waitForRegistryVisibility({
    packages,
    budgetSeconds,
    checkPackument: values['check-packument'],
    checkTarball: values['check-tarball'],
    verifyTarballIntegrity: values['verify-tarball-integrity'],
    requireDistTag: values['require-dist-tag'],
    backoffSeconds,
    registryUrl,
    registryArg,
    warnOnly: values['warn-only'],
  });

  if (!result.ok && !result.warned) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`::error::wait-npm-visibility failed: ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
