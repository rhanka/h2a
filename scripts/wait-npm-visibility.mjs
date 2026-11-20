#!/usr/bin/env node
// Bounded registry visibility waiter for npm post-publish propagation.
// Polls exact `npm view <pkg>@<version> version` and (optionally) the
// abbreviated install packument (`application/vnd.npm.install-v1+json`) with
// stepped backoff under a strict wall-clock budget. No Python; no external deps.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';
export const DEFAULT_BACKOFF_SECONDS = [10, 15, 20, 30, 45, 60];
export const DEFAULT_VIEW_TIMEOUT_MS = 30_000;
export const DEFAULT_PACKUMENT_TIMEOUT_MS = 20_000;

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
    return { ok: true, detail: 'packument ok' };
  } catch (error) {
    return {
      ok: false,
      detail: `packument request failed: ${error?.message || String(error)}`,
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
  requireDistTag,
  backoffSeconds = DEFAULT_BACKOFF_SECONDS,
  registryUrl = process.env.NPM_REGISTRY_URL || process.env.npm_config_registry || DEFAULT_REGISTRY_URL,
  registryArg,
  warnOnly = false,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  probeView,
  probePackumentFn,
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

  const startMs = now();
  const deadlineMs = startMs + budgetSeconds * 1000;
  let attempts = 0;

  while (pending.size > 0) {
    attempts += 1;
    for (const [key, state] of [...pending.entries()]) {
      const viewResult = await runView(state.spec);
      if (!viewResult.ok) {
        state.lastDetail = viewResult.detail;
        continue;
      }
      if (checkPackument) {
        const packResult = await runPackument(state.spec);
        if (!packResult.ok) {
          state.lastDetail = packResult.detail;
          continue;
        }
      }
      pending.delete(key);
      visible.push(key);
      const elapsedSec = formatSeconds(now() - startMs);
      log(`${key} is visible on registry${checkPackument ? ' (npm view + packument)' : ' (npm view)'} after ${elapsedSec}s (attempt ${attempts}).`);
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
