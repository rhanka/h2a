import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildH2aRunInvocation,
  createMcpServer,
  executeH2aRunWithSpawn,
  handleH2aRun,
  validateH2aRunRequest,
} from "../dist/runtime/mcp/index.js";
import {
  chainRelauncher,
  headlessDriver,
  headlessRelauncher,
  localTmuxDriver,
  localTmuxRelauncher,
  tmuxSendSubmit,
} from "../dist/index.js";
import {
  MCP_AGY_LAUNCH_BUDGET_MS,
  OnboardingLaunchError,
  checkAgyTrustPrecheckSync,
  h2aTrustApprovalsPath,
  withAgyStartQueueAsync,
} from "../dist/runtime/onboarding-core.js";
import { runTrustAgyCommand, runTrustInitBaselineCommand } from "../../h2a-runtime/dist/trust-cli.js";
import { renderTerminalScreen } from "../../h2a-runtime/dist/native-terminal/screen.js";
import { localTmuxLoopWakeDriver } from "../dist/runtime/loop/engine/adapters.js";
import { createH2aPtyActuator } from "../dist/runtime/drive/pty-actuator.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BIN_JS = resolve(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
const OP_JS = resolve(REPO_ROOT, "packages", "h2a-runtime", "dist", "native-terminal", "op.js");
const TMUX_DIST_JS = resolve(REPO_ROOT, "packages", "h2a-runtime", "dist", "tmux.js");
const FIXTURES_DIR = resolve(REPO_ROOT, "packages", "h2a", "test", "fixtures", "cli-onboarding");

function makeDisposableWorkspace() {
  const tmpBase = join(REPO_ROOT, ".tmp");
  mkdirSync(tmpBase, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(tmpBase, "co-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const state = join(root, "state");
  const runtime = join(root, "rt");
  const ws = join(home, "src", "app");
  const storeRoot = join(root, "store");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(config, { recursive: true, mode: 0o700 });
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  mkdirSync(ws, { recursive: true, mode: 0o755 });
  mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
  return { root, home, config, state, runtime, ws, storeRoot };
}

test("MCP h2a_run exposes zero trust-approval tools and sets 240s launch budget on agy", () => {
  const { root, storeRoot, ws } = makeDisposableWorkspace();
  try {
    const server = createMcpServer({ root: storeRoot, workspaceRoot: ws });
    const tools = server.listTools();
    assert.ok(tools.length > 0);
    for (const tool of tools) {
      assert.doesNotMatch(tool.name, /trust|approve/i);
    }

    assert.equal(MCP_AGY_LAUNCH_BUDGET_MS, 240_000);
    const req = validateH2aRunRequest(
      {
        profile: "agy",
        name: "agy-budget",
        workspace: ws,
        prompt: "inspect onboarding",
        background: true,
        gateway: "off",
        model: "gemini-3.7-flash-high",
        effort: "high",
      },
      ws,
    );
    const inv = buildH2aRunInvocation(req, BIN_JS);
    assert.ok(inv.args.includes("--launch-budget-ms"));
    assert.equal(inv.args[inv.args.indexOf("--launch-budget-ms") + 1], "240000");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP agent-launch accepts pre-create onboarding/slice/queue failures and rejects post-creation spoofs", async () => {
  const { root, ws } = makeDisposableWorkspace();
  try {
    const req = validateH2aRunRequest(
      {
        profile: "agy",
        name: "agy-precreate",
        workspace: ws,
        prompt: "inspect onboarding",
        background: true,
        gateway: "off",
        model: "gemini-3.7-flash-high",
        effort: "high",
      },
      ws,
    );

    for (const [phase, code] of [
      ["onboarding", "cli-workspace-not-trusted"],
      ["onboarding", "cli-trust-audit-mismatch"],
      ["start-queue", "cli-start-lock-timeout"],
      ["start-queue", "cli-start-lock-unavailable"],
      ["memory-slice", "cli-memory-slice-missing"],
      ["memory-slice", "cli-memory-slice-unbounded"],
      ["memory-slice", "cli-memory-scope-unavailable"],
    ]) {
      const payload = {
        kind: "h2a.run.failure",
        version: 1,
        state: "not-started",
        phase,
        code,
        error: `refused (${code})`,
        launchId: "agy-precreate",
        creationAttempted: false,
        retrySafe: true,
        prompt: { delivered: false },
      };
      const out = executeH2aRunWithSpawn(req, () => ({
        status: 1,
        stdout: JSON.stringify(payload),
        stderr: `[h2a] h2a.run.phase/v1 {"launchId":"agy-precreate","phase":"pre-creation"}\n`,
      }));
      assert.deepEqual(out, payload);

      // Post-creation phase marker must NOT be reclassified as pre-create safe.
      assert.throws(() =>
        executeH2aRunWithSpawn(req, () => ({
          status: 1,
          stdout: JSON.stringify(payload),
          stderr: `[h2a] h2a.run.phase/v1 {"launchId":"agy-precreate","phase":"creation-attempted"}\n`,
        })),
      );
    }

    // Live host-modal failure (e.g. Codex hooks Q4-A or trust modal) propagates cleanly.
    const modalFailure = {
      kind: "h2a.run.failure",
      version: 1,
      state: "host-modal",
      code: "cli-hooks-review-required",
      launchId: "agy-precreate",
      error: "hooks need review",
      stopped: true,
      retrySafe: false,
      prompt: { delivered: false },
    };
    const spawnModal = executeH2aRunWithSpawn(req, () => ({
      status: 1,
      stdout: JSON.stringify(modalFailure),
      stderr: "",
    }));
    assert.equal(spawnModal.code, "cli-hooks-review-required");
    assert.equal(spawnModal.state, "host-modal");

    const res = await handleH2aRun(
      {
        profile: "agy",
        name: "agy-precreate",
        workspace: ws,
        prompt: "inspect onboarding",
        background: true,
        gateway: "off",
        model: "gemini-3.7-flash-high",
        effort: "high",
      },
      ws,
      async () => modalFailure,
    );
    assert.equal(res.code, "cli-hooks-review-required");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fail-closed pane input and relaunch guards block zero keystrokes when capture missing or modal present", async () => {
  const { root, home, ws } = makeDisposableWorkspace();
  const prevHome = process.env.HOME;
  try {
    process.env.HOME = home;
    const sent = [];
    const noCaptureRuntime = {
      run: (file, args) => { sent.push([file, ...args]); return true; },
      spawnDetached: () => { sent.push(["spawnDetached"]); return true; },
      capture: () => undefined,
    };

    assert.equal(tmuxSendSubmit(noCaptureRuntime, "%1", "hi", { profile: "codex", mode: "cli-input" }), false);
    assert.equal(
      localTmuxDriver({ runtime: noCaptureRuntime }).drive({
        to: "codex:w",
        instructionLine: "hi",
        launchContext: { cwd: ws, command: "codex", tmux: { session: "s", pane: "%1" } },
      }),
      false,
    );
    assert.equal(
      localTmuxLoopWakeDriver({ runtime: noCaptureRuntime }).drive({
        to: "agy:w",
        instructionLine: "hi",
        launchContext: { cwd: ws, command: "agy", tmux: { session: "s", pane: "%1" } },
      }),
      "failed",
    );
    assert.equal(
      localTmuxRelauncher({ runtime: noCaptureRuntime }).relance({
        instance: "codex:w",
        reason: "stopped",
        workStatus: "paused",
        launchContext: { cwd: ws, command: "codex resume", tmux: { session: "s", pane: "%1" } },
        relanceCount: 0,
      }),
      false,
    );
    assert.equal(sent.length, 0);

    // Modal present on pane -> zero keystrokes.
    const modalRuntime = {
      run: (file, args) => { sent.push([file, ...args]); return true; },
      spawnDetached: () => { sent.push(["spawnDetached"]); return true; },
      capture: (_file, args) =>
        args.includes("capture-pane")
          ? "Review plugin hooks\n1. Approve\nEnter to confirm"
          : undefined,
    };
    assert.equal(tmuxSendSubmit(modalRuntime, "%1", "hi", { profile: "muse", mode: "cli-input" }), false);
    assert.equal(sent.length, 0);

    // Unknown relaunch command fails closed in drumbeat & pty actuator.
    assert.equal(
      headlessRelauncher({ runtime: modalRuntime }).relance({
        instance: "custom:1",
        reason: "stopped",
        workStatus: "paused",
        launchContext: { cwd: ws, command: "unknown-binary --flag" },
        relanceCount: 0,
      }),
      false,
    );
    const actuator = createH2aPtyActuator({
      resolveActuationTarget: () => ({
        kind: "tmux",
        target: "s:0.0",
        instance: "custom:1",
        launchContext: { cwd: ws, command: "opaque-unclassified-bin" },
      }),
    });
    const actRes = await actuator.actuate({
      registration: { actuatorRef: "h2a-pty:v1:worker" },
      action: "relaunch",
      commandRef: "cmd-1",
    });
    assert.equal(actRes.outcome, "failed");
    assert.equal(sent.length, 0);

    // headlessDriver & headlessRelauncher for agy fail closed on untrusted cwd, and never spawn raw "agy" on trusted cwd.
    const spawned = [];
    const headlessRt = {
      run: () => false,
      spawnDetached: (command, opts) => { spawned.push({ command, opts }); return true; },
    };
    assert.equal(
      headlessDriver({ runtime: headlessRt }).drive({
        host: "agy",
        to: "agy:w",
        instructionLine: "signed line",
        launchContext: { cwd: ws, command: "agy" },
      }),
      false,
    );
    assert.equal(spawned.length, 0);

    // Seed trusted settings.json in disposable HOME -> routes cleanly via `h2a run agy` (NEVER raw `agy -p`).
    mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(home, ".gemini", "antigravity-cli", "settings.json"),
      JSON.stringify({ trustedWorkspaces: [realpathSync(ws)] }),
      { mode: 0o600 },
    );
    assert.equal(
      headlessDriver({ runtime: headlessRt }).drive({
        host: "agy",
        to: "agy:w",
        instructionLine: "signed line",
        launchContext: { cwd: ws, command: "agy" },
      }),
      true,
    );
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].command.file, process.execPath);
    assert.ok(spawned[0].command.args.includes("run"));
    assert.ok(spawned[0].command.args.includes("agy"));
    assert.equal(spawned[0].command.input, "signed line");

    // chainRelauncher with unknown agy command fails closed without hitting fallback.
    assert.equal(
      await chainRelauncher(
        headlessRelauncher({ runtime: { run: () => false, spawnDetached: () => false } }),
      ).relance({
        instance: "x:1",
        reason: "stopped",
        workStatus: "paused",
        launchContext: { cwd: ws, command: "unknown-tool" },
        relanceCount: 0,
      }),
      false,
    );
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("static CI guard verifies serialized lock, classifier, and modal guards across launch & wake sites", () => {
  const mustMatch = [
    ["packages/h2a-runtime/src/native-host.ts", /withAgyStartQueueAsync/],
    ["packages/h2a-runtime/src/native-host.ts", /withAgyStartQueueSync/],
    ["packages/h2a-runtime/src/native-host.ts", /launchBudgetMs:\s*metadata\.launchBudgetMs/],
    ["packages/h2a-runtime/src/tmux.ts", /withAgyStartQueueSync/],
    ["packages/h2a-runtime/src/tmux.ts", /guardTmuxPaneBeforeInput/],
    ["packages/h2a-runtime/src/tmux.ts", /export function relaunchInSession\([\s\S]{0,600}guardTmuxPaneBeforeInput/],
    ["packages/h2a-runtime/src/tmux.ts", /export function sendKeysLiteral\([\s\S]{0,200}guardTmuxPaneBeforeInput/],
    ["packages/h2a-runtime/src/index.ts", /checkAgyTrustPrecheckSync/],
    ["packages/h2a-runtime/src/index.ts", /withAgyStartQueueSync/],
    ["packages/h2a-runtime/src/index.ts", /guardTmuxPaneBeforeInput/],
    ["packages/h2a-runtime/src/native-terminal/op.ts", /guardPaneBeforeAutomatedInput/],
    ["packages/h2a-runtime/src/prompt-delivery.ts", /guardPaneBeforeAutomatedInput/],
    ["packages/h2a/src/runtime/drumbeat/relaunchers.ts", /guardPaneBeforeAutomatedInput/],
    ["packages/h2a/src/runtime/drumbeat/relaunchers.ts", /classifyCliCommand/],
    ["packages/h2a/src/runtime/drive/index.ts", /classifyCliCommand/],
    ["packages/h2a/src/runtime/drive/index.ts", /checkAgyTrustPrecheckSync/],
    ["packages/h2a/src/runtime/drive/pty-actuator.ts", /classifyCliCommand/],
    ["packages/h2a/scripts/qualification-capture.mjs", /withAgyStartQueueSync/],
    ["packages/h2a/scripts/qualification-poll-hosts.mjs", /withAgyStartQueueSync/],
  ];
  for (const [relPath, re] of mustMatch) {
    const content = readFileSync(resolve(REPO_ROOT, relPath), "utf8");
    assert.match(content, re, `expected ${relPath} to contain ${re}`);
  }

  // NB-10: Exhaustively scan all non-test sources under packages/h2a*/src/ for tmux
  // send-keys / paste-buffer spawns; every caller must stay in the guarded allowlist.
  const allowedTmuxSendFiles = new Set([
    "packages/h2a-runtime/src/tmux.ts",
    "packages/h2a-runtime/src/index.ts",
    "packages/h2a/src/runtime/drumbeat/relaunchers.ts",
  ]);
  const walkSrcFiles = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkSrcFiles(full, out);
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        out.push(full);
      }
    }
    return out;
  };
  const allSrcFiles = [
    ...walkSrcFiles(resolve(REPO_ROOT, "packages", "h2a", "src")),
    ...walkSrcFiles(resolve(REPO_ROOT, "packages", "h2a-runtime", "src")),
  ];
  for (const file of allSrcFiles) {
    const rel = file.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
    const content = readFileSync(file, "utf8");
    if (/(?:send-keys|paste-buffer)/.test(content)) {
      const callsTmuxSend =
        /spawnSync\s*\([^;]{0,120}(?:send-keys|paste-buffer)/.test(content) ||
        /runtime\.run\s*\([^;]{0,120}(?:send-keys|paste-buffer)/.test(content);
      if (callsTmuxSend) {
        assert.ok(
          allowedTmuxSendFiles.has(rel),
          `unguarded tmux send-keys / paste-buffer spawn found outside allowlist: ${rel}`,
        );
      }
    }
  }
});

test("CLI integration in disposable HOME: h2a run agy pre-check refusal, owner-only trust refusal, and out-of-band ls/status alerts", () => {
  const { root, home, config, state, runtime, ws } = makeDisposableWorkspace();
  try {
    const baseEnv = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: config,
      XDG_STATE_HOME: state,
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_RUNTIME_DIR: runtime,
      TMUX_TMPDIR: runtime,
      TMUX: "",
      H2A_NATIVE_SOCKET: join(runtime, "h.sock"),
      H2A_MCP_CENTRAL: "off",
      H2A_ROOT: join(root, "h2a-root"),
      REMOTE_CLI_CONFIG_HOME: join(root, "remote-cli"),
      H2A_SESSION_HOST: "tmux",
    };

    // 1. Untrusted workspace -> fails pre-create before any tmux or start-lock.
    const runRes = spawnSync(
      process.execPath,
      [
        BIN_JS,
        "run",
        "agy",
        ws,
        "--name",
        "untrusted-check",
        "--background",
        "--no-attach",
        "--no-h2a",
        "--prompt-stdin",
        "--json",
      ],
      { env: baseEnv, input: "hello", encoding: "utf8" },
    );
    assert.notEqual(runRes.status, 0);
    const jsonLine = (runRes.stdout ?? "").trim().split("\n").pop();
    const parsed = JSON.parse(jsonLine);
    assert.equal(parsed.kind, "h2a.run.failure");
    assert.equal(parsed.state, "not-started");
    assert.equal(parsed.phase, "onboarding");
    assert.equal(parsed.code, "cli-workspace-not-trusted");
    assert.equal(parsed.creationAttempted, false);
    assert.equal(parsed.retrySafe, true);

    // 2. h2a trust inside H2A_SESSION_CLASS refuses cleanly.
    const trustInsideRes = spawnSync(
      process.execPath,
      [BIN_JS, "trust", "agy", ws],
      { env: { ...baseEnv, H2A_SESSION_CLASS: "human" }, encoding: "utf8" },
    );
    assert.notEqual(trustInsideRes.status, 0);
    assert.match(trustInsideRes.stderr, /forbidden inside any h2a session|interactive owner TTY required/i);

    // 3. Out-of-band entry in settings.json surfaces alert on stderr in `h2a ls --local` and `h2a status`.
    mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(home, ".gemini", "antigravity-cli", "settings.json"),
      JSON.stringify({ trustedWorkspaces: [realpathSync(ws)] }),
      { mode: 0o600 },
    );
    const lsRes = spawnSync(process.execPath, [BIN_JS, "ls", "--local"], {
      env: baseEnv,
      encoding: "utf8",
    });
    assert.equal(lsRes.status, 0);
    assert.match(lsRes.stderr, /TRUST ALERT oob-agy-/);

    const statusRes = spawnSync(process.execPath, [BIN_JS, "status"], {
      env: baseEnv,
      encoding: "utf8",
    });
    assert.equal(statusRes.status, 0);
    assert.match(statusRes.stderr, /TRUST ALERT oob-agy-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B-1 & B-4 real captures: 0 keystrokes on agy 1.5.17 B-child (.txt/.raw) across tmuxSendSubmit, relaunchInSession, sendKeysLiteral, op drive; normal claude/codex proceed", async () => {
  const bChildTxt = readFileSync(join(FIXTURES_DIR, "agy-outputs", "B-child.txt"), "utf8");
  const bChildRaw = readFileSync(join(FIXTURES_DIR, "agy-outputs", "B-child.raw"), "utf8");
  const bChildRendered = await renderTerminalScreen(bChildRaw);
  const claudeReadyRaw = readFileSync(join(FIXTURES_DIR, "pty18-outputs", "after-claude-h2a.out.raw"), "utf8");
  const codexReadyRaw = readFileSync(join(FIXTURES_DIR, "pty18-outputs", "after-codex-h2a.out.raw"), "utf8");

  // 1. tmuxSendSubmit blocks both B-child.txt and rendered B-child.raw with or without profile.
  for (const screen of [bChildTxt, bChildRendered]) {
    for (const prof of ["agy", undefined]) {
      for (const mode of ["cli-input", "shell-relaunch"]) {
        const calls = [];
        const rt = {
          run: (f, a) => { calls.push([f, ...a]); return true; },
          capture: (_f, a) => (a.includes("capture-pane") ? screen : undefined),
        };
        assert.equal(tmuxSendSubmit(rt, "%9", "hi", { profile: prof, mode }), false);
        assert.equal(calls.length, 0);
      }
    }
  }

  // 2. Real subprocess fake-tmux test for relaunchInSession & sendKeysLiteral (profile="agy" AND missing @profile).
  const tmpBase = join(REPO_ROOT, ".tmp");
  mkdirSync(tmpBase, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(tmpBase, "h2a-b1-tmux-"));
  try {
    const binDir = join(root, "bin");
    const captureFile = join(root, "pane-capture.txt");
    const logFile = join(root, "tmux-calls.log");
    mkdirSync(binDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(binDir, "tmux"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
  capture-pane) cat "$FAKE_PANE_CAPTURE"; exit 0 ;;
  show-options) if [ -n "$FAKE_PROFILE" ]; then printf '%s\\n' "$FAKE_PROFILE"; exit 0; fi; exit 1 ;;
  list-sessions) printf 'h2a-b1:1\\n'; exit 0 ;;
  display|display-message) printf '%%9\\n'; exit 0 ;;
  *) exit 0 ;;
esac
`,
      { mode: 0o755 },
    );

    const probeScript = `
      import assert from "node:assert/strict";
      import { relaunchInSession, sendKeysLiteral } from ${JSON.stringify(pathToFileURL(TMUX_DIST_JS).href)};
      assert.equal(relaunchInSession("h2a-b1", "claude --continue"), false);
      assert.equal(sendKeysLiteral("%9", "hello"), false);
    `;
    for (const [label, screen] of [["B-child.txt", bChildTxt], ["B-child.raw-rendered", bChildRendered]]) {
      for (const fakeProfile of ["agy", ""]) {
        writeFileSync(captureFile, screen, "utf8");
        writeFileSync(logFile, "", "utf8");
        const runRes = spawnSync(
          process.execPath,
          ["--input-type=module", "-e", probeScript],
          {
            env: {
              ...process.env,
              PATH: `${binDir}:${process.env.PATH ?? ""}`,
              FAKE_TMUX_LOG: logFile,
              FAKE_PANE_CAPTURE: captureFile,
              FAKE_PROFILE: fakeProfile,
            },
            encoding: "utf8",
          },
        );
        assert.equal(runRes.status, 0, `${label} profile=${fakeProfile}: ${runRes.stderr}`);
        const tmuxLog = readFileSync(logFile, "utf8");
        assert.equal(/send-keys|load-buffer|paste-buffer/.test(tmuxLog), false, `expected 0 keystrokes for ${label} profile=${fakeProfile}, got:\n${tmuxLog}`);
      }
    }

    // 3. Real UNIX socket op.js drive test streaming B-child.raw ANSI bytes verbatim -> 0 writes!
    const sockDir = join(root, "sock");
    mkdirSync(sockDir, { recursive: true, mode: 0o700 });
    const sockPath = join(sockDir, "host.sock");
    let currentRaw = bChildRaw;
    const writes = [];
    const srv = createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        for (;;) {
          const nl = buf.indexOf("\n");
          if (nl < 0) break;
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          let result = {};
          if (req.operation === "ping") {
            result = {
              protocolVersion: 1,
              generation: "gen-1",
              hostPid: process.pid,
              softRespawn: true,
              applicationFacetVersion: 2,
            };
          } else if (req.operation === "list") {
            result = [{
              id: "s1",
              status: "running",
              pid: process.pid,
              generation: "gen-1",
              incarnation: "inc-1",
            }];
          } else if (req.operation === "acquire-controller-if-no-recent-human") {
            result = {
              id: "lease-1",
              sessionId: "s1",
              generation: "gen-1",
              incarnation: "inc-1",
            };
          } else if (req.operation === "read-output") {
            result = {
              chunks: [{ seq: 1, data: currentRaw }],
              latestSeq: 1,
            };
          } else if (req.operation === "write") {
            writes.push(req.params?.data ?? "");
            result = { ok: true };
          }
          conn.write(JSON.stringify({ version: 1, id: req.id, ok: true, result }) + "\n");
        }
      });
    });
    await new Promise((res) => srv.listen(sockPath, res));
    chmodSync(sockPath, 0o600);
    const runOpDrive = (extraArgs) =>
      new Promise((resPromise, rejPromise) => {
        const child = spawn(
          process.execPath,
          [OP_JS, "drive", "--socket", sockPath, "--id", "s1", "--b64", Buffer.from("signed ping", "utf8").toString("base64"), ...extraArgs],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d; });
        child.stderr.on("data", (d) => { stderr += d; });
        child.once("error", rejPromise);
        child.once("close", (status) => resPromise({ status, stdout, stderr }));
      });

    try {
      for (const extra of [["--profile", "agy"], []]) {
        const res = await runOpDrive(extra);
        assert.equal(res.status, 0, res.stderr);
        const parsed = JSON.parse(res.stdout.trim());
        assert.equal(parsed.outcome, "failed");
        assert.equal(parsed.code, "cli-workspace-not-trusted");
      }
      assert.equal(writes.length, 0, "op drive must emit ZERO writes on B-child.raw");

      // B-4: Normal claude & codex screens drive cleanly via op.js drive.
      for (const [profile, raw] of [["claude", claudeReadyRaw], ["codex", codexReadyRaw]]) {
        currentRaw = raw;
        const res = await runOpDrive(["--profile", profile]);
        assert.equal(res.status, 0, res.stderr);
        assert.equal(JSON.parse(res.stdout.trim()).outcome, "driven");
      }
      assert.equal(writes.length, 2);
    } finally {
      await new Promise((res) => srv.close(res));
    }

    // B-4: localTmuxDriver succeeds on normal claude & codex screens even quoting modal phrases.
    for (const [profile, cmd, screen] of [
      ["claude", "claude", `${await renderTerminalScreen(claudeReadyRaw)}\nHooks need review, Trust and continue, Welcome to Claude Code\n❯ \n  ⏵⏵ auto mode on (shift+tab to cycle)`],
      ["codex", "codex", `${await renderTerminalScreen(codexReadyRaw)}\nHooks need review, Trust and continue, Do you trust the contents of this project?\n› Ask Codex\n· ~/src/h2a`],
    ]) {
      const sent = [];
      const driver = localTmuxDriver({
        runtime: {
          run: (f, a) => { sent.push([f, ...a]); return true; },
          capture: () => screen,
        },
      });
      assert.equal(
        driver.drive({
          to: `${profile}:w`,
          instructionLine: "continue work",
          launchContext: { cwd: root, command: cmd, tmux: { session: "s", pane: "%1" } },
        }),
        true,
        `${profile} normal screen with quoted modal prose must not block localTmuxDriver`,
      );
      assert.ok(sent.some((c) => c.includes("send-keys")), `expected send-keys for normal ${profile}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B-2 & B-3 & NB-4: baseline non-replay, no-init-baseline hint, human precheck behavior, and 3-starter flock proof", async () => {
  const cleanBaseEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.startsWith("H2A_") &&
        !k.startsWith("CLAUDE") &&
        k !== "TMUX" &&
        k !== "TMUX_PANE",
    ),
  );
  const { root, home, config, state, runtime, ws } = makeDisposableWorkspace();
  try {
    const env = {
      ...cleanBaseEnv,
      HOME: home,
      XDG_CONFIG_HOME: config,
      XDG_STATE_HOME: state,
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_RUNTIME_DIR: runtime,
    };
    const settingsDir = join(home, ".gemini", "antigravity-cli");
    mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(settingsDir, "settings.json"),
      JSON.stringify({ trustedWorkspaces: [realpathSync(ws)] }),
      { mode: 0o600 },
    );

    const startLock = join(runtime, "agy-start.lock");
    const makeDeps = (answers) => {
      let i = 0;
      return {
        env,
        startLockPath: startLock,
        stdinIsTTY: true,
        stdoutIsTTY: true,
        promptLine: async () => answers[i++] ?? "",
        stdout: () => {},
        stderr: () => {},
      };
    };

    // Initial baseline requires confirmation and does NOT write trust-approvals.json.
    const approvalsFile = h2aTrustApprovalsPath(env);
    assert.equal(await runTrustInitBaselineCommand(makeDeps(["n"])), 1);
    assert.equal(await runTrustInitBaselineCommand(makeDeps(["y"])), 0);
    assert.equal(existsSync(approvalsFile), false);

    // Replay without confirmation fails cleanly.
    assert.equal(await runTrustInitBaselineCommand(makeDeps(["n"])), 1);

    // Forged subtree in trust-approvals.json raises cli-trust-audit-mismatch without init-baseline hint.
    mkdirSync(dirname(approvalsFile), { recursive: true, mode: 0o700 });
    writeFileSync(
      approvalsFile,
      JSON.stringify({ agy: { subtrees: [realpathSync(ws)], exact: [], refused: [] } }),
      { mode: 0o600 },
    );
    let errCode = "";
    let errHint = "";
    try {
      checkAgyTrustPrecheckSync({ cwd: ws, env });
    } catch (e) {
      if (e instanceof OnboardingLaunchError) {
        errCode = e.code;
        errHint = e.hint ?? "";
      }
    }
    assert.equal(errCode, "cli-trust-audit-mismatch");
    assert.equal(/init-baseline/.test(errHint), false);

    // NB-4: refused path must fail closed even in `h2a run agy <refused>` without `--background`.
    writeFileSync(
      approvalsFile,
      JSON.stringify({ agy: { subtrees: [], exact: [], refused: [] } }),
      { mode: 0o600 },
    );
    const refusedDir = join(home, "src", "blocked-ws");
    mkdirSync(refusedDir, { recursive: true });
    assert.equal(await runTrustAgyCommand(refusedDir, { refuse: true }, makeDeps(["blocked-ws"])), 0);
    const runRefused = spawnSync(
      process.execPath,
      [BIN_JS, "run", "agy", refusedDir, "--name", "refused-human-check", "--no-h2a"],
      { env: { ...env, TMUX: "", H2A_MCP_CENTRAL: "off", H2A_SESSION_HOST: "tmux" }, encoding: "utf8" },
    );
    assert.equal(runRefused.status, 1);
    assert.match(runRefused.stderr, /marked as refused/i);

    // B-3: 3-starter counterexample (h2a A -> bash script truncating with 9> -> h2a B) using 0664 lock & real flock.
    writeFileSync(startLock, "legacy", { mode: 0o664 });
    chmodSync(startLock, 0o664);
    let tA = 0;
    await withAgyStartQueueAsync(async () => { tA = Date.now(); return { result: "A", workerPid: process.pid }; }, {
      lockPath: startLock, spacingMs: 180, postSpawnMaxHoldMs: 10, checkWorkerAgy: () => true, onWait: () => {},
    });
    const scriptOut = spawnSync("/bin/bash", ["-c", `( flock 9; sleep 0.2 ) 9>"$LOCK"; date +%s%3N`], {
      env: { LOCK: startLock }, encoding: "utf8",
    });
    assert.equal(scriptOut.status, 0);
    const tS = Number(scriptOut.stdout.trim());
    let tB = 0;
    await withAgyStartQueueAsync(async () => { tB = Date.now(); return { result: "B", workerPid: process.pid }; }, {
      lockPath: startLock, spacingMs: 180, postSpawnMaxHoldMs: 10, checkWorkerAgy: () => true, onWait: () => {},
    });
    assert.ok(tS - tA >= 150);
    assert.ok(tB - tS >= 160);
    assert.equal(statSync(startLock).mode & 0o777, 0o600);
    assert.equal(readFileSync(startLock, "utf8"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
