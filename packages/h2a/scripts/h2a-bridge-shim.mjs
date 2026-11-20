#!/usr/bin/env node
/**
 * Node launcher shim for `h2a registry-bridge serve` under narrowed session PATHs.
 *
 * Login shells and desktop launchers often read `~/.profile` (`~/.local/bin`)
 * without sourcing `~/.bashrc` (`~/.npm-global/bin`). This shim uses only
 * Node built-ins (so it can run directly from a bare plugin cache checkout
 * without `dist/` or `node_modules/`), locates the `h2a` executable across
 * the session `PATH` and trusted user fallback prefixes, prepends its directory
 * to `PATH`, relays termination signals (`SIGTERM`, `SIGINT`, `SIGHUP`), and
 * spawns `h2a`.
 *
 * Limitation: because `.claude-plugin/registry.mcp.json` invokes `"command": "node"`,
 * `node` itself must be reachable on the host launcher's `PATH` (for example
 * `/usr/bin/node`, `/usr/local/bin/node`, or `~/.local/bin/node`).
 */
import { spawn } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_REALPATH = (() => {
  try {
    return realpathSync(SELF_PATH);
  } catch {
    return null;
  }
})();

function quoteShellPath(p) {
  return /[^A-Za-z0-9_./:@=-]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p;
}

export function isExclusiveUserPrivateGroup(st, options = {}) {
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1);
  const gid = options.gid ?? (typeof process.getgid === "function" ? process.getgid() : -1);
  if (uid < 0 || gid < 0 || typeof st.gid !== "number") return false;
  if (st.uid !== uid || st.gid !== gid) return false;
  let passwdRaw;
  let groupRaw;
  try {
    passwdRaw = options.passwdContent ?? readFileSync("/etc/passwd", "utf8");
    groupRaw = options.groupContent ?? readFileSync("/etc/group", "utf8");
  } catch {
    return false;
  }
  let username = null;
  let matchingUserCount = 0;
  for (const rawLine of passwdRaw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(":");
    if (fields.length < 4) return false;
    const [name, , uidStr, gidStr] = fields;
    if (!name || !/^\d+$/.test(uidStr ?? "") || !/^\d+$/.test(gidStr ?? "")) return false;
    const entryUid = Number(uidStr);
    const entryGid = Number(gidStr);
    if (entryUid === uid) {
      matchingUserCount++;
      if (entryGid !== gid) return false;
      username = name;
    } else if (entryGid === gid) {
      return false;
    }
  }
  if (matchingUserCount !== 1 || !username) return false;
  let matchingGroupCount = 0;
  for (const rawLine of groupRaw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(":");
    if (fields.length < 4) return false;
    const [, , gidStr, membersStr] = fields;
    if (!/^\d+$/.test(gidStr ?? "")) return false;
    if (Number(gidStr) !== gid) continue;
    matchingGroupCount++;
    const members = (membersStr ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    if (members.some((member) => member !== username)) return false;
  }
  return matchingGroupCount === 1;
}

function isTrustedStat(st) {
  if ((st.mode & 0o002) !== 0) return false;
  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    if (st.uid !== uid && st.uid !== 0) return false;
  }
  if ((st.mode & 0o020) !== 0) {
    return isExclusiveUserPrivateGroup(st);
  }
  return true;
}

function formatUntrustedReason(targetPath, st) {
  const octalMode = (st.mode & 0o777).toString(8).padStart(4, "0");
  const uid = typeof process.getuid === "function" ? process.getuid() : st.uid;
  const quoted = quoteShellPath(targetPath);
  const ownerMismatch = typeof process.getuid === "function" && st.uid !== uid && st.uid !== 0;
  const modeMismatch = (st.mode & 0o002) !== 0 || ((st.mode & 0o020) !== 0 && !isExclusiveUserPrivateGroup(st));
  const remedy = ownerMismatch && modeMismatch
    ? `chown ${uid} ${quoted} && chmod go-w ${quoted}`
    : ownerMismatch
      ? `chown ${uid} ${quoted}`
      : `chmod go-w ${quoted}`;
  return `${targetPath} has mode ${octalMode} uid=${st.uid} (expected uid=${uid} without group/other write); run: ${remedy}`;
}

function checkTrustedDirectoryPath(dirPath, rejected) {
  if (!dirPath || !isAbsolute(dirPath)) return false;
  try {
    const st = statSync(dirPath);
    if (!st.isDirectory()) return false;
    let ok = true;
    if (!isTrustedStat(st)) {
      if (rejected) rejected.push(formatUntrustedReason(dirPath, st));
      ok = false;
    }
    const real = realpathSync(dirPath);
    if (real !== dirPath) {
      const realSt = statSync(real);
      if (!realSt.isDirectory()) return false;
      if (!isTrustedStat(realSt)) {
        if (rejected) rejected.push(formatUntrustedReason(real, realSt));
        ok = false;
      }
    }
    return ok;
  } catch {
    return false;
  }
}

function isPathExecutableCandidate(candidate, excludeRealpath = SELF_REALPATH) {
  if (!candidate || !isAbsolute(candidate)) return false;
  try {
    const st = statSync(candidate);
    if (!st.isFile() || (st.mode & 0o111) === 0 || (st.mode & 0o002) !== 0) return false;
    const realCandidate = realpathSync(candidate);
    if (excludeRealpath && realCandidate === excludeRealpath) return false;
    const realSt = statSync(realCandidate);
    return realSt.isFile() && (realSt.mode & 0o111) !== 0 && (realSt.mode & 0o002) === 0;
  } catch {
    return false;
  }
}

function isTrustedFallbackCandidate(
  candidate,
  prefixRoot,
  excludeRealpath = SELF_REALPATH,
  rejected = null
) {
  if (!candidate || !isAbsolute(candidate)) return false;
  try {
    lstatSync(candidate);
  } catch {
    return false;
  }
  let realCandidate;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return false;
  }
  if (excludeRealpath && realCandidate === excludeRealpath) return false;

  const candidateReasons = [];
  try {
    const realSt = statSync(realCandidate);
    if (!realSt.isFile() || (realSt.mode & 0o111) === 0) return false;
    if (!isTrustedStat(realSt)) {
      candidateReasons.push(formatUntrustedReason(realCandidate, realSt));
    }
    const realBinDir = dirname(realCandidate);
    checkTrustedDirectoryPath(realBinDir, candidateReasons);
    const candidateDir = dirname(candidate);
    if (candidateDir !== realBinDir) {
      checkTrustedDirectoryPath(candidateDir, candidateReasons);
    }
    if (prefixRoot && isAbsolute(prefixRoot)) {
      try {
        const realPrefix = realpathSync(prefixRoot);
        if (realCandidate === realPrefix || realCandidate.startsWith(`${realPrefix}${sep}`)) {
          let cur = realBinDir;
          while (cur.startsWith(`${realPrefix}${sep}`) && cur !== realPrefix) {
            const parent = dirname(cur);
            if (parent === cur) break;
            cur = parent;
            checkTrustedDirectoryPath(cur, candidateReasons);
          }
        } else {
          checkTrustedDirectoryPath(prefixRoot, candidateReasons);
        }
      } catch {
        checkTrustedDirectoryPath(prefixRoot, candidateReasons);
      }
    }
  } catch {
    return false;
  }

  if (candidateReasons.length > 0) {
    if (Array.isArray(rejected)) {
      for (const reason of candidateReasons) {
        if (!rejected.includes(reason)) rejected.push(reason);
      }
    }
    return false;
  }
  return true;
}

export function resolveH2aExecutable(
  env = process.env,
  excludeRealpath = SELF_REALPATH,
  options = {}
) {
  const rejected = Array.isArray(options?.rejected) ? options.rejected : null;
  const onlyHomeFallbacks = Boolean(options?.onlyHomeFallbacks);
  const rawHome = env.HOME?.trim();
  const home = rawHome && isAbsolute(rawHome) ? rawHome : null;
  const h2aPrefix = env.H2A_PREFIX?.trim();
  const npmPrefix = env.NPM_CONFIG_PREFIX?.trim();

  const candidates = [];
  if (!onlyHomeFallbacks) {
    for (const rawDir of (env.PATH ?? "").split(":")) {
      const dir = rawDir.trim();
      if (!dir || !isAbsolute(dir)) continue;
      candidates.push({ dir, fromPath: true });
    }
    if (h2aPrefix && isAbsolute(h2aPrefix)) {
      candidates.push({ dir: join(h2aPrefix, "bin"), prefixRoot: h2aPrefix, fromPath: false });
    }
    if (npmPrefix && isAbsolute(npmPrefix)) {
      candidates.push({ dir: join(npmPrefix, "bin"), prefixRoot: npmPrefix, fromPath: false });
    }
  }
  if (home) {
    const upgradeRoot = join(home, ".local", "share", "h2a", "upgrade", "current");
    const npmGlobalRoot = join(home, ".npm-global");
    const localBinDir = join(home, ".local", "bin");
    const pnpmRoot = join(home, ".local", "share", "pnpm");
    candidates.push(
      { dir: join(upgradeRoot, "bin"), prefixRoot: upgradeRoot, fromPath: false },
      { dir: join(npmGlobalRoot, "bin"), prefixRoot: npmGlobalRoot, fromPath: false }
    );
    if (!onlyHomeFallbacks) {
      candidates.push({ dir: localBinDir, prefixRoot: localBinDir, fromPath: false });
    }
    candidates.push({ dir: pnpmRoot, prefixRoot: pnpmRoot, fromPath: false });
    if (!onlyHomeFallbacks) {
      try {
        const realHome = realpathSync(home);
        const execDir = dirname(process.execPath);
        if (realpathSync(execDir).startsWith(`${realHome}${sep}`)) {
          candidates.push({ dir: execDir, prefixRoot: execDir, fromPath: false });
        }
      } catch {
        /* ignore */
      }
    }
  }

  const seen = new Set();
  for (const { dir, prefixRoot, fromPath } of candidates) {
    const key = `${fromPath ? "path" : "fallback"}:${dir}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = join(dir, "h2a");
    if (fromPath) {
      if (isPathExecutableCandidate(candidate, excludeRealpath)) {
        return candidate;
      }
    } else if (isTrustedFallbackCandidate(candidate, prefixRoot, excludeRealpath, rejected)) {
      return candidate;
    }
  }
  return null;
}

const isMainModule = Boolean(process.argv[1]) && (() => {
  try {
    return realpathSync(process.argv[1]) === (SELF_REALPATH ?? SELF_PATH);
  } catch {
    return resolve(process.argv[1]) === SELF_PATH;
  }
})();

if (isMainModule) {
  const rawArgs = process.argv.slice(2);
  const forwardedArgs = rawArgs[0] === "registry-bridge"
    ? rawArgs
    : rawArgs[0] === "serve"
      ? ["registry-bridge", ...rawArgs]
      : ["registry-bridge", "serve", ...rawArgs];

  const rejected = [];
  const executable = resolveH2aExecutable(process.env, SELF_REALPATH, { rejected });
  if (!executable) {
    const detail = rejected.length > 0 ? ` (rejected: ${rejected.join("; ")})` : "";
    const message = `missing_executable: cannot locate a trusted h2a binary in PATH, ~/.npm-global/bin, ~/.local/bin, or ~/.local/share/h2a/upgrade/current/bin${detail}`;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } })}\n`);
    process.stderr.write(`h2a registry-bridge serve: ${message}\n`);
    process.exit(2);
  }

  const binDir = dirname(executable);
  const safePathDirs = (process.env.PATH ?? "")
    .split(":")
    .map((d) => d.trim())
    .filter((d) => Boolean(d) && isAbsolute(d));
  const nextPath = (safePathDirs.includes(binDir) ? safePathDirs : [binDir, ...safePathDirs]).join(":");

  const child = spawn(executable, forwardedArgs, {
    stdio: "inherit",
    env: { ...process.env, PATH: nextPath }
  });

  const forwardedSignals = ["SIGTERM", "SIGINT", "SIGHUP"];
  const signalHandlers = new Map();
  for (const sig of forwardedSignals) {
    const handler = () => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill(sig);
        } catch {
          /* ignore */
        }
      }
    };
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }

  child.on("error", (err) => {
    process.stderr.write(`h2a registry-bridge serve: failed to spawn ${executable}: ${err.message}\n`);
    process.exit(2);
  });

  child.on("exit", (code, signal) => {
    for (const [sig, handler] of signalHandlers) {
      process.off(sig, handler);
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
