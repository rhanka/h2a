import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, chmodSync, statSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGY_QUALIFIED_VERSION,
  canonicalizeWorkspacePath,
  checkAgyTrustPrecheckSync,
  classifyCliCommand,
  collectTrustAlertsReadOnly,
  computeAgyMemoryLimits,
  detectHostModal,
  deterministicMismatchAlertId,
  deterministicOutOfBandAlertId,
  guardPaneBeforeAutomatedInput,
  h2aTrustApprovalsPath,
  h2aTrustAuditPath,
  inspectAgyAgentsSliceSync,
  isUnsupportedTrustRoot,
  MCP_AGY_LAUNCH_BUDGET_MS,
  MIN_AGY_START_SPACING_MS,
  OnboardingLaunchError,
  paneIsReady,
  resolveAgyQueueTimeoutMs,
  resolveMemoryScopeSpec,
  verifyNativeHostScopeFromProc,
  withAgyStartQueueAsync,
  withAgyStartQueueSync,
} from "./onboarding-core.js";
import { renderTerminalScreen } from "./native-terminal/screen.js";
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

  it("handles init-baseline with confirmation, keeps baseline separate from trust-approvals, blocks unconfirmed replay, and acks mismatch/oob alerts", async () => {
    const { env, home, startLockPath, ws } = makeSandboxEnv();
    const settingsDir = join(home, ".gemini", "antigravity-cli");
    const settingsFile = join(settingsDir, "settings.json");
    const approvalsFile = h2aTrustApprovalsPath(env);
    const auditFile = h2aTrustAuditPath(env);
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

    // Declining baseline import confirmation aborts cleanly without mutating files.
    expect(await runTrustInitBaselineCommand(ownerDeps(env, startLockPath, ["n", "n"]))).toBe(1);
    expect(existsSync(auditFile)).toBe(false);

    // Initial confirmed init-baseline (keep absentDir: "n", confirm import: "y")
    // records baseline-import in audit log without writing trust-approvals.json.
    expect(await runTrustInitBaselineCommand(ownerDeps(env, startLockPath, ["n", "y"]))).toBe(0);
    const afterKeep = JSON.parse(readFileSync(settingsFile, "utf8")) as { trustedWorkspaces: string[] };
    expect(afterKeep.trustedWorkspaces).toContain(absentDir);
    expect(existsSync(approvalsFile)).toBe(false);

    // Retained baseline entries (including kept absentDir & $HOME) do not emit permanent OOB alerts.
    expect(readTrustOwnerAlerts(env)).toHaveLength(0);

    // Protected $HOME & ancestors (/home) are unsupported roots and cannot launch via Q2-C.
    expect(isUnsupportedTrustRoot(dirname(realpathSync(home)), env)).toBe(true);
    const protectedChild = join(home, "random-child");
    mkdirSync(protectedChild, { recursive: true });
    expect(() => checkAgyTrustPrecheckSync({ cwd: protectedChild, env })).toThrowError(OnboardingLaunchError);

    // Re-running init-baseline without replay confirmation is refused.
    expect(await runTrustInitBaselineCommand(ownerDeps(env, startLockPath, ["n"]))).toBe(1);

    // Forged subtree or exact entry in trust-approvals.json relying on baseline-import
    // fails closed with cli-trust-audit-mismatch whose hint NEVER suggests init-baseline.
    mkdirSync(dirname(approvalsFile), { recursive: true, mode: 0o700 });
    writeFileSync(
      approvalsFile,
      JSON.stringify({ agy: { subtrees: [realpathSync(ws)], exact: [], refused: [] } }),
      { mode: 0o600 },
    );
    let mismatchErr: OnboardingLaunchError | undefined;
    try {
      checkAgyTrustPrecheckSync({ cwd: join(ws, "nested"), env });
    } catch (err) {
      mismatchErr = err as OnboardingLaunchError;
    }
    expect(mismatchErr?.code).toBe("cli-trust-audit-mismatch");
    expect(mismatchErr?.hint).not.toContain("init-baseline");
    const mismatchAlertId = deterministicMismatchAlertId(realpathSync(ws));
    expect(readTrustOwnerAlerts(env).some((a) => a.id === mismatchAlertId)).toBe(true);
    expect(await runTrustAuditCommand({ ack: mismatchAlertId }, ownerDeps(env, startLockPath, []))).toBe(0);
    expect(readTrustOwnerAlerts(env).some((a) => a.id === mismatchAlertId)).toBe(false);

    // Clean approvals file so manual OOB test can proceed.
    writeFileSync(
      approvalsFile,
      JSON.stringify({ agy: { subtrees: [], exact: [], refused: [] } }),
      { mode: 0o600 },
    );

    // Manual out-of-band addition creates an ackable alert that replay CANNOT erase.
    const extraDir = join(home, "extra-project");
    mkdirSync(extraDir, { recursive: true });
    writeFileSync(
      settingsFile,
      JSON.stringify({ trustedWorkspaces: [...afterKeep.trustedWorkspaces, realpathSync(extraDir)] }),
      { mode: 0o600 },
    );
    // Confirmed replay cleans absentDir ("y", "y"), but STILL preserves the OOB alert on extraDir.
    expect(await runTrustInitBaselineCommand(ownerDeps(env, startLockPath, ["y", "y"]))).toBe(0);
    const afterRemove = JSON.parse(readFileSync(settingsFile, "utf8")) as { trustedWorkspaces: string[] };
    expect(afterRemove.trustedWorkspaces).not.toContain(absentDir);

    const precheckWithOob = checkAgyTrustPrecheckSync({ cwd: realpathSync(extraDir), env });
    expect(precheckWithOob.untrackedTrustApproval).toBe(true);
    const alertId = deterministicOutOfBandAlertId(realpathSync(extraDir));
    expect(readTrustOwnerAlerts(env).some((a) => a.id === alertId)).toBe(true);

    expect(await runTrustAuditCommand({ ack: alertId }, ownerDeps(env, startLockPath, []))).toBe(0);
    expect(readTrustOwnerAlerts(env).some((a) => a.id === alertId)).toBe(false);

    // Refused directory also blocks descendant subdirectories even under approved subtree.
    const subRoot = join(home, "src", "subtree-parent");
    const refChild = join(subRoot, "secret");
    const refGrandChild = join(refChild, "deep");
    mkdirSync(refGrandChild, { recursive: true });
    expect(await runTrustAgyCommand(subRoot, {}, ownerDeps(env, startLockPath, [basename(subRoot)]))).toBe(0);
    expect(await runTrustAgyCommand(refChild, { refuse: true }, ownerDeps(env, startLockPath, [basename(refChild)]))).toBe(0);
    expect(() => checkAgyTrustPrecheckSync({ cwd: refGrandChild, env })).toThrowError(/marked as refused/i);
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

  it("blocks keystrokes on undefined capture, Codex/Muse Q4-A hook prompts, wizards, and enforces strict agy readiness", async () => {
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
    expect(codexGuard.ok === false && codexGuard.modal?.hint).toContain("persistence not verified");

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
    // Also prove real agy 1.5.17, codex, and claude captures under fixtures/.
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const fixturesBase = join(repoRoot, "packages", "h2a", "test", "fixtures", "cli-onboarding");
    const agyOutDir = join(fixturesBase, "agy-outputs");
    const blockedAgyFixtures = new Set([
      "B-child.txt",
      "B2-grandchild.txt",
      "C-home-child.txt",
      "E1-symlink-logical-pwd.txt",
      "F-symlink-entry.txt",
      "G1-git-sub.txt",
      "G2-git-worktree.txt",
      "H2a-settings-array-merge.txt",
    ]);
    for (const file of readdirSync(agyOutDir).filter((f) => f.endsWith(".txt") && f !== "meta.txt")) {
      const capture = readFileSync(join(agyOutDir, file), "utf8");
      if (file === "00-no-dbus.txt") {
        expect(detectHostModal(capture, "agy")?.code).toBe("agy-auth-required");
        expect(detectHostModal(capture, undefined)?.code).toBe("agy-auth-required");
        expect(detectHostModal(capture, "claude")).toBeUndefined();
      } else if (blockedAgyFixtures.has(file)) {
        for (const prof of ["agy", undefined] as const) {
          expect(detectHostModal(capture, prof)?.code).toBe("cli-workspace-not-trusted");
          expect(paneIsReady(capture, prof)).toBe(false);
          expect(guardPaneBeforeAutomatedInput(capture, prof, "cli-input")).toMatchObject({ ok: false, outcome: "blocked" });
          expect(guardPaneBeforeAutomatedInput(capture, prof, "shell-relaunch")).toMatchObject({ ok: false, outcome: "blocked" });
        }
      } else if (!file.startsWith("I1-") && !file.startsWith("I2-")) {
        expect(detectHostModal(capture, "agy")).toBeUndefined();
        expect(paneIsReady(capture, "agy")).toBe(true);
        expect(guardPaneBeforeAutomatedInput(capture, "agy", "cli-input")).toEqual({ ok: true });
      }
    }
    const bChildRendered = await renderTerminalScreen(readFileSync(join(agyOutDir, "B-child.raw"), "utf8"));
    for (const prof of ["agy", undefined] as const) {
      expect(detectHostModal(bChildRendered, prof)?.code).toBe("cli-workspace-not-trusted");
      expect(paneIsReady(bChildRendered, prof)).toBe(false);
      expect(guardPaneBeforeAutomatedInput(bChildRendered, prof, "shell-relaunch")).toMatchObject({ ok: false, outcome: "blocked" });
    }

    // Normal claude and codex screens (including quoted modal phrases) must never be falsely blocked.
    const claudeWithQuotedNoise = [
      "Welcome to Claude Code",
      "Discussing docs: Hooks need review, Trust and continue, Do you trust the contents of this project?",
      "1. First point in markdown",
      "2. Second point in markdown",
      "────────────────────────────────────────",
      "❯ ",
      "────────────────────────────────────────",
      "  ⏵⏵ auto mode on (shift+tab to cycle)",
    ].join("\n");
    expect(detectHostModal(claudeWithQuotedNoise, "claude")).toBeUndefined();
    expect(paneIsReady(claudeWithQuotedNoise, "claude")).toBe(true);
    expect(guardPaneBeforeAutomatedInput(claudeWithQuotedNoise, "claude", "cli-input")).toEqual({ ok: true });

    const claudeHooksProseOnly = "Hooks need review\n1. Read the docs\n2. Check settings\n❯ ";
    expect(detectHostModal(claudeHooksProseOnly, "claude")).toBeUndefined();
    expect(paneIsReady(claudeHooksProseOnly, "claude")).toBe(true);
    expect(guardPaneBeforeAutomatedInput(claudeHooksProseOnly, "claude", "cli-input")).toEqual({ ok: true });

    const codexTrustProseNoDot = "Trust and continue mentioned in explanation\n› ";
    expect(detectHostModal(codexTrustProseNoDot, "codex")).toBeUndefined();
    expect(guardPaneBeforeAutomatedInput(codexTrustProseNoDot, "codex", "cli-input")).toEqual({ ok: true });

    const pty18Dir = join(fixturesBase, "pty18-outputs");
    for (const file of readdirSync(pty18Dir).filter((f) => f.endsWith(".out.raw"))) {
      const profile = file.includes("claude") ? "claude" : "codex";
      const screen = await renderTerminalScreen(readFileSync(join(pty18Dir, file), "utf8"));
      expect(detectHostModal(screen, profile)).toBeUndefined();
      expect(paneIsReady(screen, profile)).toBe(true);
      expect(guardPaneBeforeAutomatedInput(screen, profile, "cli-input")).toEqual({ ok: true });
    }
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

    // Also prove pre-spawn throw still enforces clean 0600 hardening on unlock.
    await expect(
      withAgyStartQueueAsync(
        async () => {
          throw new Error("pre-spawn fail");
        },
        { lockPath: startLockPath, spacingMs: 30, postSpawnMaxHoldMs: 50 },
      ),
    ).rejects.toThrow("pre-spawn fail");
    expect(statSync(startLockPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(startLockPath, "utf8")).toBe("");

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
    expect(readFileSync(startLockPath, "utf8")).toBe("");
  });

  it("B-3 counterexample: 3 starters (h2a A -> external script 9> truncate -> h2a B) stay spaced with real flock", async () => {
    const { startLockPath } = makeSandboxEnv();
    writeFileSync(startLockPath, "stale", { mode: 0o664 });
    chmodSync(startLockPath, 0o664);

    // 1. h2a A starts.
    let spawnAMs = 0;
    await withAgyStartQueueAsync(
      async () => {
        spawnAMs = Date.now();
        return { result: "A", workerPid: process.pid };
      },
      { lockPath: startLockPath, spacingMs: 180, postSpawnMaxHoldMs: 20, checkWorkerAgy: () => true },
    );

    // 2. External script truncates agy-start.lock with `9>` under real flock and waits 200ms (like run-lane-agy.sh).
    let scriptDoneMs = 0;
    const bashRes = spawnSync(
      "/bin/bash",
      ["-c", `( flock 9; sleep 0.2 ) 9>"$LOCK"; date +%s%3N`],
      { env: { LOCK: startLockPath }, encoding: "utf8" },
    );
    expect(bashRes.status).toBe(0);
    scriptDoneMs = Number(bashRes.stdout.trim());
    expect(scriptDoneMs - spawnAMs).toBeGreaterThanOrEqual(150);

    // 3. h2a B arrives right after S even though .stamp from A is now >= 200ms old and lock was truncated to 0 bytes.
    let spawnBMs = 0;
    await withAgyStartQueueAsync(
      async () => {
        spawnBMs = Date.now();
        return { result: "B", workerPid: process.pid };
      },
      { lockPath: startLockPath, spacingMs: 180, postSpawnMaxHoldMs: 20, checkWorkerAgy: () => true },
    );
    expect(spawnBMs - scriptDoneMs).toBeGreaterThanOrEqual(160);
    expect(resolveAgyQueueTimeoutMs(240_000, {})).toBe(72_000);
    expect(resolveAgyQueueTimeoutMs(200_000, {})).toBe(32_000);
    expect(resolveAgyQueueTimeoutMs(30_000, {})).toBe(15_000);
    expect(resolveAgyQueueTimeoutMs(240_000, { H2A_AGY_LOCK_TIMEOUT_MS: "45000" })).toBe(45_000);

    // NB-11: verifyNativeHostScopeFromProc fails closed on missing /proc entry or mismatched hostPid.
    const fakeProc = mkdtempSync(join(tmpdir(), "h2a-proc-"));
    tempDirs.push(fakeProc);
    expect(verifyNativeHostScopeFromProc(4242, true, fakeProc)).toBe(false);
    mkdirSync(join(fakeProc, "4242"), { recursive: true });
    writeFileSync(join(fakeProc, "4242", "cgroup"), "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-native-9999-abc.scope\n");
    expect(verifyNativeHostScopeFromProc(4242, true, fakeProc)).toBe(false);
    writeFileSync(join(fakeProc, "4242", "cgroup"), "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-native-4242-abc.scope\n");
    expect(verifyNativeHostScopeFromProc(4242, true, fakeProc)).toBe(true);
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
