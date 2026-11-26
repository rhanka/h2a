import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
} from "../dist/runtime/onboarding-core.js";
import { localTmuxLoopWakeDriver } from "../dist/runtime/loop/engine/adapters.js";
import { createH2aPtyActuator } from "../dist/runtime/drive/pty-actuator.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BIN_JS = resolve(REPO_ROOT, "packages", "h2a", "dist", "bin.js");

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
    ["packages/h2a-runtime/src/tmux.ts", /withAgyStartQueueSync/],
    ["packages/h2a-runtime/src/tmux.ts", /guardTmuxPaneBeforeInput/],
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
