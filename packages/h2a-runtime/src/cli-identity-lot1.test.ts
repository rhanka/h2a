import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  consumeOwnerGrantForAct,
  issueOwnerGrant,
  listOwnerGrants,
  ownerGrantsDir,
  purgeStaleOwnerGrants,
  revokeOwnerGrant,
  sanitizeOwnerGrantReason,
} from "./owner-grants.js";
import {
  mintSessionKeyAndSecret,
  readBootId,
  readMachineId,
  readPidNamespaceId,
  readProcStat,
  SESSION_IDENTITY_SCRUB_KEYS,
  scrubSessionIdentityEnv,
  verifySessionSecretFile,
  writeSessionFiche,
} from "./session-auth.js";
import {
  assertOwnerTerminalAccess,
  isInsideH2aSessionEnv,
} from "./trust-cli.js";
import {
  runAuthorizeIssueCommand,
  runAuthorizeListCommand,
  runAuthorizeRevokeCommand,
} from "./authorize-cli.js";
import {
  LOCAL_WRAPPER,
  tmuxPaneEnvPrefix,
} from "./tmux.js";
import { buildSessionExecWrapperCommandLine } from "./session-exec-wrapper.js";
import {
  checkCallerOwnsTargetSession,
} from "./launch-identity.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "h2a-cli-identity-lot1-"));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("CLI identity lot 1.1+1.2 runtime primitives", () => {
  it("Annex C: scrubSessionIdentityEnv strips all 51 closed keys while keeping owner/session context vars", () => {
    expect(SESSION_IDENTITY_SCRUB_KEYS.length).toBe(51);
    const polluted: Record<string, string> = {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/h",
      H2A_SESSION_HOST: "native",
      H2A_REMOTE_CONTROL: "1",
      REMOTE_DELEGATE_DEPTH: "2",
      TMPDIR: "/tmp/custom-tmp",
      TMP: "/tmp/custom-tmp",
      TEMP: "/tmp/custom-tmp",
      CLAUDE_CODE_SUPPRESS_SESSION_ATTRIBUTION: "1",
      H2A_MCP_AUTHORITY: "central",
    };
    for (const k of SESSION_IDENTITY_SCRUB_KEYS) {
      polluted[k] = `leaked-${k}`;
    }
    const clean = scrubSessionIdentityEnv(polluted);
    for (const k of SESSION_IDENTITY_SCRUB_KEYS) {
      expect(clean[k]).toBeUndefined();
    }
    expect(clean.H2A_SESSION_HOST).toBe("native");
    expect(clean.H2A_REMOTE_CONTROL).toBe("1");
    expect(clean.REMOTE_DELEGATE_DEPTH).toBe("2");
    expect(clean.TMPDIR).toBe("/tmp/custom-tmp");
    expect(clean.TMP).toBe("/tmp/custom-tmp");
    expect(clean.TEMP).toBe("/tmp/custom-tmp");
    expect(clean.CLAUDE_CODE_SUPPRESS_SESSION_ATTRIBUTION).toBe("1");
    expect(clean.H2A_MCP_AUTHORITY).toBe("central");

    // B-1: exclude preserves explicit REMOTE_JOB_ID across scrub while still stripping inherited leaked keys.
    const jobClean = scrubSessionIdentityEnv(polluted, { exclude: new Set(["REMOTE_JOB_ID"]) });
    expect(jobClean.REMOTE_JOB_ID).toBe("leaked-REMOTE_JOB_ID");
    expect(jobClean.H2A_INSTANCE).toBeUndefined();
  });

  it("B-2: tmuxPaneEnvPrefix preserves excluded -e keys and wrapper unsets session refs", () => {
    const prefix = tmuxPaneEnvPrefix({
      excludeUnset: new Set(["H2A_MCP_READY_FILE", "H2A_MCP_READY_NONCE"]),
      setVars: { H2A_SESSION_CLASS: "background", REMOTE_JOB_ID: "job-1" },
    });
    const joined = prefix.join(" ");
    expect(joined).toContain("-u H2A_SESSION_REF");
    expect(joined).not.toContain("-u H2A_MCP_READY_FILE");
    expect(joined).not.toContain("-u H2A_MCP_READY_NONCE");
    expect(prefix).toContain("H2A_SESSION_CLASS=background");
    expect(prefix).toContain("REMOTE_JOB_ID=job-1");
    expect(LOCAL_WRAPPER).toContain("unset H2A_SESSION_REF H2A_SESSION_PROOF_PATH");
  });

  it("NB-4: trust-cli recognizes REMOTE_JOB_ID, H2A_SESSION_REF, and H2A_SESSION_PROOF_PATH as inside-session", () => {
    for (const key of ["REMOTE_JOB_ID", "H2A_SESSION_REF", "H2A_SESSION_PROOF_PATH"]) {
      expect(isInsideH2aSessionEnv({ [key]: "val" })).toBe(true);
    }
    expect(isInsideH2aSessionEnv({ H2A_SESSION_HOST: "native" })).toBe(false);
    expect(() =>
      assertOwnerTerminalAccess({
        stdinIsTTY: false,
        stdoutIsTTY: true,
        env: {},
      }, "authorize"),
    ).toThrow(/interactive owner TTY required/);
    expect(() =>
      assertOwnerTerminalAccess({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        env: { REMOTE_JOB_ID: "job-99" },
      }, "authorize"),
    ).toThrow(/forbidden inside any h2a session/);
  });

  it("verifySessionSecretFile enforces 0600 mode, O_NOFOLLOW, size <= 128B, and constant-time sha256", () => {
    const dir = mkdtempSync(join(SCRATCH, "secret-"));
    const goodPath = join(dir, "good.secret");
    const secret = Buffer.from("0123456789abcdef0123456789abcdef");
    writeFileSync(goodPath, secret, { mode: 0o600 });
    const shaHex = createHash("sha256").update(secret).digest("hex");
    expect(verifySessionSecretFile(goodPath, shaHex)).toBe(true);
    expect(verifySessionSecretFile(goodPath, "0".repeat(64))).toBe(false);
    chmodSync(goodPath, 0o644);
    expect(verifySessionSecretFile(goodPath, shaHex)).toBe(false);
    const linkPath = join(dir, "link.secret");
    symlinkSync(goodPath, linkPath);
    expect(verifySessionSecretFile(linkPath, shaHex)).toBe(false);
    const bigPath = join(dir, "big.secret");
    writeFileSync(bigPath, Buffer.alloc(200, 0x41), { mode: 0o600 });
    expect(verifySessionSecretFile(bigPath, shaHex)).toBe(false);
  });

  it("owner-grants: single-use consume, clock/uptime NB-5 bounds, NB-7 purge & bounded reason, NB-8 warning", () => {
    const rt = mkdtempSync(join(SCRATCH, "grants-rt-"));
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const nowMs = 1_700_000_000_000;
    const bootId = "boot-uuid-1";
    const machineId = readMachineId();

    expect(sanitizeOwnerGrantReason("  hello\x1b[31m\nworld  ")).toEqual({
      ok: true,
      reason: "hello [31m world",
    });
    expect(sanitizeOwnerGrantReason("x".repeat(400)).ok).toBe(false);

    const issued = issueOwnerGrant(rt, {
      act: "central-compact",
      actorId: "codex:work:123456789abc",
      ttlMs: 60_000,
      reason: "compact test",
      now: nowMs,
      bootId,
      machineId,
      uptimeSec: 100,
      issuerPid: process.pid,
      issuerTty: "pts/0",
      expectedUid: uid,
    });
    expect(issued.act).toBe("central-compact");
    expect(listOwnerGrants(rt, { expectedUid: uid, now: nowMs, bootId, machineId, uptimeSec: 100 }).length).toBe(1);

    // Wrong act fails without consuming.
    expect(
      consumeOwnerGrantForAct(rt, {
        act: "central-stop",
        actorId: "codex:work:123456789abc",
        now: nowMs + 1000,
        bootId,
        machineId,
        uptimeSec: 101,
        expectedUid: uid,
      }).ok,
    ).toBe(false);

    // NB-5: future clock or rebooted uptime rejected before consume.
    expect(
      consumeOwnerGrantForAct(rt, {
        act: "central-compact",
        actorId: "codex:work:123456789abc",
        now: nowMs - 10_000,
        bootId,
        machineId,
        uptimeSec: 101,
        expectedUid: uid,
      }).ok,
    ).toBe(false);
    expect(
      consumeOwnerGrantForAct(rt, {
        act: "central-compact",
        actorId: "codex:work:123456789abc",
        now: nowMs + 1000,
        bootId,
        machineId,
        uptimeSec: 10,
        expectedUid: uid,
      }).ok,
    ).toBe(false);

    // Valid consume succeeds once, second consume fails (one-shot).
    const first = consumeOwnerGrantForAct(rt, {
      act: "central-compact",
      actorId: "codex:work:123456789abc",
      now: nowMs + 2000,
      bootId,
      machineId,
      uptimeSec: 102,
      expectedUid: uid,
    });
    expect(first.ok).toBe(true);
    const second = consumeOwnerGrantForAct(rt, {
      act: "central-compact",
      actorId: "codex:work:123456789abc",
      now: nowMs + 2500,
      bootId,
      machineId,
      uptimeSec: 102,
      expectedUid: uid,
    });
    expect(second.ok).toBe(false);

    // NB-7: purge stale expired grants and leftover .tmp/.claiming files.
    const gDir = ownerGrantsDir(rt);
    writeFileSync(join(gDir, "grant.json.tmp"), "{}", { mode: 0o600 });
    writeFileSync(join(gDir, "grant.json.claiming.999"), "{}", { mode: 0o600 });
    const staleSec = (nowMs - 120_000) / 1000;
    utimesSync(join(gDir, "grant.json.tmp"), staleSec, staleSec);
    utimesSync(join(gDir, "grant.json.claiming.999"), staleSec, staleSec);
    const expired = issueOwnerGrant(rt, {
      act: "central-stop",
      actorId: "claude:work:abcdef123456",
      ttlMs: 10_000,
      now: nowMs - 120_000,
      bootId,
      machineId,
      uptimeSec: 10,
      issuerPid: process.pid,
      issuerTty: "pts/0",
      expectedUid: uid,
    });
    const purged = purgeStaleOwnerGrants(rt, {
      now: nowMs,
      bootId,
      machineId,
      uptimeSec: 100,
      expectedUid: uid,
    });
    expect(purged.some((n) => n.includes(expired.grantId))).toBe(true);
    expect(existsSync(join(gDir, "grant.json.tmp"))).toBe(false);
    expect(existsSync(join(gDir, "grant.json.claiming.999"))).toBe(false);

    // CLI authorize issue / list / revoke (NB-8 warning when actor unregistered + TTY owner checks).
    const busRoot = mkdtempSync(join(SCRATCH, "bus-"));
    mkdirSync(join(busRoot, "registry"), { recursive: true });
    writeFileSync(join(busRoot, "registry", "instances.jsonl"), "");
    const cliOut: string[] = [];
    const cliErr: string[] = [];
    const cliDeps = {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      env: { ...process.env, HOME: SCRATCH, XDG_STATE_HOME: join(SCRATCH, "state"), H2A_ROOT: busRoot },
      sessionRuntimeDir: rt,
      promptLine: async () => "central-stop",
      stdout: (s: string) => { cliOut.push(s); },
      stderr: (s: string) => { cliErr.push(s); },
    };
    return runAuthorizeIssueCommand(
      "central-stop",
      { for: "codex:unreg:123456789abc", ttl: "5m", reason: "audit test", json: true },
      cliDeps,
    ).then(async (rc) => {
      expect(rc).toBe(0);
      expect(cliErr.join("")).toContain("no active session fiche currently matches");
      expect(cliErr.join("")).toContain("process argv");
      const parsedIssue = JSON.parse(cliOut.at(-1) ?? "");
      expect(parsedIssue.grant.grantId).toMatch(/^[0-9a-f-]{36}$/i);
      cliOut.length = 0;
      const listRc = await runAuthorizeListCommand({ json: true }, cliDeps);
      expect(listRc).toBe(0);
      expect(JSON.parse(cliOut.join("")).grants.length).toBe(1);
      cliOut.length = 0;
      const revRc = await runAuthorizeRevokeCommand(parsedIssue.grant.grantId, { json: true }, cliDeps);
      expect(revRc).toBe(0);
      expect(revokeOwnerGrant(rt, parsedIssue.grant.grantId).ok).toBe(false);
    });
  });

  it("Q2-1 checkCallerOwnsTargetSession permits own delegator and refuses foreign/human with alert", () => {
    const rt = mkdtempSync(join(SCRATCH, "q2-rt-"));
    const stateDir = mkdtempSync(join(SCRATCH, "q2-state-"));
    chmodSync(rt, 0o700);
    const procStat = readProcStat(process.pid);
    expect(procStat).toBeDefined();
    const { sessionKey, secretSha256 } = mintSessionKeyAndSecret(rt);
    writeSessionFiche(rt, {
      version: 1,
      sessionKey,
      actorId: "codex:lead:111111111111",
      agentUuid: "11111111-1111-4111-8111-111111111111",
      host: "codex",
      invocationMode: "headless",
      createdBy: "launcher",
      hostSessionId: null,
      cliPid: null,
      cliStartTime: null,
      sessionClass: "human",
      delegatorInstance: null,
      delegatorSessionKey: null,
      secretSha256,
      leaderPid: process.pid,
      leaderStartTime: procStat!.startTime,
      bootId: readBootId() ?? "nonlinux-boot",
      pidNamespace: readPidNamespaceId("self") ?? "nonlinux-pidns",
      machineId: readMachineId(),
      scopeUnit: null,
      issuedAt: new Date().toISOString(),
    });
    const q2Env: Record<string, string | undefined> = {
      XDG_STATE_HOME: stateDir,
      HOME: SCRATCH,
    };
    for (const key of [
      "H2A_TEST_STATE_ROOT",
      "H2A_TEST_STATE_RECEIPT",
      "H2A_TEST_STATE_ATTESTATION",
      "H2A_TEST_STATE_BARRIER",
      "H2A_TEST_SANDBOX_NONCE",
      "H2A_TEST_OWNER_HOME",
      "H2A_TEST_QUALIFICATION_ROOT",
      "H2A_HOST_QUALIFICATION_RESERVATION",
    ]) {
      if (process.env[key] !== undefined) q2Env[key] = process.env[key];
    }
    const owned = checkCallerOwnsTargetSession({
      commandVerb: "stop",
      targetLabel: "worker-1",
      targetDelegatorInstance: "codex:lead:111111111111",
      sessionRuntimeDir: rt,
      env: q2Env,
    });
    expect(owned.ok).toBe(true);

    const foreign = checkCallerOwnsTargetSession({
      commandVerb: "stop",
      targetLabel: "human-sess",
      targetDelegatorInstance: undefined,
      sessionRuntimeDir: rt,
      env: q2Env,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.message).toContain("session-not-owned-by-caller");
    }
    const wrapper = buildSessionExecWrapperCommandLine({
      sessionKey: "sess_wrap",
      relaunchHint: "h2a run claude",
      command: "claude",
      commandArgs: [],
      noShell: true,
    });
    expect(wrapper.some((t) => t.includes("sess_wrap"))).toBe(true);
    expect(lstatSync(rt).isDirectory()).toBe(true);
  });
});
