import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const CENTRAL_SYSTEMD_UNIT = 'h2a-mcp-central.scope';
export const CENTRAL_MEMORY_HIGH_BYTES = 3 * 1024 * 1024 * 1024;
export const CENTRAL_MEMORY_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_CGROUP_VERIFY_TIMEOUT_MS = 400;
const DEFAULT_CGROUP_POLL_INTERVAL_MS = 15;

function defaultRunBusctl(args, env) {
  return execFileAsync('busctl', args, { env, timeout: 1500, encoding: 'utf8' });
}

function defaultReadCgroup(pid) {
  return fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8');
}

function sanitizeUnitName(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  if (!/^[A-Za-z0-9_.-]+\.scope$/.test(value)) return null;
  return value;
}

function sanitizeSegment(raw) {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || randomUUID().slice(0, 8);
}

function buildGenerationUnitName(pid, generation) {
  if (typeof generation === 'string' && generation.trim().length > 0) {
    return sanitizeUnitName(`h2a-mcp-central-${sanitizeSegment(generation)}.scope`)
      ?? `h2a-mcp-central-${pid}-${randomUUID().slice(0, 8)}.scope`;
  }
  return `h2a-mcp-central-${pid}-${randomUUID().slice(0, 8)}.scope`;
}

function hasUserDbusSocket(env, existsSync = fs.existsSync) {
  const busAddress = typeof env?.DBUS_SESSION_BUS_ADDRESS === 'string' ? env.DBUS_SESSION_BUS_ADDRESS.trim() : '';
  if (busAddress) return true;
  const runtimeDir = typeof env?.XDG_RUNTIME_DIR === 'string' ? env.XDG_RUNTIME_DIR.trim() : '';
  if (runtimeDir && existsSync(`${runtimeDir}/bus`)) return true;
  return false;
}

function parseCgroupRelPath(cgroupText) {
  if (typeof cgroupText !== 'string') return '';
  const line = cgroupText.split('\n').find(Boolean) ?? '';
  return line.replace(/^\d+:[^:]*:/, '').trim();
}

export function isCgroupInUnitScope(cgroupPath, unitName) {
  if (typeof cgroupPath !== 'string' || !cgroupPath || !unitName) return false;
  return cgroupPath === unitName || cgroupPath.endsWith(`/${unitName}`) || cgroupPath.split('/').includes(unitName);
}

function buildStartTransientUnitArgs(unitName, pid) {
  return [
    '--user',
    '--timeout=750ms',
    'call',
    'org.freedesktop.systemd1',
    '/org/freedesktop/systemd1',
    'org.freedesktop.systemd1.Manager',
    'StartTransientUnit',
    'ssa(sv)a(sa(sv))',
    unitName,
    'replace',
    '4',
    'Slice', 's', 'app.slice',
    'PIDs', 'au', '1', String(pid),
    'MemoryHigh', 't', String(CENTRAL_MEMORY_HIGH_BYTES),
    'MemoryMax', 't', String(CENTRAL_MEMORY_MAX_BYTES),
    '0'
  ];
}

export function isUnitExistsError(error) {
  const combined = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  return /UnitExists|Unit .* already exists|was already loaded or has a fragment file/i.test(combined);
}

async function verifyPidInCgroupScope(pid, unitName, readCgroup, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let lastCgroupPath = '';
  let lastReadError = '';
  for (;;) {
    try {
      const cgroupText = await readCgroup(pid);
      lastCgroupPath = parseCgroupRelPath(cgroupText);
      if (isCgroupInUnitScope(lastCgroupPath, unitName)) {
        return { verified: true, cgroupPath: lastCgroupPath, error: null };
      }
      lastReadError = `pid ${pid} remained in cgroup ${lastCgroupPath || '(empty)'}`;
    } catch (error) {
      lastReadError = (error?.message ?? 'unreadable /proc/<pid>/cgroup').trim();
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, pollIntervalMs)));
  }
  return { verified: false, cgroupPath: lastCgroupPath, error: lastReadError };
}

/**
 * Isolate a spawned MCP central daemon into its own `systemd --user` scope
 * with a unique scope unit per generation (or explicit `H2A_MCP_CENTRAL_SYSTEMD_UNIT`
 * / `options.unit` with handover-collision fallback) and `MemoryHigh=3G` /
 * `MemoryMax=4G`, independent of the caller's session cgroup.
 *
 * Verifies `/proc/<pid>/cgroup` after `StartTransientUnit` (briefly polling for
 * the async systemd job transition) and sets `isolated: true` ONLY when the
 * target unit appears in `/proc/<pid>/cgroup`.
 */
export async function isolateCentralSystemdScope(pid, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.environment ?? process.env;
  if (platform !== 'linux') {
    return {
      isolated: false,
      reason: 'non_linux',
      unit: null,
      memoryHighBytes: CENTRAL_MEMORY_HIGH_BYTES,
      memoryMaxBytes: CENTRAL_MEMORY_MAX_BYTES,
      message: `[h2a-mcp-central] systemd --user scope isolation is Linux-only (platform=${platform}); keeping central pid ${pid} in detached fallback process`
    };
  }
  if (env?.H2A_MCP_CENTRAL_SYSTEMD_SCOPE === '0') {
    return {
      isolated: false,
      reason: 'disabled',
      unit: null,
      memoryHighBytes: CENTRAL_MEMORY_HIGH_BYTES,
      memoryMaxBytes: CENTRAL_MEMORY_MAX_BYTES,
      message: `[h2a-mcp-central] systemd --user scope isolation disabled via H2A_MCP_CENTRAL_SYSTEMD_SCOPE=0; central pid ${pid} stays in caller session scope`
    };
  }
  const existsSync = options.existsSync ?? fs.existsSync;
  if (!hasUserDbusSocket(env, existsSync)) {
    return {
      isolated: false,
      reason: 'systemd_user_absent',
      unit: null,
      memoryHighBytes: CENTRAL_MEMORY_HIGH_BYTES,
      memoryMaxBytes: CENTRAL_MEMORY_MAX_BYTES,
      message: `[h2a-mcp-central] systemd --user unavailable (no DBUS_SESSION_BUS_ADDRESS or XDG_RUNTIME_DIR/bus); falling back to detached spawn in caller scope for central pid ${pid}`
    };
  }

  const runBusctl = options.runBusctl ?? defaultRunBusctl;
  const readCgroup = options.readCgroup ?? defaultReadCgroup;
  const verifyTimeoutMs = options.cgroupVerifyTimeoutMs ?? DEFAULT_CGROUP_VERIFY_TIMEOUT_MS;
  const pollIntervalMs = options.cgroupPollIntervalMs ?? DEFAULT_CGROUP_POLL_INTERVAL_MS;

  const explicitUnit = sanitizeUnitName(options.unit ?? env?.H2A_MCP_CENTRAL_SYSTEMD_UNIT);
  const generationUnit = buildGenerationUnitName(pid, options.generation);
  const retryUnit = `h2a-mcp-central-${pid}-${randomUUID().slice(0, 8)}.scope`;
  const candidates = explicitUnit
    ? [explicitUnit, generationUnit, retryUnit].filter((v, idx, arr) => arr.indexOf(v) === idx)
    : [generationUnit, retryUnit].filter((v, idx, arr) => arr.indexOf(v) === idx);

  let lastError;
  for (let i = 0; i < candidates.length; i++) {
    const unitName = candidates[i];
    try {
      await runBusctl(buildStartTransientUnitArgs(unitName, pid), env);
      const check = await verifyPidInCgroupScope(pid, unitName, readCgroup, verifyTimeoutMs, pollIntervalMs);
      if (check.verified) {
        return {
          isolated: true,
          reason: 'systemd_user_scope',
          unit: unitName,
          slice: 'app.slice',
          memoryHighBytes: CENTRAL_MEMORY_HIGH_BYTES,
          memoryMaxBytes: CENTRAL_MEMORY_MAX_BYTES,
          cgroupPath: check.cgroupPath,
          message: `[h2a-mcp-central] started central pid ${pid} in own systemd --user scope ${unitName} (MemoryHigh=3G, MemoryMax=4G, Slice=app.slice, cgroup=${check.cgroupPath})`
        };
      }
      return {
        isolated: false,
        reason: 'scope_verification_failed',
        unit: unitName,
        slice: 'app.slice',
        memoryHighBytes: CENTRAL_MEMORY_HIGH_BYTES,
        memoryMaxBytes: CENTRAL_MEMORY_MAX_BYTES,
        ...(check.cgroupPath ? { cgroupPath: check.cgroupPath } : {}),
        error: check.error,
        message: `[h2a-mcp-central] requested systemd --user scope ${unitName} for central pid ${pid}, but /proc/${pid}/cgroup stayed at ${check.cgroupPath || '(unreadable)'}; falling back to isolated=false`
      };
    } catch (error) {
      lastError = error;
      if (isUnitExistsError(error) && i + 1 < candidates.length) {
        continue;
      }
      break;
    }
  }

  const detail = String(lastError?.stderr || lastError?.message || 'unknown error').trim().split('\n')[0];
  return {
    isolated: false,
    reason: lastError?.code === 'ENOENT' ? 'busctl_missing' : 'systemd_user_unavailable',
    unit: null,
    memoryHighBytes: CENTRAL_MEMORY_HIGH_BYTES,
    memoryMaxBytes: CENTRAL_MEMORY_MAX_BYTES,
    error: detail,
    message: `[h2a-mcp-central] systemd --user unavailable (${detail}); falling back to detached spawn in caller scope for central pid ${pid}`
  };
}
