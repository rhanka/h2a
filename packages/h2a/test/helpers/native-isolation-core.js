/**
 * Lot L0 (D16) — pure isolation primitives shared by the ordinary D16 preload
 * (`native-isolation.js`) and the dedicated T10 VM qualification entrypoint
 * (`scripts/run-namespace-qualification.mjs`).
 *
 * Importing this module creates NO directories, mutates NO environment, and
 * installs NO spawn guard until the caller explicitly invokes
 * `createNativeIsolationApi({ root, preloadUrl, receipt })`.
 */
import assert from "node:assert/strict";
import { recordCiOwnedProcess } from "../../../../scripts/ci-owned-process.mjs";
import childProcess, { spawn, spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread } from "node:worker_threads";
import { once } from "node:events";
import fs, {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { verifyImage } from "../../src/runtime/handover/image.js";
import { digest } from "../../src/runtime/handover/wire.js";
import { resolveAttestedAlias } from "../../../../scripts/test-sandbox-contract.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const guardInstalled = Symbol.for("h2a.test.nativeSpawnGuard");
const nativeEntry = /(?:^|[/\\\s"'])(?:op|process)\.[jt]s(?:$|[\s"'])/;
const receiptKey = Symbol.for("h2a.test.closedBuildReceipt");

const ownerHome = process.env.H2A_TEST_OWNER_HOME || os.userInfo?.()?.homedir || os.homedir();
const ownerUid = os.userInfo?.()?.uid;
const ownerRun = ownerUid !== undefined ? `/run/user/${ownerUid}` : undefined;

function getSharedGuardState() {
  const existing = childProcess.ChildProcess.prototype[guardInstalled];
  return {
    privateProcessRoots: existing?.processRoots ?? new Map(),
    privateChildren: existing?.children ?? new Map(),
    privatePins: existing?.pins ?? new Map(),
    closedProcessRoots: existing?.closedRoots ?? new Set(),
    builtImages: existing?.builtImages ?? new Set(),
    builtLaunchers: existing?.builtLaunchers ?? new Set(),
    builtRouters: existing?.builtRouters ?? new Set(),
    imageTestEntries: existing?.imageTestEntries ?? new Map(),
  };
}

function isNode(command) {
  return command === process.execPath || /(?:^|[/\\])node(?:js|\.exe)?$/.test(command);
}

/**
 * Construct the complete isolation API bound to an explicit `root` (R under
 * D16, or the root-owned T10 qualification root under VM qualification), an
 * explicit child `preloadUrl`, and an optional verified D16 `receipt`.
 */
export function createNativeIsolationApi({ root, preloadUrl, receipt = null }) {
  assert.ok(typeof root === "string" && isAbsolute(root), "isolation core requires an absolute root");
  assert.ok(typeof preloadUrl === "string" && preloadUrl.length > 0, "isolation core requires a preloadUrl");

  const nativeQualificationRoot = resolve(root);
  const preload = `--import=${preloadUrl}`;
  const {
    privateProcessRoots,
    privateChildren,
    privatePins,
    closedProcessRoots,
    builtImages,
    builtLaunchers,
    builtRouters,
    imageTestEntries,
  } = getSharedGuardState();

  if (!globalThis[receiptKey]) {
    Object.defineProperty(globalThis, receiptKey, {
      value: (buildReceipt) => {
        if (!/^sha256:[0-9a-f]{64}$/.test(buildReceipt?.digest)) {
          throw new Error("invalid test build receipt");
        }
        if (buildReceipt.kind === "image") {
          builtImages.add(buildReceipt.digest);
          if (buildReceipt.entrypoints) {
            assert.ok(
              Array.isArray(buildReceipt.entrypoints) &&
                buildReceipt.entrypoints.every(
                  (p) => typeof p === "string" && !isAbsolute(p) && !p.split("/").includes(".."),
                ),
            );
            imageTestEntries.set(buildReceipt.digest, new Set(buildReceipt.entrypoints));
          }
        } else if (buildReceipt.kind === "launcher") {
          builtLaunchers.add(buildReceipt.digest);
        } else if (buildReceipt.kind === "router") {
          builtRouters.add(buildReceipt.digest);
        } else {
          throw new Error("invalid test build receipt kind");
        }
      },
    });
  }

  function rejectOwnerPath(path) {
    const exactForbidden = [ownerHome].filter(Boolean);
    const prefixForbidden = [
      ownerRun,
      ownerHome ? join(ownerHome, ".local/state") : undefined,
      ownerHome ? join(ownerHome, ".config") : undefined,
      ownerHome ? join(ownerHome, "h2a-workspace") : undefined,
    ].filter(Boolean);

    assert.ok(
      !exactForbidden.includes(path) &&
        !prefixForbidden.some((r) => path === r || path.startsWith(`${r}/`)) &&
        (!ownerHome ||
          !path.startsWith(join(ownerHome, ".cache-tmp/h2a-")) ||
          path === nativeQualificationRoot ||
          path.startsWith(`${nativeQualificationRoot}/`)),
      `REFUSING owner path before filesystem access: ${path}`,
    );
  }

  function resolvedPath(path, depth = 0, boundary) {
    let absolute = resolve(path);
    // Translate attested checkout aliases (.qual-tmp, tmp/test-runtime) via the
    // live-verified receipt, while keeping `/tmp` refused as an isolation root.
    if (receipt && absolute !== "/tmp" && !absolute.startsWith("/tmp/")) {
      const translated = resolveAttestedAlias(absolute, receipt);
      assert.ok(translated !== null, `REFUSING unverified alias path before filesystem access: ${absolute}`);
      absolute = resolve(translated);
    }
    rejectOwnerPath(absolute);
    if (boundary) {
      const rel = relative(boundary, absolute);
      assert.ok(
        rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")),
        `REFUSING path outside qualification root before filesystem access: ${absolute}`,
      );
    }
    assert.ok(depth < 32, "REFUSING cyclic qualification symlink");
    const parts = absolute.split("/").filter(Boolean);
    let current = "/";
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index]);
      let info;
      try {
        info = lstatSync(current);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return join(current, ...parts.slice(index + 1));
      }
      if (info.isSymbolicLink()) {
        return resolvedPath(
          join(resolve(dirname(current), readlinkSync(current)), ...parts.slice(index + 1)),
          depth + 1,
          boundary,
        );
      }
    }
    return current;
  }

  function assertPrivateQualificationPath(path, boundaryRoot = nativeQualificationRoot) {
    const actualRoot = resolvedPath(boundaryRoot, 0, resolve(boundaryRoot));
    assert.equal(actualRoot, resolve(boundaryRoot), "REFUSING aliased qualification root before mutation");
    const actual = resolvedPath(path, 0, actualRoot);
    const rel = relative(actualRoot, actual);
    assert.ok(
      rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")),
      `REFUSING path outside qualification root: ${actual}`,
    );
  }

  function createPrivateTestDirectory(prefix, parent = nativeQualificationRoot) {
    assertPrivateQualificationPath(parent, nativeQualificationRoot);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    return mkdtempSync(join(parent, prefix));
  }

  function assertIsolatedEnvironment(env, boundaryRoot = nativeQualificationRoot) {
    for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "H2A_NATIVE_SOCKET"]) {
      assert.ok(env[key] && isAbsolute(env[key]), `REFUSING missing or relative isolation variable: ${key}`);
      assertPrivateQualificationPath(env[key], boundaryRoot);
    }
    for (const key of [
      "TMPDIR",
      "TMUX_TMPDIR",
      "REMOTE_CLI_CONFIG_HOME",
      "H2A_ROOT",
      "H2A_NATIVE_HOST_LOG",
      "H2A_TEST_PROC_ROOT",
      "H2A_TEST_OWNED_PROC_ROOT",
    ]) {
      if (env[key]) assertPrivateQualificationPath(env[key], boundaryRoot);
    }
    if (env.TMUX) assertPrivateQualificationPath(env.TMUX.split(",")[0], boundaryRoot);
  }

  function assertIsolatedNativeOperation(env, boundaryRoot = nativeQualificationRoot) {
    if (env.H2A_NATIVE_SOCKET !== "") return assertIsolatedEnvironment(env, boundaryRoot);
    const directory = join(env.XDG_RUNTIME_DIR ?? "", "h2a-nt");
    assertIsolatedEnvironment(
      { ...env, H2A_NATIVE_SOCKET: join(directory, "native-terminal.sock") },
      boundaryRoot,
    );
    assertPrivateQualificationPath(join(directory, "native-terminal.lf1.sock"), boundaryRoot);
  }

  function privateProcessEnvironment(env) {
    if (
      !["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"].every((key) =>
        env[key]?.startsWith(`${nativeQualificationRoot}/`),
      ) ||
      env.H2A_NATIVE_SOCKET === undefined
    ) {
      return env;
    }
    assertIsolatedNativeOperation(env);
    env = { ...env, H2A_TEST_QUALIFICATION_ROOT: nativeQualificationRoot };
    if (env.H2A_TEST_PROC_ROOT) return env;
    let procRoot = privateProcessRoots.get(env.XDG_RUNTIME_DIR);
    if (!procRoot) {
      procRoot = createPrivateTestDirectory("proc-owned-", env.XDG_RUNTIME_DIR);
      privateProcessRoots.set(env.XDG_RUNTIME_DIR, procRoot);
    }
    return {
      ...env,
      H2A_TEST_QUALIFICATION_ROOT: nativeQualificationRoot,
      H2A_TEST_PROC_ROOT: procRoot,
      H2A_TEST_OWNED_PROC_ROOT: procRoot,
    };
  }

  function installProcessViewVariables(env) {
    for (const key of ["H2A_TEST_PROC_ROOT", "H2A_TEST_OWNED_PROC_ROOT"]) {
      if (env[key] !== undefined) process.env[key] = env[key];
    }
  }

  function isolatedNativeTestEnvironment(overrides = {}) {
    const keys = [
      "HOME",
      "XDG_RUNTIME_DIR",
      "XDG_STATE_HOME",
      "XDG_CONFIG_HOME",
      "H2A_NATIVE_SOCKET",
      "TMPDIR",
      "TMUX_TMPDIR",
      "REMOTE_CLI_CONFIG_HOME",
      "H2A_ROOT",
      "H2A_TEST_PROC_ROOT",
      "H2A_TEST_OWNED_PROC_ROOT",
      "NODE_OPTIONS",
      "H2A_TEST_STATE_ROOT",
      "H2A_TEST_STATE_BARRIER",
      "H2A_TEST_SANDBOX_NONCE",
      "H2A_TEST_STATE_RECEIPT",
      "H2A_TEST_QUALIFICATION_ROOT",
      "H2A_TEST_OWNER_HOME",
    ];
    const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]).filter(([, v]) => v !== undefined));
    Object.assign(env, overrides);
    assertIsolatedEnvironment(env);
    const prepared = privateProcessEnvironment(env);
    if (overrides === process.env) installProcessViewVariables(prepared);
    return prepared;
  }

  function nativeTestEnvironment(fixtureRoot, overrides = {}) {
    assertPrivateQualificationPath(fixtureRoot, nativeQualificationRoot);
    const d16Carry = {};
    for (const key of [
      "H2A_TEST_STATE_ROOT",
      "H2A_TEST_STATE_BARRIER",
      "H2A_TEST_SANDBOX_NONCE",
      "H2A_TEST_STATE_RECEIPT",
      "H2A_TEST_OWNER_HOME",
    ]) {
      if (process.env[key] !== undefined) d16Carry[key] = process.env[key];
    }
    const env = {
      ...d16Carry,
      H2A_TEST_QUALIFICATION_ROOT: nativeQualificationRoot,
      PATH: "/usr/bin:/bin",
      TERM: "xterm-256color",
      HOME: join(fixtureRoot, "home"),
      XDG_RUNTIME_DIR: fixtureRoot,
      XDG_STATE_HOME: join(fixtureRoot, "state"),
      XDG_CONFIG_HOME: join(fixtureRoot, "config"),
      H2A_NATIVE_SOCKET: join(fixtureRoot, "host.sock"),
      REMOTE_CLI_CONFIG_HOME: join(fixtureRoot, "config"),
      TMPDIR: join(fixtureRoot, "tmp"),
      TMUX_TMPDIR: fixtureRoot,
      H2A_ROOT: join(fixtureRoot, "store"),
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(fixtureRoot, "no-bus")}`,
      ...overrides,
    };
    assertIsolatedEnvironment(env);
    for (const key of ["HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "REMOTE_CLI_CONFIG_HOME", "TMPDIR"]) {
      mkdirSync(env[key], { recursive: true, mode: 0o700 });
    }
    return privateProcessEnvironment(env);
  }

  function installNativeTestEnvironment(env) {
    assertIsolatedEnvironment(env);
    const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    };
  }

  function setupNativeTestEnvironment(registerCleanup) {
    const fixtureRoot = createPrivateTestDirectory("s");
    const env = nativeTestEnvironment(fixtureRoot, {
      TMUX: "",
      H2A_NATIVE_HOST_LOG: join(fixtureRoot, "state", "native-host.log"),
    });
    const restoreEnvironment = installNativeTestEnvironment(env);
    registerCleanup(async () => {
      try {
        await stopPrivateNativeProcesses(env);
        await waitForPrivateNativeProcesses(env);
        rmSync(fixtureRoot, { recursive: true, force: true });
        privateProcessRoots.delete(fixtureRoot);
      } finally {
        restoreEnvironment();
      }
    });
  }

  function guardSpawn(args, options = {}) {
    assertIsolatedNativeOperation(options.env ?? process.env);
    for (const flag of ["--socket", "--registry-path"]) {
      const index = args.indexOf(flag);
      if (index !== -1) assertPrivateQualificationPath(args[index + 1], nativeQualificationRoot);
    }
  }

  /**
   * Verify a closed-image / launcher / router fixture path is strictly inside R
   * or an attested alias from the read-only D16 receipt (.qual-tmp,
   * tmp/test-runtime with `h2a-test-root-` prefix, or `/tmp` -> `R/compat-tmp`).
   */
  function assertNeutralFixturePath(path) {
    assert.ok(typeof path === "string" && isAbsolute(path));
    const abs = resolve(path);
    let boundary;
    if (abs.startsWith(nativeQualificationRoot + "/")) {
      boundary = nativeQualificationRoot;
    } else if (receipt) {
      // Translate attested aliases (.qual-tmp, tmp/test-runtime, /tmp -> compat-tmp)
      // strictly through the read-only receipt with live dev/ino verification.
      const matched = (receipt.aliases ?? []).find((alias) => {
        const vis = resolve(alias.visible);
        return abs.startsWith(vis + "/");
      });
      assert.ok(matched, `REFUSING unattested closed-fixture path: ${abs}`);
      const vis = resolve(matched.visible);
      const backing = join(receipt.root, matched.target);
      const visStat = statSync(vis);
      const backStat = statSync(backing);
      assert.equal(String(visStat.dev), matched.dev);
      assert.equal(String(visStat.ino), matched.ino);
      assert.equal(String(backStat.dev), matched.dev);
      assert.equal(String(backStat.ino), matched.ino);
      if (vis === join(REPO_ROOT, "tmp", "test-runtime")) {
        assert.ok(abs.startsWith(vis + "/h2a-test-root-"));
      }
      const firstSeg = relative(vis, abs).split("/")[0];
      assert.ok(firstSeg && firstSeg !== "..");
      boundary = join(vis, firstSeg);
    } else {
      assert.fail(`REFUSING path outside qualification root: ${abs}`);
    }
    const info = lstatSync(boundary);
    assert.ok(
      info.isDirectory() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid() &&
        (info.mode & 0o077) === 0,
    );
    assertPrivateQualificationPath(abs, boundary);
  }

  function closedBuildInvocation(command, args, env) {
    if (!isNode(command)) return false;
    const argv = args[0] === command ? args.slice(1) : args;
    const entry = argv.find(
      (value, index) =>
        argv.slice(0, index).every((arg) => /^--max-old-space-size=[0-9]+$/.test(arg)) &&
        !value.startsWith("-"),
    );
    if (typeof entry !== "string" || !isAbsolute(entry) || !/\.[cm]?js$/.test(entry)) return false;
    try {
      assertNeutralFixturePath(entry);
      for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]) {
        assertNeutralFixturePath(env[key]);
      }
      const entryHash = "sha256:" + createHash("sha256").update(fs.readFileSync(entry)).digest("hex");
      if (builtLaunchers.has(entryHash) || builtRouters.has(entryHash)) return true;
      for (let dir = dirname(entry), depth = 0; depth < 8; dir = dirname(dir), depth++) {
        assertNeutralFixturePath(dir);
        const manifestPath = join(dir, "manifest.json");
        let document;
        try {
          document = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") continue;
          return false;
        }
        const manifests =
          document.kind === "h2a-published-payload"
            ? Object.values(document.manifests)
            : [document];
        for (const manifest of manifests) {
          const hash = digest(manifest);
          const relativeEntry = relative(dir, entry);
          const declared =
            Object.values(manifest.entrypoints).includes(relativeEntry) ||
            imageTestEntries.get(hash)?.has(relativeEntry);
          if (
            !builtImages.has(hash) ||
            !declared ||
            !manifest.files.some((file) => file.path === relativeEntry && file.type === "file")
          ) {
            continue;
          }
          verifyImage(dir, manifest, hash);
          return true;
        }
        return false;
      }
    } catch {
      /* Missing receipts, changed bytes or foreign paths keep the guard. */
    }
    return false;
  }

  /**
   * Compute both the guarded environment AND arguments for ONE call.
   * Per-call decision: omitting `--import` for a verified closed image NEVER
   * leaks to a subsequent call reusing the same `env` object.
   */
  function prepareGuardedCall(command, args, env, cwd = process.cwd()) {
    if (closedBuildInvocation(command, args, env)) {
      // Verified closed image/launcher/router: preserve neutral env and omit
      // instrumentation preload for THIS call only (still under OS barrier).
      return { env, args };
    }
    const argv = args[0] === command ? args.slice(1) : args;
    const pinnedBlobRead =
      /(?:^|[/\\])git(?:\.exe)?$/.test(command) &&
      argv.length === 2 &&
      argv[0] === "show" &&
      /^[0-9a-f]{40}:[^\r\n]+$/.test(argv[1]);
    if (
      !pinnedBlobRead &&
      [command, ...args].some(
        (arg) => nativeEntry.test(String(arg)) || nativeEntry.test(resolve(cwd, String(arg))),
      )
    ) {
      try {
        guardSpawn(args, { env });
      } catch (error) {
        const state = childProcess.ChildProcess.prototype[guardInstalled];
        if (!state.expectedRefusals) state.violations.push(String(error));
        throw error;
      }
    }
    assert.ok(
      !closedProcessRoots.has(env.H2A_TEST_OWNED_PROC_ROOT),
      "REFUSING spawn after native fixture teardown",
    );
    if (!isNode(command)) return { env, args };

    // Carry D16 attestation/root into minimal Node child envs when needed.
    const carried = { ...env };
    for (const key of [
      "H2A_TEST_STATE_ROOT",
      "H2A_TEST_STATE_BARRIER",
      "H2A_TEST_SANDBOX_NONCE",
      "H2A_TEST_STATE_RECEIPT",
      "H2A_TEST_OWNER_HOME",
      "H2A_TEST_WORKER_ROOT",
      "H2A_TEST_WORKER_PID",
    ]) {
      if (carried[key] === undefined && process.env[key] !== undefined) {
        carried[key] = process.env[key];
      }
    }
    const prepared = privateProcessEnvironment(carried);
    assert.ok(
      !closedProcessRoots.has(prepared.H2A_TEST_OWNED_PROC_ROOT),
      "REFUSING spawn after native fixture teardown",
    );
    const nextArgs =
      args.includes(preload) || prepared.NODE_OPTIONS?.includes(preload)
        ? args
        : args[0] === command
          ? [args[0], preload, ...args.slice(1)]
          : [preload, ...args];
    return { env: prepared, args: nextArgs };
  }

  function registerPrivateProcess(pid, env, replace = false, survivor = false) {
    if (pid) recordCiOwnedProcess(pid);
    if (
      process.platform !== "linux" ||
      !pid ||
      !env.H2A_TEST_PROC_ROOT ||
      env.H2A_TEST_PROC_ROOT !== env.H2A_TEST_OWNED_PROC_ROOT
    ) {
      return () => {};
    }
    const procRoot = env.H2A_TEST_PROC_ROOT;
    assertPrivateQualificationPath(procRoot, nativeQualificationRoot);
    const entry = join(procRoot, String(pid));
    const fd = openSync(`/proc/${pid}`, constants.O_RDONLY | constants.O_DIRECTORY);
    const target = `/proc/${process.pid}/fd/${fd}`;
    const pin = entry + ".pin";
    let published = target;
    let pinned = false;
    try {
      if (survivor) {
        symlinkSync(target, pin);
        pinned = true;
      } else if (replace) {
        try {
          published = readlinkSync(pin);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      if (replace) {
        try {
          unlinkSync(entry);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      symlinkSync(published, entry);
    } catch (error) {
      if (pinned) unlinkSync(pin);
      closeSync(fd);
      if (error.code === "EEXIST") return () => {};
      throw error;
    }
    if (survivor) {
      if (!privatePins.has(procRoot)) privatePins.set(procRoot, new Set());
      privatePins.get(procRoot).add(pid);
    }
    return () => {
      try {
        if (readlinkSync(entry) === target) unlinkSync(entry);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (survivor) {
        try {
          if (readlinkSync(pin) === target) unlinkSync(pin);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        privatePins.get(procRoot)?.delete(pid);
      }
      closeSync(fd);
    };
  }

  function pinPrivateNativeProcess(pid, env = process.env) {
    assertIsolatedEnvironment(env);
    const prepared = privateProcessEnvironment(env);
    if (process.platform !== "linux") return registerPrivateProcess(pid, prepared, true, true);
    const releases = [];
    const queue = [pid];
    const seen = new Set();
    try {
      for (const child of queue) {
        if (seen.has(child)) continue;
        seen.add(child);
        assert.ok(seen.size <= 64, "private fixture process tree exceeds 64 children");
        releases.push(registerPrivateProcess(child, prepared, true, true));
        let children;
        try {
          children = fs.readFileSync(
            join(prepared.H2A_TEST_OWNED_PROC_ROOT, child + ".pin", "task", String(child), "children"),
            "utf8",
          );
        } catch (error) {
          if (["ENOENT", "ESRCH"].includes(error.code)) continue;
          throw error;
        }
        for (const entry of children.trim().split(/\s+/).filter(Boolean)) {
          assert.match(entry, /^[1-9]\d*$/);
          queue.push(Number(entry));
        }
      }
    } catch (error) {
      for (const rel of releases.reverse()) rel();
      throw error;
    }
    const release = () => {
      for (const rel of releases.reverse()) rel();
    };
    release.pids = [...seen];
    return release;
  }

  function installNativeTestSpawnGuard() {
    const prototype = childProcess.ChildProcess.prototype;
    if (prototype[guardInstalled]) return;
    const actualSpawn = prototype.spawn;
    const actualSpawnSync = childProcess.spawnSync;
    const actualExecFileSync = childProcess.execFileSync;
    const actualExecSync = childProcess.execSync;

    prototype.spawn = function (options) {
      const env = Object.fromEntries(
        options.envPairs.map((pair) => {
          const index = pair.indexOf("=");
          return [pair.slice(0, index), pair.slice(index + 1)];
        }),
      );
      const { env: guarded, args: nextArgs } = prepareGuardedCall(
        options.file,
        options.args,
        env,
        options.cwd ?? process.cwd(),
      );
      const result = actualSpawn.call(this, {
        ...options,
        args: nextArgs,
        envPairs: Object.entries(guarded).map(([key, value]) => `${key}=${value}`),
      });
      if (this.pid) {
        const release = registerPrivateProcess(this.pid, guarded);
        const procRoot = guarded.H2A_TEST_OWNED_PROC_ROOT;
        if (procRoot && procRoot === guarded.H2A_TEST_PROC_ROOT) {
          if (!privateChildren.has(procRoot)) privateChildren.set(procRoot, new Set());
          privateChildren.get(procRoot).add(this);
        }
        this.once("exit", () => {
          privateChildren.get(procRoot)?.delete(this);
          release();
        });
      }
      return result;
    };

    childProcess.spawnSync = function (command, args, options) {
      if (args != null && typeof args !== "object") {
        throw new TypeError("args must be an array or an options object");
      }
      if (!Array.isArray(args)) {
        options = args;
        args = [];
      }
      const { env, args: nextArgs } = prepareGuardedCall(
        command,
        args,
        options?.env ?? process.env,
        options?.cwd,
      );
      return actualSpawnSync(command, nextArgs, { ...options, env });
    };

    childProcess.execFileSync = function (command, args, options) {
      if (args != null && typeof args !== "object") {
        throw new TypeError("args must be an array or an options object");
      }
      if (!Array.isArray(args)) {
        options = args;
        args = [];
      }
      const { env, args: nextArgs } = prepareGuardedCall(
        command,
        args,
        options?.env ?? process.env,
        options?.cwd,
      );
      return actualExecFileSync(command, nextArgs, { ...options, env });
    };

    childProcess.execSync = function (command, options) {
      const { env } = prepareGuardedCall(command, [], options?.env ?? process.env, options?.cwd);
      return actualExecSync(command, { ...options, env });
    };

    const state = {
      violations: [],
      expectedRefusals: 0,
      processRoots: privateProcessRoots,
      children: privateChildren,
      pins: privatePins,
      closedRoots: closedProcessRoots,
      builtImages,
      builtLaunchers,
      builtRouters,
      imageTestEntries,
    };
    Object.defineProperty(prototype, guardInstalled, { value: state });

    const failUnexpected = () => {
      if (state.violations.length) {
        process.exitCode = 1;
        process.stderr.write(`Unexpected unsafe native test launches: ${JSON.stringify(state.violations)}\n`);
      }
    };
    process.once("beforeExit", failUnexpected);
    process.once("exit", failUnexpected);

    const actualRealpath = fs.realpathSync;
    function guardRealpath(path) {
      if (new Error().stack?.match(/native-terminal[/\\]server\.[jt]s/)) {
        assertPrivateQualificationPath(String(path), nativeQualificationRoot);
      }
    }
    fs.realpathSync = function (path, ...args) {
      guardRealpath(path);
      return actualRealpath(path, ...args);
    };
    fs.realpathSync.native = function (path, ...args) {
      guardRealpath(path);
      return actualRealpath.native(path, ...args);
    };
    syncBuiltinESMExports();
  }

  function assertNativeTestSpawnRefused(operation) {
    const state = childProcess.ChildProcess.prototype[guardInstalled];
    state.expectedRefusals += 1;
    try {
      assert.throws(operation, /REFUSING/);
    } finally {
      state.expectedRefusals -= 1;
    }
  }

  function assertNoNativeTestSpawnViolations() {
    assert.deepEqual(
      childProcess.ChildProcess.prototype[guardInstalled].violations,
      [],
      "no caught unsafe native launch may pass qualification",
    );
  }

  async function stopPrivateNativeProcesses(env) {
    const procRoot = env.H2A_TEST_OWNED_PROC_ROOT ?? privateProcessRoots.get(env.XDG_RUNTIME_DIR);
    if (!procRoot) return;
    assertPrivateQualificationPath(procRoot, nativeQualificationRoot);
    closedProcessRoots.add(procRoot);
    const children = [...(privateChildren.get(procRoot) ?? [])];
    const releases = [];
    const known = new Set(privatePins.get(procRoot) ?? []);
    const errors = [];
    const exited = children.map((child) =>
      child.exitCode === null && child.signalCode === null ? once(child, "exit") : Promise.resolve(),
    );
    const prepared = { ...env, H2A_TEST_PROC_ROOT: procRoot, H2A_TEST_OWNED_PROC_ROOT: procRoot };
    const live = (pid) => {
      try {
        return !/\) [ZX] /.test(fs.readFileSync(join(procRoot, pid + ".pin", "stat"), "utf8"));
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes(error.code)) return false;
        throw error;
      }
    };
    const signal = (pid, name) => {
      try {
        if (live(pid)) process.kill(pid, name);
      } catch (error) {
        if (error.code !== "ESRCH") errors.push(error);
      }
    };
    try {
      for (const child of children) {
        try {
          const release = pinPrivateNativeProcess(child.pid, prepared);
          releases.push(release);
          for (const pid of release.pids ?? [child.pid]) known.add(pid);
        } catch (error) {
          if (!["ENOENT", "ESRCH"].includes(error.code)) errors.push(error);
        }
      }
      const owned = () => [...known].filter((pid) => pid !== process.pid);
      for (const pid of owned()) {
        signal(pid, "SIGCONT");
        signal(pid, "SIGTERM");
      }
      const deadline = performance.now() + 500;
      while (owned().some(live) && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      for (const pid of owned().filter(live)) {
        try {
          const release = pinPrivateNativeProcess(pid, prepared);
          releases.push(release);
          for (const pidEntry of release.pids ?? [pid]) known.add(pidEntry);
        } catch (error) {
          if (!["ENOENT", "ESRCH"].includes(error.code)) errors.push(error);
        }
      }
      for (const pid of owned().reverse()) signal(pid, "SIGKILL");
      let timer;
      try {
        await Promise.race([
          Promise.all(exited),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("fixture child exit was not reaped within 1000ms")),
              1000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      await waitForPrivateNativeProcesses(prepared);
      if (errors.length) throw new AggregateError(errors, "private fixture process teardown failed");
    } finally {
      for (const release of releases.reverse()) release();
      privateChildren.delete(procRoot);
    }
  }

  async function waitForPrivateNativeProcesses(env) {
    const procRoot = env.H2A_TEST_OWNED_PROC_ROOT ?? privateProcessRoots.get(env.XDG_RUNTIME_DIR);
    if (!procRoot) return;
    assertPrivateQualificationPath(procRoot, nativeQualificationRoot);
    const deadline = Date.now() + 1_000;
    for (;;) {
      let entries;
      try {
        entries = fs.readdirSync(procRoot);
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      const alive = entries
        .filter((entry) => /^\d+$/.test(entry) && Number(entry) !== process.pid)
        .filter((entry) => {
          try {
            let p = join(procRoot, entry);
            try {
              readlinkSync(p + ".pin");
              p += ".pin";
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
            return !/\) [ZX] /.test(fs.readFileSync(join(p, "stat"), "utf8"));
          } catch (error) {
            if (error.code === "ENOENT" || error.code === "ESRCH") return false;
            throw error;
          }
        });
      if (alive.length === 0) return;
      assert.ok(
        Date.now() < deadline,
        `fixture processes still writing after host shutdown: ${alive.join(", ")}`,
      );
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  function spawnIsolatedNative(command, args = [], options = {}) {
    guardSpawn(args, options);
    return spawn(command, args, options);
  }

  function spawnSyncIsolatedNative(command, args = [], options = {}) {
    guardSpawn(args, options);
    return spawnSync(command, args, options);
  }

  function activateForCurrentProcess() {
    installNativeTestSpawnGuard();
    recordCiOwnedProcess(process.pid);
    if (nativeEntry.test(process.argv[1] ?? "")) {
      guardSpawn(process.argv.slice(1), { env: process.env });
    }
    const processEnvironment = privateProcessEnvironment(process.env);
    installProcessViewVariables(processEnvironment);
    if (
      isMainThread &&
      process.env.H2A_TEST_PROC_ROOT === process.env.H2A_TEST_OWNED_PROC_ROOT
    ) {
      process.once("exit", registerPrivateProcess(process.pid, process.env, true));
    }
  }

  return {
    nativeQualificationRoot,
    assertPrivateQualificationPath,
    createPrivateTestDirectory,
    assertIsolatedEnvironment,
    isolatedNativeTestEnvironment,
    assertIsolatedNativeOperation,
    nativeTestEnvironment,
    installNativeTestEnvironment,
    setupNativeTestEnvironment,
    pinPrivateNativeProcess,
    installNativeTestSpawnGuard,
    assertNativeTestSpawnRefused,
    assertNoNativeTestSpawnViolations,
    stopPrivateNativeProcesses,
    waitForPrivateNativeProcesses,
    spawnIsolatedNative,
    spawnSyncIsolatedNative,
    activateForCurrentProcess,
  };
}
