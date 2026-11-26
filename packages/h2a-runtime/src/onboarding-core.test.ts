import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, chmodSync, statSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGY_QUALIFIED_VERSION,
  canonicalizeWorkspacePath,
  checkAgyTrustPrecheckSync,
  classifyCliCommand,
  collectTrustAlertsReadOnly,
  computeAgyMemoryLimits,
  deterministicOutOfBandAlertId,
  guardPaneBeforeAutomatedInput,
  inspectAgyAgentsSliceSync,
  MCP_AGY_LAUNCH_BUDGET_MS,
  MIN_AGY_START_SPACING_MS,
  OnboardingLaunchError,
  paneIsReady,
  resolveMemoryScopeSpec,
  withAgyStartQueueAsync,
  withAgyStartQueueSync,
} from "./onboarding-core.js";
import { deriveSessionClass, sessionClassFromEnv } from "./session-class.js";
import {
  assertOwnerTerminalAccess,
  isInsideH2aSessionEnv,
  runTrustAgyCommand,
  runTrustAuditCommand,
  runTrustInitBaselineCommand,
  type TrustCliDeps,
} from "./trust-cli.js";
import { formatTrustOwnerAlertLines, readTrustOwnerAlerts } from "./trust-alerts.js";

const tempDirs: string[] = [];

function makeSandboxEnv() {
  const root = mkdtempSync(join(tmpdir(), "h2a-onboarding-test-"));
  tempDirs.push(root);
  const home = join(root, "home");
  const xdgConfig = join(root, "config");
  const xdgState = join(root, "state");
  const runUser = join(root, "run-user");
  const ws = join(home, "src", "repo");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(xdgConfig, { recursive: true, mode: 0o700 });
  mkdirSync(xdgState, { recursive: true, mode: 0o700 });
  mkdirSync(runUser, { recursive: true, mode: 0o700 });
  mkdirSync(ws, { recursive: true, mode: 0o755 });
  const env: Record<string, string> = {
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_STATE_HOME: xdgState,
  };
  return {
    root,
    home,
    xdgConfig,
    xdgState,
    runUser,
    startLockPath: join(runUser, "agy-start.lock"),
    ws,
    env,
  };
}

function ownerDeps(
  env: Readonly<Record<string, string>>,
  startLockPath: string,
  answers: string[],
): TrustCliDeps & { outText: () => string; errText: () => string } {
  let out = "";
  let err = "";
  let idx = 0;
  return {
    env,
    stdinIsTTY: true,
    stdoutIsTTY: true,
    startLockPath,
    promptLine: async () => answers[idx++] ?? "",
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
    outText: () => out,
    errText: () => err,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("onboarding constants and session class NB-10", () => {
  it("exports expected Lot 1a constants and fail-closed inherited background class", () => {
    expect(AGY_QUALIFIED_VERSION).toBe("1.5.17");
    expect(MIN_AGY_START_SPACING_MS).toBe(13_000);
    expect(MCP_AGY_LAUNCH_BUDGET_MS).toBe(240_000);
    expect(sessionClassFromEnv("background")).toBe("background");
    expect(
      deriveSessionClass({
        background: false,
        headless: false,
        humanTerminal: true,
        inheritedClass: "background",
      }),
    ).toBe("background");
    expect(
      deriveSessionClass({
        background: false,
        headless: false,
        humanTerminal: true,
      }),
    ).toBe("human");
  });
});

describe("trust pre-check (Q1-A, Q2-C) and owner-only h2a trust", () => {
  it("refuses untrusted workspaces pre-create in read-only mode", () => {
    const { env, ws } = makeSandboxEnv();
    expect(() => checkAgyTrustPrecheckSync({ cwd: ws, env })).toThrowError(OnboardingLaunchError);
    try {
      checkAgyTrustPrecheckSync({ cwd: ws, env });
    } catch (err) {
      const failure = (err as OnboardingLaunchError).toRunFailure("worker-1");
      expect(failure).toMatchObject({
        kind: "h2a.run.failure",
        state: "not-started",
        phase: "onboarding",
        code: "cli-workspace-not-trusted",
        creationAttempted: false,
        retrySafe: true,
        prompt: { delivered: false },
      });
    }
    expect(existsSync(join(env.XDG_CONFIG_HOME!, "sentropic"))).toBe(false);
    expect(existsSync(join(env.XDG_STATE_HOME!, "h2a"))).toBe(false);
  });

  it("refuses h2a trust in non-TTY or inside any h2a session (owner-only Q1-A)", async () => {
    const { env, startLockPath, ws } = makeSandboxEnv();
    expect(isInsideH2aSessionEnv({ H2A_SESSION_CLASS: "human" })).toBe(true);
    expect(isInsideH2aSessionEnv({ H2A_SESSION_CLASS: "background" })).toBe(true);
    expect(isInsideH2aSessionEnv({ H2A_NATIVE_TERMINAL: "1" })).toBe(true);
    expect(isInsideH2aSessionEnv({ HOME: env.HOME })).toBe(false);

    expect(() =>
      assertOwnerTerminalAccess({ env: { ...env, H2A_SESSION_CLASS: "human" }, stdinIsTTY: true, stdoutIsTTY: true }),
    ).toThrow(/forbidden inside any h2a session/i);
    expect(() =>
      assertOwnerTerminalAccess({ env, stdinIsTTY: false, stdoutIsTTY: true }),
    ).toThrow(/interactive owner TTY required/i);

    await expect(
      runTrustAgyCommand(ws, {}, { env: { ...env, H2A_SESSION_CLASS: "background" }, stdinIsTTY: true, stdoutIsTTY: true, startLockPath }),
    ).rejects.toThrow(/forbidden inside any h2a session/i);
  });

  it("aborts cleanly on basename mismatch and approves Q2-C subtrees on exact retype", async () => {
    const { env, home, startLockPath, ws } = makeSandboxEnv();
    const mismatchDeps = ownerDeps(env, startLockPath, ["wrong-name"]);
    expect(await runTrustAgyCommand(ws, {}, mismatchDeps)).toBe(1);
    expect(existsSync(join(home, ".gemini", "antigravity-cli", "settings.json"))).toBe(false);

    // Protected $HOME cannot be approved.
    await expect(
      runTrustAgyCommand(home, {}, ownerDeps(env, startLockPath, [basename(home)])),
    ).rejects.toThrow(/protected root directory/i);

    // Approve repo root with exact basename confirmation.
    const approveDeps = ownerDeps(env, startLockPath, [basename(ws)]);
    expect(await runTrustAgyCommand(ws, {}, approveDeps)).toBe(0);

    const sub = join(ws, "packages", "sub");
    const internalWt = join(ws, ".h2a", "jobs", "j1", "wt");
    mkdirSync(sub, { recursive: true });
    mkdirSync(internalWt, { recursive: true });
    writeFileSync(join(ws, ".git"), "gitdir: /somewhere");
    writeFileSync(join(internalWt, ".git"), "gitdir: ../.git/worktrees/j1");

    // Pre-check at exact root requires no --settings override.
    const rootCheck = checkAgyTrustPrecheckSync({ cwd: ws, env });
    expect(rootCheck.coverage).toBe("settings-exact");
    expect(rootCheck.needsSettingsOverride).toBe(false);

    // Pre-check at internal subdirs (including internal worktree) passes via Q2-C and synthesizes --settings union.
    for (const target of [sub, internalWt]) {
      const subCheck = checkAgyTrustPrecheckSync({ cwd: target, env });
      expect(subCheck.coverage).toBe("subtree-rule");
      expect(subCheck.needsSettingsOverride).toBe(true);
      const parsed = JSON.parse(subCheck.settingsOverrideJson!) as { trustedWorkspaces: string[] };
      expect(parsed.trustedWorkspaces).toContain(realpathSync(ws));
      expect(parsed.trustedWorkspaces).toContain(realpathSync(target));
    }

    // External worktree outside repo must redemand approval.
    const extWt = join(home, "worktrees", "other-wt");
    mkdirSync(extWt, { recursive: true });
    writeFileSync(join(extWt, ".git"), "gitdir: ../../src/repo/.git/worktrees/ext");
    expect(() => checkAgyTrustPrecheckSync({ cwd: extWt, env })).toThrowError(/not trust workspace/i);

    // Nested independent git repo inside approved folder does not inherit parent approval.
    const nestedRepo = join(ws, "vendor", "other-repo");
    mkdirSync(join(nestedRepo, ".git"), { recursive: true });
    expect(() => checkAgyTrustPrecheckSync({ cwd: nestedRepo, env })).toThrowError(/not trust workspace/i);

    // Explicit refusal overrides parent subtree approval.
    const refusedDir = join(ws, "secret-subdir");
    mkdirSync(refusedDir, { recursive: true });
    expect(await runTrustAgyCommand(refusedDir, { refuse: true }, ownerDeps(env, startLockPath, [basename(refusedDir)]))).toBe(0);
    expect(() => checkAgyTrustPrecheckSync({ cwd: refusedDir, env })).toThrowError(/marked as refused/i);
  });

  it("canonicalizes symlinks cleanly and enforces private permissions + audit consistency", async () => {
    const { env, root, startLockPath, ws, xdgState, xdgConfig } = makeSandboxEnv();
    const linkPath = join(root, "repo-link");
    symlinkSync(ws, linkPath);
    expect(canonicalizeWorkspacePath(linkPath)).toBe(realpathSync(ws));

    expect(await runTrustAgyCommand(linkPath, {}, ownerDeps(env, startLockPath, [basename(ws)]))).toBe(0);
    const approvalsPath = join(xdgConfig, "sentropic", "h2a", "trust-approvals.json");
    const auditPath = join(xdgState, "h2a", "trust-audit.jsonl");
    expect(statSync(approvalsPath).mode & 0o777).toBe(0o600);
    expect(statSync(auditPath).mode & 0o777).toBe(0o600);

    // Adding an un-audited entry directly to trust-approvals.json must fail closed with cli-trust-audit-mismatch.
    const approvals = JSON.parse(readFileSync(approvalsPath, "utf8")) as {
      version: 1; agy: { subtrees: string[]; exact: string[]; refused: string[] };
    };
    const rogue = join(root, "rogue");
    mkdirSync(rogue, { recursive: true });
    approvals.agy.subtrees.push(rogue);
    writeFileSync(approvalsPath, JSON.stringify(approvals));
    try {
      checkAgyTrustPrecheckSync({ cwd: rogue, env });
      throw new Error("expected audit mismatch");
    } catch (err) {
      expect((err as OnboardingLaunchError).code).toBe("cli-trust-audit-mismatch");
    }
  });

  it("handles init-baseline without deleting absent paths silently, and surfaces ackable out-of-band alerts", async () => {
    const { env, home, startLockPath, ws } = makeSandboxEnv();
    const settingsDir = join(home, ".gemini", "antigravity-cli");
    const settingsFile = join(settingsDir, "settings.json");
    const absentDir = join(home, "deleted-old-project");
    mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      settingsFile,
      JSON.stringify({ trustedWorkspaces: [realpathSync(ws), absentDir, realpathSync(home)] }),
      { mode: 0o600 },
    );

    // Before baseline/approval, out-of-band alert surfaces read-only.
    const oobAlerts = readTrustOwnerAlerts(env);
    expect(oobAlerts.some((a) => a.path === realpathSync(ws) && a.kind === "out-of-band-trust")).toBe(true);
    expect(formatTrustOwnerAlertLines(oobAlerts)[0]).toContain("TRUST ALERT");

    // init-baseline answering "n" keeps absentDir intact.
    expect(await runTrustInitBaselineCommand(ownerDeps(env, startLockPath, ["n"]))).toBe(0);
    const afterKeep = JSON.parse(readFileSync(settingsFile, "utf8")) as { trustedWorkspaces: string[] };
    expect(afterKeep.trustedWorkspaces).toContain(absentDir);

    // Protected $HOME in baseline still cannot launch children via Q2-C.
    const protectedChild = join(home, "random-child");
    mkdirSync(protectedChild, { recursive: true });
    expect(() => checkAgyTrustPrecheckSync({ cwd: protectedChild, env })).toThrowError(OnboardingLaunchError);

    // Re-running init-baseline answering "y" removes absentDir and writes backup.
    expect(await runTrustInitBaselineCommand(ownerDeps(env, startLockPath, ["y"]))).toBe(0);
    const afterRemove = JSON.parse(readFileSync(settingsFile, "utf8")) as { trustedWorkspaces: string[] };
    expect(afterRemove.trustedWorkspaces).not.toContain(absentDir);

    // Manual out-of-band addition creates an ackable alert cleared by `--ack <id>`.
    const extraDir = join(home, "extra-project");
    mkdirSync(extraDir, { recursive: true });
    writeFileSync(
      settingsFile,
      JSON.stringify({ trustedWorkspaces: [...afterRemove.trustedWorkspaces, realpathSync(extraDir)] }),
      { mode: 0o600 },
    );
    const precheckWithOob = checkAgyTrustPrecheckSync({ cwd: realpathSync(extraDir), env });
    expect(precheckWithOob.untrackedTrustApproval).toBe(true);
    const alertId = deterministicOutOfBandAlertId(realpathSync(extraDir));
    expect(readTrustOwnerAlerts(env).some((a) => a.id === alertId)).toBe(true);

    expect(await runTrustAuditCommand({ ack: alertId }, ownerDeps(env, startLockPath, []))).toBe(0);
    expect(readTrustOwnerAlerts(env).some((a) => a.id === alertId)).toBe(false);
  });
});

describe("command classification, guards, and Q4-A modals", () => {
  it("classifies wrapper variants and fails closed on unknown commands", () => {
    expect(classifyCliCommand("agy --model gemini-4-carbon")).toBe("agy");
    expect(classifyCliCommand(["/usr/local/bin/agy"])).toBe("agy");
    expect(classifyCliCommand("env -u ANTHROPIC_BASE_URL FOO=bar antigravity --help")).toBe("agy");
    expect(
      classifyCliCommand([
        process.execPath,
        "/opt/h2a/dist/native-terminal/session-scope.js",
        "--memory-policy=agy",
        "--",
        "agy",
      ]),
    ).toBe("agy");
    expect(
      classifyCliCommand([
        "/bin/bash",
        "-lc",
        'cli="$1"\nexec "$cli" "$@"',
        "h2a run agy .",
        "agy",
        "--model",
        "gemini-4-carbon",
      ]),
    ).toBe("agy");
    expect(
      classifyCliCommand(
        `/usr/bin/node -e 'require("fs")' '/tmp/env.json' 'env -u ANTHROPIC_AUTH_TOKEN agy --model x'`,
      ),
    ).toBe("agy");
    expect(classifyCliCommand("h2a run agy /repo --no-attach")).toBe("agy");
    expect(classifyCliCommand("codex resume conv-1")).toBe("codex");
    expect(classifyCliCommand("claude --resume abc")).toBe("claude");
    expect(classifyCliCommand("/usr/bin/python3 custom_script.py")).toBe("unknown");
  });

  it("blocks keystrokes on undefined capture, Codex/Muse Q4-A hook prompts, wizards, and enforces strict agy readiness", () => {
    expect(guardPaneBeforeAutomatedInput(undefined, "agy", "cli-input")).toMatchObject({
      ok: false,
      outcome: "deferred",
      reason: "capture-unavailable",
    });
    expect(guardPaneBeforeAutomatedInput(undefined, "codex", "shell-relaunch")).toMatchObject({
      ok: false,
      outcome: "deferred",
      reason: "capture-unavailable",
    });

    const codexHooks = "Hooks need review\n1 hook is new or changed.\n1. Review hooks\n2. Trust all and continue\n3. Continue without trusting (hooks won't run)\nPress enter confirm";
    const codexGuard = guardPaneBeforeAutomatedInput(codexHooks, "codex", "cli-input");
    expect(codexGuard).toMatchObject({
      ok: false,
      outcome: "blocked",
      reason: "cli-hooks-review-required",
    });
    expect(codexGuard.ok === false && codexGuard.modal?.hint).toContain("Continue without trusting");
    expect(codexGuard.ok === false && codexGuard.modal?.hint).not.toContain("persiste");

    const museHooks = "Review plugin hooks\n1. Approve\nEnter to confirm";
    expect(guardPaneBeforeAutomatedInput(museHooks, "muse", "cli-input")).toMatchObject({
      ok: false,
      outcome: "blocked",
      reason: "cli-hooks-review-required",
    });

    const wizard = "Welcome to Antigravity CLI\nChoose a color theme\nPress enter to continue";
    expect(guardPaneBeforeAutomatedInput(wizard, "agy", "cli-input")).toMatchObject({
      ok: false,
      outcome: "blocked",
      reason: "cli-first-run-wizard",
    });

    const agyTrustModal = "Do you trust the contents of this directory?\n1. Trust folder\n2. Trust parent folder\nEnter to confirm";
    expect(guardPaneBeforeAutomatedInput(agyTrustModal, "agy", "cli-input")).toMatchObject({
      ok: false,
      outcome: "blocked",
      reason: "cli-workspace-not-trusted",
    });

    const codexFolderAccess = "Folder access\nYou are running Codex in /work.\n1. Yes, continue\nPress enter to continue";
    expect(guardPaneBeforeAutomatedInput(codexFolderAccess, "codex", "cli-input")).toMatchObject({
      ok: false,
      outcome: "blocked",
      reason: "cli-workspace-not-trusted",
    });

    // Strict agy composer readiness + auth-noise invariant.
    const agyUnready = "Antigravity CLI starting...";
    expect(paneIsReady(agyUnready, "agy")).toBe(false);
    expect(guardPaneBeforeAutomatedInput(agyUnready, "agy", "cli-input")).toMatchObject({
      ok: false,
      outcome: "deferred",
      reason: "agy-pane-not-ready",
    });

    const agyReadyWithAuthNoise = [
      "Old log: Authentication required. Please visit https://example.invalid/oauth",
      "esc to dismiss",
      "╭──────────────────────────────────────────╮",
      "│ >                                        │",
      "╰──────────────────────────────────────────╯",
      "  ? for shortcuts",
    ].join("\n");
    expect(paneIsReady(agyReadyWithAuthNoise, "agy")).toBe(true);
    expect(guardPaneBeforeAutomatedInput(agyReadyWithAuthNoise, "agy", "cli-input")).toEqual({ ok: true });
  });
});

describe("serialized agy starts and memory slice guard", () => {
  it("rejects invalid H2A_AGY_START_SPACING_MS and unsafe/missing lock directories", () => {
    const { runUser, startLockPath } = makeSandboxEnv();
    expect(() =>
      withAgyStartQueueSync(() => ({ result: "ok" }), {
        lockPath: startLockPath,
        env: { H2A_AGY_START_SPACING_MS: "12999" },
      }),
    ).toThrowError(/cli-start-lock-invalid-config|invalid H2A_AGY_START_SPACING_MS/i);

    try {
      withAgyStartQueueSync(() => ({ result: "ok" }), {
        lockPath: join(runUser, "missing-subdir", "agy-start.lock"),
        spacingMs: MIN_AGY_START_SPACING_MS,
      });
      throw new Error("expected missing dir error");
    } catch (err) {
      expect((err as OnboardingLaunchError).code).toBe("cli-start-lock-unavailable");
    }

    chmodSync(runUser, 0o755);
    try {
      withAgyStartQueueSync(() => ({ result: "ok" }), {
        lockPath: startLockPath,
        spacingMs: MIN_AGY_START_SPACING_MS,
      });
      throw new Error("expected unsafe parent mode error");
    } catch (err) {
      expect((err as OnboardingLaunchError).code).toBe("cli-start-lock-unavailable");
    }
  });

  it("tightens 0664 lock files from legacy scripts to 0600, serializes 3 concurrent starters, and enforces spacing + wait notice", async () => {
    const { startLockPath } = makeSandboxEnv();
    writeFileSync(startLockPath, "", { mode: 0o664 });
    chmodSync(startLockPath, 0o664);

    const events: string[] = [];
    const waitMessages: string[] = [];
    const startTimes: number[] = [];

    // Also prove pre-spawn throw does not stamp spacing delay.
    await expect(
      withAgyStartQueueAsync(
        async () => {
          throw new Error("pre-spawn fail");
        },
        { lockPath: startLockPath, spacingMs: 5_000, postSpawnMaxHoldMs: 50 },
      ),
    ).rejects.toThrow("pre-spawn fail");
    expect(statSync(startLockPath).mode & 0o777).toBe(0o600);

    const results = await Promise.all([1, 2, 3].map((id) =>
      withAgyStartQueueAsync(
        async () => {
          events.push(`start-${id}`);
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 15));
          events.push(`end-${id}`);
          return { result: id, workerPid: process.pid };
        },
        {
          lockPath: startLockPath,
          spacingMs: 60,
          timeoutMs: 5_000,
          postSpawnMaxHoldMs: 30,
          onWait: (m) => waitMessages.push(m),
          checkWorkerAgy: () => true,
        },
      ),
    ));

    expect(results).toEqual([1, 2, 3]);
    expect(events).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
    expect(waitMessages.length).toBeGreaterThan(0);
    expect(startTimes[1]! - startTimes[0]!).toBeGreaterThanOrEqual(50);
    expect(startTimes[2]! - startTimes[1]!).toBeGreaterThanOrEqual(50);
  });

  it("computes agy memory policy and validates h2a-agents.slice bounds fail-closed", () => {
    const ram64 = 64 * 1024 ** 3;
    expect(computeAgyMemoryLimits(ram64)).toEqual({
      memoryMaxBytes: 16 * 1024 ** 3,
      memoryHighBytes: 12 * 1024 ** 3,
      memorySwapMaxBytes: 0,
    });
    expect(resolveMemoryScopeSpec({ memoryPolicy: "agy", sessionClass: "human", totalMemBytes: ram64 })).toMatchObject({
      slice: "app.slice",
      oomPreference: "avoid",
      defaultMaxBytes: 16 * 1024 ** 3,
    });
    expect(resolveMemoryScopeSpec({ memoryPolicy: "agy", sessionClass: "background", totalMemBytes: ram64 })).toMatchObject({
      slice: "h2a-agents.slice",
      oomPreference: "none",
      defaultMaxBytes: 16 * 1024 ** 3,
    });

    const missing = inspectAgyAgentsSliceSync({
      totalMemBytes: ram64,
      runSystemctlShow: () => ({ status: 0, stdout: "FragmentPath=\nMemoryMax=infinity\nActiveState=inactive\n", stderr: "" }),
      readCgroupFile: () => { throw new Error("ENOENT"); },
    });
    expect(missing).toMatchObject({ ok: false, code: "cli-memory-slice-missing" });

    const infinitySlice = inspectAgyAgentsSliceSync({
      totalMemBytes: ram64,
      runSystemctlShow: () => ({
        status: 0,
        stdout: "FragmentPath=/home/u/.config/systemd/user/h2a-agents.slice\nMemoryMax=infinity\nNeedDaemonReload=no\nActiveState=inactive\n",
        stderr: "",
      }),
      readCgroupFile: () => { throw new Error("ENOENT"); },
    });
    expect(infinitySlice).toMatchObject({ ok: false, code: "cli-memory-slice-unbounded" });

    const tooSmall = inspectAgyAgentsSliceSync({
      totalMemBytes: ram64,
      runSystemctlShow: () => ({
        status: 0,
        stdout: `FragmentPath=/x.slice\nMemoryMax=${16 * 1024 ** 3}\nNeedDaemonReload=no\nActiveState=inactive\n`,
        stderr: "",
      }),
      readCgroupFile: () => { throw new Error("ENOENT"); },
    });
    expect(tooSmall).toMatchObject({ ok: false, code: "cli-memory-slice-insufficient" });

    const needReload = inspectAgyAgentsSliceSync({
      totalMemBytes: ram64,
      runSystemctlShow: () => ({
        status: 0,
        stdout: `FragmentPath=/x.slice\nMemoryMax=${37 * 1024 ** 3}\nNeedDaemonReload=yes\nActiveState=inactive\n`,
        stderr: "",
      }),
      readCgroupFile: () => { throw new Error("ENOENT"); },
    });
    expect(needReload).toMatchObject({ ok: false, code: "cli-memory-slice-insufficient" });

    // Active cgroupfs memory.max overrides systemctl show.
    const cgroupValid = inspectAgyAgentsSliceSync({
      totalMemBytes: ram64,
      runSystemctlShow: () => ({
        status: 0,
        stdout: `FragmentPath=/x.slice\nMemoryMax=${10 * 1024 ** 3}\nNeedDaemonReload=no\nActiveState=active\n`,
        stderr: "",
      }),
      readCgroupFile: () => String(37 * 1024 ** 3),
    });
    expect(cgroupValid).toMatchObject({ ok: true, memoryMaxBytes: 37 * 1024 ** 3, source: "cgroupfs" });

    const cgroupUnbounded = inspectAgyAgentsSliceSync({
      totalMemBytes: ram64,
      runSystemctlShow: () => ({
        status: 0,
        stdout: `FragmentPath=/x.slice\nMemoryMax=${37 * 1024 ** 3}\nNeedDaemonReload=no\nActiveState=active\n`,
        stderr: "",
      }),
      readCgroupFile: () => "max\n",
    });
    expect(cgroupUnbounded).toMatchObject({ ok: false, code: "cli-memory-slice-unbounded" });

    const unreadable = inspectAgyAgentsSliceSync({
      totalMemBytes: ram64,
      runSystemctlShow: () => ({ status: 1, stdout: "", stderr: "Failed to connect to bus" }),
      readCgroupFile: () => { throw new Error("ENOENT"); },
    });
    expect(unreadable).toMatchObject({ ok: false, code: "cli-memory-slice-unreadable" });
  });
});
