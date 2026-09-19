/**
 * Shared MCP-fix laboratory (created by lot L0; reused by L1/L2).
 *
 * It drives the REAL built binary over its real stdio JSON-RPC transport — no
 * FS interception of production, no in-process shortcut. Every case runs
 * against a PRIVATE 0700 copy of the seed (never the real bus / root / HOME),
 * seeded by content copy (never a symlink or hardlink to the source), and every
 * spawned child is tracked so `stopChildren` can reap them.
 *
 * Framing note: the real `h2a_discover_instances` response for the demo seed is
 * ~19.2 MB on ONE line. The frame reader's ceiling is deliberately far above
 * that so a client-side frame cap shows up as an OBSERVED oversize frame here,
 * never as a lab-side truncation or an OOM in the harness itself.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The built entrypoint under test: packages/h2a/dist/bin.js. */
export const H2A_BIN = join(HERE, "..", "..", "dist", "bin.js");

/** Read ceiling for a single frame (64 MiB) — well above the ~19.2 MB seed response. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

/** stderr trace line prefix emitted by the phase-trace module. */
export const TRACE_LINE_PREFIX = "h2a.mcp.phase ";

const children = new Set();

/**
 * Copy the seed to a fresh private 0700 directory by CONTENT (never a link).
 * The returned path is a store root (`registry/`, `keys/`, `identity/` live
 * directly under it). Throws if the seed is missing — the caller must fail
 * closed rather than silently fall back to a reduced fixture.
 */
export function copySeed(seedDir, opts = {}) {
  if (!seedDir) {
    throw new Error("copySeed: a seed directory is required (H2A_MCP_TEST_SEED)");
  }
  const st = statSync(seedDir); // throws ENOENT if the mandatory seed is absent
  if (!st.isDirectory()) {
    throw new Error(`copySeed: seed is not a directory: ${seedDir}`);
  }
  const dest = opts.dest ?? mkdtempSync(join(tmpdir(), "h2a-mcp-lab-"));
  chmodSync(dest, 0o700);
  // Content copy of the whole tree. `dereference` resolves any source link into
  // a plain file so the lab copy shares no inode with the real seed.
  cpSync(seedDir, dest, { recursive: true, dereference: true, force: true });
  chmodSync(dest, 0o700);
  return dest;
}

/** Bytes of the seed registry file, for calibration context (0 if absent). */
export function seedRegistryBytes(root) {
  try {
    return statSync(join(root, "registry", "instances.jsonl")).size;
  } catch {
    return 0;
  }
}

/** Count of registry inscriptions (non-empty JSONL lines). */
export function seedRegistryCount(root) {
  try {
    const raw = statSync(join(root, "registry", "instances.jsonl"));
    if (raw.size === 0) return 0;
  } catch {
    return 0;
  }
  // Counting is done by the size-baseline driver where needed; keep this light.
  return -1;
}

/**
 * A minimal, secret-free environment for a test server. No real HOME (a
 * throwaway is used so no host config or real bus is touched), no H2A_ROOT
 * (the root is always passed explicitly as `--root`), no inherited API tokens.
 */
function labEnv(extra = {}) {
  const home = extra.HOME ?? mkdtempSync(join(tmpdir(), "h2a-mcp-home-"));
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    LANG: process.env.LANG ?? "C.UTF-8",
    // Deterministic, offline, never a real credential.
    NO_COLOR: "1"
  };
  for (const [k, v] of Object.entries(extra)) {
    if (k === "HOME") continue;
    if (v !== undefined) env[k] = v;
  }
  env.HOME = home;
  return env;
}

/**
 * Spawn `h2a mcp-serve --root <root> [...args]` against a private root with a
 * secret-free env. Returns a handle whose stdout is parsed into frames and
 * whose stderr is buffered (and split into trace events).
 */
export function spawnMcp({ root, args = [], env = {}, trace = false, seed } = {}) {
  if (!root) throw new Error("spawnMcp: an explicit --root is required");
  const childEnv = labEnv({ ...env, ...(trace ? { H2A_MCP_TRACE: "1" } : {}) });
  if (seed) childEnv.H2A_MCP_TEST_SEED = seed;
  const child = spawn(
    process.execPath,
    [H2A_BIN, "mcp-serve", "--root", root, ...args],
    { stdio: ["pipe", "pipe", "pipe"], env: childEnv }
  );
  children.add(child);

  const handle = {
    child,
    pid: child.pid,
    stderr: "",
    _pending: new Map(),
    _notifications: [],
    _acc: [],
    _accBytes: 0,
    _closed: false,
    _exit: null
  };

  child.stdout.on("data", (chunk) => {
    handle._acc.push(chunk);
    handle._accBytes += chunk.length;
    if (handle._accBytes > MAX_FRAME_BYTES) {
      // Guard the harness itself; a real oversize frame is reported, not OOM'd.
      handle._acc = [];
      handle._accBytes = 0;
      for (const [, rej] of handle._pending) rej.reject(new Error("frame exceeds MAX_FRAME_BYTES"));
      handle._pending.clear();
      return;
    }
    let buf = Buffer.concat(handle._acc);
    let nl;
    while ((nl = buf.indexOf(0x0a)) !== -1) {
      const lineBuf = buf.subarray(0, nl); // exclude LF
      buf = buf.subarray(nl + 1);
      const bytes = lineBuf.length;
      const text = lineBuf.toString("utf8");
      dispatchFrame(handle, text, bytes);
    }
    handle._acc = buf.length ? [buf] : [];
    handle._accBytes = buf.length;
  });

  child.stderr.on("data", (chunk) => {
    handle.stderr += chunk.toString("utf8");
  });

  child.on("close", (code, signal) => {
    handle._closed = true;
    handle._exit = { code, signal };
    for (const [, p] of handle._pending) {
      p.reject(new Error(`server closed before response (code=${code} signal=${signal})`));
    }
    handle._pending.clear();
    children.delete(child);
  });

  return handle;
}

function dispatchFrame(handle, text, bytes) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    // Non-JSON on stdout is a protocol violation the caller may assert on.
    handle._notifications.push({ raw: text, bytes, parseError: true });
    return;
  }
  if (msg && Object.prototype.hasOwnProperty.call(msg, "id") && handle._pending.has(msg.id)) {
    const p = handle._pending.get(msg.id);
    handle._pending.delete(msg.id);
    p.resolve({ message: msg, bytes, raw: text });
    return;
  }
  // A notification (no id) or an unmatched id: record it (interleaving is legal).
  handle._notifications.push({ message: msg, bytes });
}

/**
 * Send ONE JSON-RPC request and await the response whose id matches, measuring
 * the exact byte length of the response line. Interleaved notifications are
 * buffered on the handle, not confused with the reply.
 */
export function callRpc(handle, request, { timeoutMs = 60000 } = {}) {
  const id = request.id;
  if (id === undefined) throw new Error("callRpc: request needs an id");
  return new Promise((resolve, reject) => {
    if (handle._closed) {
      reject(new Error("callRpc: server already closed"));
      return;
    }
    const timer = setTimeout(() => {
      handle._pending.delete(id);
      reject(new Error(`callRpc: timeout after ${timeoutMs}ms for id ${id}`));
    }, timeoutMs);
    handle._pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      }
    });
    handle.child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

/** Send a JSON-RPC NOTIFICATION (no id, no reply expected). */
export function notify(handle, notification) {
  handle.child.stdin.write(`${JSON.stringify(notification)}\n`);
}

/** All parsed trace events (`h2a.mcp.phase ...`) seen on stderr so far. */
export function collectFrames(handle) {
  const events = [];
  for (const line of handle.stderr.split("\n")) {
    const at = line.indexOf(TRACE_LINE_PREFIX);
    if (at === -1) continue;
    const json = line.slice(at + TRACE_LINE_PREFIX.length);
    try {
      events.push(JSON.parse(json));
    } catch {
      /* a truncated tail line: skip */
    }
  }
  return events;
}

/**
 * Hold a store lock live for contention tests (used by L1/L2). Spawns a tiny
 * detached-in-process holder that creates the sentinel with an O_EXCL write and
 * keeps it until `stop()`. Returns a handle with a `ready` promise and `stop`.
 */
export function startLiveHolder({ root, lock = "registry" }) {
  const lockPath = join(root, lock, ".lock");
  const src = `
import { openSync, writeFileSync, closeSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
const lockPath = process.argv[2];
let fd;
try {
  fd = openSync(lockPath, "wx");
  writeFileSync(fd, JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() }));
  closeSync(fd);
} catch (err) {
  process.stderr.write("holder: cannot lock: " + err.message + "\\n");
  process.exit(3);
}
process.stdout.write("HELD\\n");
const cleanup = () => { try { unlinkSync(lockPath); } catch {} process.exit(0); };
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
setInterval(() => {}, 1 << 30);
`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", src, "--", lockPath], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  const ready = new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (c) => {
      out += c.toString("utf8");
      if (out.includes("HELD")) resolve();
    });
    child.on("close", (code) => {
      if (!out.includes("HELD")) reject(new Error(`holder exited early (code=${code})`));
    });
  });
  return {
    child,
    lockPath,
    ready,
    stop: () => stopOne(child)
  };
}

function stopOne(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      children.delete(child);
      resolve();
      return;
    }
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 2000);
    child.once("close", () => {
      clearTimeout(t);
      children.delete(child);
      resolve();
    });
    try {
      child.stdin?.end();
    } catch {
      /* no stdin */
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  });
}

/** Terminate and reap EVERY child this helper spawned (no global pkill). */
export async function stopChildren(...handles) {
  const targets =
    handles.length > 0
      ? handles.map((h) => h.child ?? h).filter(Boolean)
      : [...children];
  await Promise.all(targets.map((c) => stopOne(c)));
}

/** Write a small marker file (used by probes) with restrictive perms. */
export function writePrivate(path, content) {
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}
