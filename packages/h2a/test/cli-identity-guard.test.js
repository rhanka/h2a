/**
 * Integration & security qualification suite for verified CLI caller identity,
 * owner mode, one-shot owner authorizations, Track M3 CLI signatures, MCP session
 * anchors, PID-namespace isolation, and Codex --no-daemon guarantees (Lot 1.1+1.2).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { EventStore, Track } from "@sentropic/track";

import {
  canonicalize,
  createLocalStore,
  listPresence,
  reapAllDeadPresence,
  reapDeadInstancePresence,
  writePresence,
} from "../dist/index.js";
import { cmdPresenceReap, runCli, runMcpServe } from "../dist/cli.js";
import {
  applyCodexNoDaemon,
  consumeDaemonLaunchReceipt,
  consumeOwnerGrantForAct,
  getGlobalVerifiedCallerContext,
  identityKeyPaths,
  issueDaemonLaunchReceipt,
  issueOwnerGrant,
  mintSessionKeyAndSecret,
  purgeStaleOwnerGrants,
  readMachineId,
  readValidHostQualificationReservation,
  resolveLiveIdentity,
  resolveLiveIdentityAsync,
  resolveMcpTransportAnchorAsync,
  resolveSessionRuntimeDir,
  scanPathForSymlinkEscape,
  scrubSessionIdentityEnv,
  SESSION_IDENTITY_SCRUB_KEYS,
  sessionSecretPath,
  setGlobalVerifiedCallerContext,
  sweepOrphanSessionFiches,
  verifyCallerIdentity,
  writeSessionFiche,
  writeSessionSidecar,
} from "../dist/runtime/identity/index.js";
import {
  buildLoopLaunchInvocation,
  executeLoopLaunchAsyncWithSpawn,
  executeLoopLaunchWithSpawn,
  prepareLoopLaunchAuth,
} from "../dist/runtime/loop/engine/adapters.js";
import {
  buildH2aRunInvocation,
  prepareH2aRunAuth,
  validateH2aRunRequest,
} from "../dist/runtime/mcp/agent-launch.js";
import { prepareSessionIdentityLaunch } from "../../h2a-runtime/dist/launch-identity.js";
import { durableTestDir } from "./durable-test-dir.js";
import { EventEmitter } from "node:events";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const H2A_BIN = join(REPO_ROOT, "packages/h2a/dist/bin.js");
const SCRATCH = mkdtempSync(join(tmpdir(), "h2a-cli-identity-guard-"));
const DURABLE_ROOT = durableTestDir("h2a-cli-identity-loop-");
const SYMBOL_CTX = Symbol.for("h2a.verifiedCallerContext");

after(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  rmSync(DURABLE_ROOT, { recursive: true, force: true });
});

afterEach(() => {
  delete globalThis[SYMBOL_CTX];
});

function captureStreams(cwd) {
  let stdoutText = "";
  let stderrText = "";
  return {
    cwd: () => cwd,
    stdout: { write: (s) => { stdoutText += s; return true; } },
    stderr: { write: (s) => { stderrText += s; return true; } },
    get stdoutText() { return stdoutText; },
    get stderrText() { return stderrText; },
  };
}

/** Create a synthetic Linux `/proc` tree under scratch for deterministic Proof 1-4 tests. */
function makeProcTree(options = {}) {
  const procRoot = mkdtempSync(join(SCRATCH, "proc-"));
  const bootId = options.bootId ?? "11111111-2222-4333-8444-555555555555";
  const pidNs = options.pidNs ?? "4026531836";
  const cgroup = options.cgroup ?? "0::/user.slice/h2a-session-test.scope";
  const uptime = options.uptime ?? "5000.00 1000.00\n";

  mkdirSync(join(procRoot, "sys/kernel/random"), { recursive: true });
  writeFileSync(join(procRoot, "sys/kernel/random/boot_id"), `${bootId}\n`);
  writeFileSync(join(procRoot, "uptime"), uptime);

  mkdirSync(join(procRoot, "self/ns"), { recursive: true });
  symlinkSync(`pid:[${options.selfPidNs ?? pidNs}]`, join(procRoot, "self/ns/pid"));
  writeFileSync(join(procRoot, "self/cgroup"), `${cgroup}\n`);

  const addProc = (pid, { ppid, comm, startTime, exe, argv }) => {
    const dir = join(procRoot, String(pid));
    mkdirSync(join(dir, "ns"), { recursive: true });
    symlinkSync(`pid:[${options.selfPidNs ?? pidNs}]`, join(dir, "ns/pid"));
    // Linux stat layout: fields after ") ": [0]=state [1]=ppid ... [19]=starttime
    const mid = Array.from({ length: 17 }, () => "0").join(" ");
    writeFileSync(join(dir, "stat"), `${pid} (${comm}) S ${ppid} ${mid} ${startTime} 0 0\n`);
    if (exe) symlinkSync(exe, join(dir, "exe"));
    if (argv) writeFileSync(join(dir, "cmdline"), Buffer.from(`${argv.join("\0")}\0`));
  };

  for (const p of options.procs ?? []) addProc(p.pid, p);
  return { procRoot, bootId, pidNs, addProc };
}

function makeFakeEnv(root, stateDir, runtimeDir, extra = {}) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: stateDir,
    XDG_STATE_HOME: join(stateDir, "xdg-state"),
    XDG_CONFIG_HOME: join(stateDir, "xdg-config"),
    XDG_RUNTIME_DIR: runtimeDir,
    H2A_ROOT: root,
    ...extra,
  };
}

function seedVerifiedFiche(runtimeDir, {
  actorId = "codex:work:aabbccddeeff",
  agentUuid = "22222222-3333-4444-8555-666666666666",
  host = "codex",
  sessionClass = "background",
  bootId = "11111111-2222-4333-8444-555555555555",
  pidNamespace = "4026531836",
  leaderPid = 100,
  leaderStartTime = "100",
  cliPid = 200,
  cliStartTime = "200",
  scopeUnit = "h2a-session-test.scope",
  hostSessionId = "thread-1",
  delegatorInstance = null,
} = {}) {
  const { sessionKey, secretSha256 } = mintSessionKeyAndSecret(runtimeDir);
  const fiche = {
    version: 1,
    sessionKey,
    actorId,
    agentUuid,
    host,
    invocationMode: "interactive",
    createdBy: "launcher",
    hostSessionId,
    cliPid,
    cliStartTime,
    sessionClass,
    delegatorInstance,
    delegatorSessionKey: null,
    secretSha256,
    leaderPid,
    leaderStartTime,
    bootId,
    pidNamespace,
    machineId: readMachineId(),
    scopeUnit,
    issuedAt: new Date().toISOString(),
  };
  writeSessionFiche(runtimeDir, fiche);
  return { sessionKey, secretSha256, fiche };
}

function writeKeypairForActor(root, actorId) {
  const paths = identityKeyPaths(root, actorId);
  mkdirSync(dirname(paths.privateKeyPath), { recursive: true, mode: 0o700 });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  writeFileSync(paths.privateKeyPath, privPem, { mode: 0o600 });
  writeFileSync(paths.publicKeyPath, pubPem);
  const store = createLocalStore({ root });
  store.registerInstance({
    id: actorId,
    instance: actorId,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: `file://${root}` }],
    publicKeys: [pubPem],
    acceptedPolicies: [],
    createdAt: new Date().toISOString(),
  });
  return { privPem, pubPem, paths };
}

test("Criteria 1-6: Proof 1 lineage, Proof 2 OR-rule, secret O_NOFOLLOW/0600, Q1-A --as, subagent rejection, and pidns-session-ref", () => {
  const storeRoot = mkdtempSync(join(SCRATCH, "store-"));
  const stateDir = mkdtempSync(join(SCRATCH, "state-"));
  const rtDir = mkdtempSync(join(SCRATCH, "rt-"), { mode: 0o700 });
  chmodSync(rtDir, 0o700);
  const fakeBin = mkdtempSync(join(SCRATCH, "bin-"));
  writeFileSync(join(fakeBin, "zsh"), "");
  writeFileSync(join(fakeBin, "bash"), "");
  writeFileSync(join(fakeBin, "node"), "");
  writeFileSync(join(fakeBin, "claude"), "");
  writeFileSync(join(fakeBin, "custom-wrapper"), "");

  // Multi-hop ancestor chain: leader(100 zsh) -> cli(200 node /usr/bin/codex.js) -> shell(300 bash) -> h2a(400)
  const { procRoot, bootId, pidNs } = makeProcTree({
    procs: [
      { pid: 100, ppid: 1, comm: "zsh", startTime: "100", exe: join(fakeBin, "zsh"), argv: ["zsh"] },
      { pid: 200, ppid: 100, comm: "node", startTime: "200", exe: join(fakeBin, "node"), argv: ["node", "/opt/bin/codex.js"] },
      { pid: 300, ppid: 200, comm: "bash", startTime: "300", exe: join(fakeBin, "bash"), argv: ["bash"] },
      { pid: 400, ppid: 300, comm: "node", startTime: "400", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
    ],
  });

  const actorId = "codex:work:aabbccddeeff";
  writeKeypairForActor(storeRoot, actorId);
  const { sessionKey } = seedVerifiedFiche(rtDir, {
    actorId,
    host: "codex",
    bootId,
    pidNamespace: pidNs,
    leaderPid: 100,
    leaderStartTime: "100",
    cliPid: 200,
  });

  const env = makeFakeEnv(storeRoot, stateDir, rtDir, { H2A_INSTANCE: "forged-peer" });

  // Missing --as rejected even if H2A_INSTANCE is forged.
  const noAs = verifyCallerIdentity({
    argv: ["send", "other", "hi"],
    procRoot,
    pid: 400,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(noAs.ok, false);
  assert.equal(noAs.reasonCode, "missing-login");

  // Matching --as succeeds via Proof 2 rule 3 (interpreter + argv[1] === codex.js), stripping --as.
  const okSend = verifyCallerIdentity({
    argv: ["--as", actorId, "send", "other", "hi", "--from", actorId],
    procRoot,
    pid: 400,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(okSend.ok, true);
  assert.equal(okSend.mode, "agent");
  assert.equal(okSend.verificationMode, "proc-lineage");
  assert.equal(okSend.actorId, actorId);
  assert.deepEqual(okSend.forwardedArgv, ["send", "other", "hi", "--from", actorId]);

  // Q1-A exception: `coach propose --as` retains `--as` in forwardedArgv.
  const coachRes = verifyCallerIdentity({
    argv: ["--as", actorId, "coach", "propose", "--file", "org.yaml"],
    procRoot,
    pid: 400,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(coachRes.ok, true);
  assert.deepEqual(coachRes.forwardedArgv, ["coach", "propose", "--as", actorId, "--file", "org.yaml"]);

  // Proof 2 OR-rule must NOT match free tokens in argv[2..].
  const fakeArgv2 = makeProcTree({
    cgroup: "0::/user.slice/session-1.scope",
    procs: [
      { pid: 10, ppid: 1, comm: "bash", startTime: "10", exe: join(fakeBin, "bash"), argv: ["bash", "codex"] },
      { pid: 20, ppid: 10, comm: "custom", startTime: "20", exe: join(fakeBin, "custom-wrapper"), argv: ["custom-wrapper", "--note", "codex"] },
      { pid: 30, ppid: 20, comm: "node", startTime: "30", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
    ],
  });
  const freeTokRes = verifyCallerIdentity({
    argv: ["init"],
    procRoot: fakeArgv2.procRoot,
    pid: 30,
    stdinIsTTY: true,
    sessionRuntimeDir: rtDir,
    env: makeFakeEnv(storeRoot, stateDir, rtDir),
  });
  assert.equal(freeTokRes.ok, true);
  assert.equal(freeTokRes.mode, "owner"); // Neither cgroup nor Proof 2 matched free argv[2]!

  // Secret in argv forbidden even with valid fiche.
  const secretBytes = readFileSync(sessionSecretPath(rtDir, sessionKey));
  const rawArgvSecret = verifyCallerIdentity({
    argv: ["--as", actorId, "send", "x", secretBytes.toString("hex")],
    procRoot,
    pid: 400,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(rawArgvSecret.ok, false);
  assert.equal(rawArgvSecret.reasonCode, "secret-in-argv-forbidden");

  // Tampered secret file permissions (0644) -> cli-session-secret-invalid + alert.
  const secPath = sessionSecretPath(rtDir, sessionKey);
  chmodSync(secPath, 0o644);
  const badMode = verifyCallerIdentity({
    argv: ["--as", actorId, "send", "x", "hi"],
    procRoot,
    pid: 400,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(badMode.ok, false);
  assert.equal(badMode.reasonCode, "cli-session-secret-invalid");
  assert.equal(badMode.alertWritten, true);
  chmodSync(secPath, 0o600);

  // Nested foreign CLI / subagent under parent fiche -> fiche-parent-rejected + alert.
  const subagentProc = makeProcTree({
    procs: [
      { pid: 100, ppid: 1, comm: "zsh", startTime: "100", exe: join(fakeBin, "zsh"), argv: ["zsh"] },
      { pid: 200, ppid: 100, comm: "node", startTime: "200", exe: join(fakeBin, "node"), argv: ["node", "/opt/bin/codex.js"] },
      { pid: 300, ppid: 200, comm: "bash", startTime: "300", exe: join(fakeBin, "bash"), argv: ["bash"] },
      { pid: 350, ppid: 300, comm: "claude", startTime: "350", exe: join(fakeBin, "claude"), argv: ["claude"] },
      { pid: 400, ppid: 350, comm: "node", startTime: "400", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
    ],
  });
  const subagentRes = verifyCallerIdentity({
    argv: ["--as", actorId, "send", "x", "hi"],
    procRoot: subagentProc.procRoot,
    pid: 400,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(subagentRes.ok, false);
  assert.equal(subagentRes.reasonCode, "fiche-parent-rejected");
  assert.equal(subagentRes.alertWritten, true);

  // Foreign PID namespace pidns-session-ref succeeds when pidNs differs and host CLI matches; fails on same pidNs copy.
  const sameNsCopy = verifyCallerIdentity({
    argv: ["--as", actorId, "send", "x", "hi"],
    procRoot: makeProcTree({
      pidNs,
      procs: [
        { pid: 50, ppid: 1, comm: "node", startTime: "50", exe: join(fakeBin, "node"), argv: ["node", "codex"] },
        { pid: 60, ppid: 50, comm: "node", startTime: "60", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
      ],
    }).procRoot,
    pid: 60,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env: { ...env, H2A_SESSION_REF: sessionKey },
  });
  assert.equal(sameNsCopy.ok, false);
  assert.equal(sameNsCopy.reasonCode, "pid-lineage-mismatch");

  const foreignNsOk = verifyCallerIdentity({
    argv: ["--as", actorId, "send", "x", "hi"],
    procRoot: makeProcTree({
      pidNs: "4026539999",
      procs: [
        { pid: 2, ppid: 1, comm: "node", startTime: "50", exe: join(fakeBin, "node"), argv: ["node", "codex"] },
        { pid: 3, ppid: 2, comm: "node", startTime: "60", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
      ],
    }).procRoot,
    pid: 3,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    hostPidNamespace: pidNs,
    env: { ...env, H2A_SESSION_REF: sessionKey },
  });
  assert.equal(foreignNsOk.ok, true);
  assert.equal(foreignNsOk.verificationMode, "pidns-session-ref");
  assert.equal(foreignNsOk.actorId, actorId);
});

test("Criteria 7-15 & NB-2/NB-3/NB-4/NB-6/NB-7: Q2-2 grants, pre-grant checks, owner/script without grants, h2a-shell, and isolated-tmp boundaries", () => {
  const storeRoot = mkdtempSync(join(SCRATCH, "q22-store-"));
  const stateDir = mkdtempSync(join(SCRATCH, "q22-state-"));
  const rtDir = mkdtempSync(join(SCRATCH, "q22-rt-"), { mode: 0o700 });
  chmodSync(rtDir, 0o700);
  const fakeBin = mkdtempSync(join(SCRATCH, "q22-bin-"));
  writeFileSync(join(fakeBin, "zsh"), "");
  writeFileSync(join(fakeBin, "node"), "");

  const { procRoot, bootId, pidNs } = makeProcTree({
    procs: [
      { pid: 100, ppid: 1, comm: "zsh", startTime: "100", exe: join(fakeBin, "zsh"), argv: ["zsh"] },
      { pid: 200, ppid: 100, comm: "node", startTime: "200", exe: join(fakeBin, "node"), argv: ["node", "codex"] },
      { pid: 300, ppid: 200, comm: "node", startTime: "300", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
    ],
  });

  const actorId = "codex:ctrl:abcdef123456";
  writeKeypairForActor(storeRoot, actorId);
  seedVerifiedFiche(rtDir, {
    actorId,
    host: "codex",
    bootId,
    pidNamespace: pidNs,
    leaderPid: 100,
    leaderStartTime: "100",
    cliPid: 200,
  });
  const env = makeFakeEnv(storeRoot, stateDir, rtDir);

  // Issue one-shot grant for central-compact.
  const grant = issueOwnerGrant(rtDir, {
    act: "central-compact",
    actorId,
    ttlMs: 120_000,
    bootId,
    machineId: readMachineId(),
    uptimeSec: 4990,
    issuerPid: process.pid,
    issuerTty: "pts/0",
  });

  // NB-2: disallowed flags & invalid flag combinations MUST fail BEFORE consuming the grant!
  for (const badArgv of [
    ["--as", actorId, "central", "compact", "--dry-run"],
    ["--as", actorId, "central", "compact", "--restore"],
    ["--as", actorId, "central", "compact", "--root", storeRoot],
    ["--as", actorId, "central", "compact", "--runtime-base", "/tmp/rb"],
    ["--as", actorId, "central", "compact", "--dry-run", "--restore"],
    ["--as", actorId, "central", "compact", "--unknown-flag"],
  ]) {
    const r = verifyCallerIdentity({
      argv: badArgv,
      procRoot,
      pid: 300,
      stdinIsTTY: false,
      sessionRuntimeDir: rtDir,
      env,
    });
    assert.equal(r.ok, false, `NB-2 should refuse ${badArgv.join(" ")}`);
  }

  // After all NB-2 refusals, the grant MUST still be intact and consumable ONCE!
  const validUse = verifyCallerIdentity({
    argv: ["--as", actorId, "central", "compact", "--json"],
    procRoot,
    pid: 300,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(validUse.ok, true, `validUse failed: ${JSON.stringify(validUse)}`);
  assert.equal(validUse.consumedGrant?.grantId, grant.grantId);
  validUse.recordGrantOutcome?.(0);

  // Second invocation must fail with owner-authorization-required + alert!
  const reuseUse = verifyCallerIdentity({
    argv: ["--as", actorId, "central", "compact", "--json"],
    procRoot,
    pid: 300,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(reuseUse.ok, false);
  assert.equal(reuseUse.reasonCode, "owner-authorization-required");
  assert.equal(reuseUse.alertWritten, true);

  // NB-7: verify owner-grant-outcome line recorded in cli-identity-audit.jsonl.
  const auditPath = join(env.XDG_STATE_HOME, "h2a", "cli-identity-audit.jsonl");
  const auditLines = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(auditLines.some((r) => r.reasonCode === "owner-grant-outcome" && r.grantId === grant.grantId && r.exitCode === 0));

  // NB-6: interactive owner terminal runs central stop & authorize WITHOUT any owner grant.
  const ownerProc = makeProcTree({
    cgroup: "0::/user.slice/session-1.scope",
    procs: [{ pid: 99, ppid: 1, comm: "bash", startTime: "99", exe: join(fakeBin, "zsh"), argv: ["bash"] }],
  });
  for (const ownerCmd of [
    ["central", "stop"],
    ["authorize", "central-stop", "--for", actorId],
    ["doctor", "--repair"],
  ]) {
    const ownerRes = verifyCallerIdentity({
      argv: ownerCmd,
      procRoot: ownerProc.procRoot,
      pid: 99,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      sessionRuntimeDir: rtDir,
      env: { ...env, TMUX: "/tmp/tmux-1000/default,1,0" },
    });
    assert.equal(ownerRes.ok, true);
    assert.equal(ownerRes.mode, "owner");
    assert.equal(ownerRes.consumedGrant, null);
  }

  // NB-6: service/script allowlist runs WITHOUT grant, refuses owner-only interactive acts.
  for (const serviceCmd of [
    ["archive", "--once"],
    ["keepalive"],
    ["jobs", "conduct"],
    ["central", "compact"],
    ["loop", "supervise"],
    ["remote", "mirror", "--url", "https://example.test", "--instance", actorId, "--private-key", join(storeRoot, "keys", `${actorId}.key.pem`), "--interval-ms", "5000"],
  ]) {
    const svcRes = verifyCallerIdentity({
      argv: serviceCmd,
      procRoot: ownerProc.procRoot,
      pid: 99,
      stdinIsTTY: false,
      stdoutIsTTY: false,
      sessionRuntimeDir: rtDir,
      env,
    });
    assert.equal(svcRes.ok, true, `service cmd should pass: ${serviceCmd.join(" ")}`);
    assert.equal(svcRes.mode, "script");
    assert.equal(svcRes.consumedGrant, null);
  }
  const nonTtyAuth = verifyCallerIdentity({
    argv: ["authorize", "central-stop", "--for", actorId],
    procRoot: ownerProc.procRoot,
    pid: 99,
    stdinIsTTY: false,
    stdoutIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(nonTtyAuth.ok, false);
  assert.equal(nonTtyAuth.reasonCode, "owner-only-command");

  // h2a-shell: Proof 1=0, Proof 2=0, stdin.isTTY=true, H2A_SESSION_CLASS=human
  const shellEnv = { ...env, H2A_SESSION_CLASS: "human" };
  assert.equal(
    verifyCallerIdentity({
      argv: ["resume", "slug"],
      procRoot: ownerProc.procRoot,
      pid: 99,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      sessionRuntimeDir: rtDir,
      env: shellEnv,
    }).mode,
    "h2a-shell",
  );
  for (const deniedInShell of [["trust"], ["authorize", "central-stop", "--for", actorId], ["central", "stop"], ["register", "--root", "/tmp/x"]]) {
    const r = verifyCallerIdentity({
      argv: deniedInShell,
      procRoot: ownerProc.procRoot,
      pid: 99,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      sessionRuntimeDir: rtDir,
      env: shellEnv,
    });
    assert.equal(r.ok, false, `h2a-shell must deny ${deniedInShell.join(" ")}`);
  }

  // agentPolicy BEFORE isolated `/tmp`: owner-only/owner-authorized stay blocked even with valid fiche under `/tmp`;
  // `own-only` (`stop`) never downgrades to `isolated-tmp` (without fiche fails closed; with fiche stays in verified `agent` mode for Q2-1 check).
  for (const privCmd of [
    ["init", "--root", "/tmp/h2a-nonexistent-test-iso"],
    ["--as", actorId, "central", "stop", "--root", "/tmp/h2a-nonexistent-test-iso"],
  ]) {
    const r = verifyCallerIdentity({
      argv: privCmd,
      procRoot,
      pid: 300,
      stdinIsTTY: false,
      sessionRuntimeDir: rtDir,
      env,
    });
    assert.equal(r.ok, false, `privileged verb ${privCmd[0]} must never bypass under /tmp`);
  }
  const stopWithFicheTmp = verifyCallerIdentity({
    argv: ["--as", actorId, "stop", "worker-1", "--root", "/tmp/h2a-nonexistent-test-iso"],
    procRoot,
    pid: 300,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(stopWithFicheTmp.mode, "agent");
  const stopUnverifiedTmp = verifyCallerIdentity({
    argv: ["stop", "worker-1", "--root", "/tmp/h2a-nonexistent-test-iso"],
    procRoot: ownerProc.procRoot,
    pid: 99,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(stopUnverifiedTmp.ok, false);

  // Allowed isolatedRootSafe verb under fixed /tmp works even with H2A_SESSION_REF absent, UNLESS H2A_IDENTITY_GUARD_ENFORCE=1 (Criterion 26 / NB-4).
  const safeTmp = verifyCallerIdentity({
    argv: ["discover", "--root", "/tmp/h2a-nonexistent-test-iso"],
    procRoot,
    pid: 300,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env: { ...env, TMPDIR: "/var/tmp" },
  });
  assert.equal(safeTmp.ok, true);
  assert.equal(safeTmp.mode, "isolated-tmp");

  const enforcedTmp = verifyCallerIdentity({
    argv: ["discover", "--root", "/tmp/h2a-nonexistent-test-iso"],
    procRoot,
    pid: 300,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env: { ...env, H2A_IDENTITY_GUARD_ENFORCE: "1" },
  });
  assert.equal(enforcedTmp.ok, false);
  assert.equal(enforcedTmp.reasonCode, "missing-login");
});

test("Criterion 16 & B-4 & B-2: daemon-internal receipts + both loop adapters (executeLoopLaunchWithSpawn & executeLoopLaunchAsyncWithSpawn)", async () => {
  const rtDir = mkdtempSync(join(SCRATCH, "daemon-rt-"), { mode: 0o700 });
  chmodSync(rtDir, 0o700);
  const stateDir = mkdtempSync(join(SCRATCH, "daemon-state-"));
  const ws = mkdtempSync(join(SCRATCH, "daemon-ws-"));
  const fakeBin = mkdtempSync(join(SCRATCH, "daemon-bin-"));
  writeFileSync(join(fakeBin, "node"), "");
  writeFileSync(join(fakeBin, "codex"), "");

  // Non-agent daemon (pid=500 -> pid=501 child h2a)
  const { procRoot } = makeProcTree({
    cgroup: "0::/user.slice/h2a-daemon-loop.scope",
    procs: [
      { pid: 500, ppid: 1, comm: "node", startTime: "500", exe: join(fakeBin, "node"), argv: ["node", "loop-supervisor.js"] },
      { pid: 501, ppid: 500, comm: "node", startTime: "501", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
    ],
  });
  const issued = issueDaemonLaunchReceipt(rtDir, {
    daemonKind: "loop-engine",
    daemonPid: 500,
    procRoot,
    allowedVerb: "run",
    delegatorInstance: "daemon:loop-engine",
    delegationOrigin: "loop-engine",
    sessionClass: "background",
    targetProfile: "agy",
    targetWorkspace: ws,
  });
  const env = makeFakeEnv(ws, stateDir, rtDir, {
    H2A_RUN_LAUNCH_ID: issued.launchId,
    H2A_RUN_LAUNCH_TOKEN: issued.launchToken,
  });
  const okReceipt = verifyCallerIdentity({
    argv: ["run", "agy", ws],
    procRoot,
    pid: 501,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(okReceipt.ok, true, `okReceipt failed: ${JSON.stringify(okReceipt)}`);
  assert.equal(okReceipt.mode, "daemon-receipt");
  assert.equal(okReceipt.actorId, "daemon:loop-engine");

  // One-time receipt replay fails closed.
  const replayReceipt = verifyCallerIdentity({
    argv: ["run", "agy", ws],
    procRoot,
    pid: 501,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env,
  });
  assert.equal(replayReceipt.ok, false);
  assert.equal(replayReceipt.reasonCode, "daemon-receipt-invalid");

  // Non-mcp-stdio daemon inside agent lineage must be rejected.
  const pollutedTree = makeProcTree({
    procs: [
      { pid: 499, ppid: 1, comm: "codex", startTime: "499", exe: join(fakeBin, "codex"), argv: ["codex"] },
      { pid: 500, ppid: 499, comm: "node", startTime: "500", exe: join(fakeBin, "node"), argv: ["node", "loop.js"] },
      { pid: 501, ppid: 500, comm: "node", startTime: "501", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
    ],
  });
  const badDaemon = issueDaemonLaunchReceipt(rtDir, {
    daemonKind: "loop-engine",
    daemonPid: 500,
    procRoot: pollutedTree.procRoot,
    allowedVerb: "run",
    delegatorInstance: "daemon:loop-engine",
    delegationOrigin: "loop-engine",
    sessionClass: "background",
  });
  const rejAgentDaemon = verifyCallerIdentity({
    argv: ["run", "agy", ws],
    procRoot: pollutedTree.procRoot,
    pid: 501,
    stdinIsTTY: false,
    sessionRuntimeDir: rtDir,
    env: makeFakeEnv(ws, stateDir, rtDir, {
      H2A_RUN_LAUNCH_ID: badDaemon.launchId,
      H2A_RUN_LAUNCH_TOKEN: badDaemon.launchToken,
    }),
  });
  assert.equal(rejAgentDaemon.ok, false);
  assert.equal(rejAgentDaemon.reasonCode, "daemon-receipt-invalid");

  // B-4: prepareLoopLaunchAuth in verified agent context places `--as <actorId>` right before `"run"`, and non-agent issues/cleans receipts across sync + async adapters.
  const durableWs = mkdtempSync(join(DURABLE_ROOT, "ws-"));
  const spec = { profile: "codex", workspace: durableWs, prompt: "hi", model: "gpt-5.6-terra", name: "loop-a" };
  setGlobalVerifiedCallerContext({
    verified: true,
    mode: "agent",
    isAgent: true,
    isH2aShell: false,
    isOwner: false,
    isScript: false,
    parentFicheRejected: false,
    isForeignPidNamespace: false,
    actorId: "codex:loop:112233445566",
    sessionKey: "sess_loop",
    agentUuid: "u-1",
    host: "codex",
    delegatorInstance: null,
    delegatorSessionKey: null,
    verificationMode: "proc-lineage",
    sessionFiche: null,
  });
  const realInv = buildLoopLaunchInvocation(spec);
  const authAgent = prepareLoopLaunchAuth(spec, realInv, false, { sessionRuntimeDir: rtDir });
  assert.equal(authAgent.args[0], realInv.args[0]);
  assert.deepEqual(authAgent.args.slice(1, 4), ["--as", "codex:loop:112233445566", "run"]);
  delete globalThis[SYMBOL_CTX];

  // Verify sync & async loop executors both issue + clean up daemon receipts without leaving dangling files.
  const prevXdgRt = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = rtDir;
  try {
    let seenSyncEnv;
    let seenSyncArgs;
    executeLoopLaunchWithSpawn(
      { profile: "claude", workspace: durableWs, prompt: "p", model: "claude-sonnet-4-5", name: "t-sync" },
      (_cmd, args, opts) => {
        seenSyncArgs = args;
        seenSyncEnv = opts.env;
        return { status: 0, stdout: "", stderr: "" };
      },
    );
    assert.ok(seenSyncEnv !== undefined);
    assert.ok(seenSyncArgs?.includes("run"));
    assert.equal(existsSync(join(rtDir, "h2a", "daemon-launches")), false);

    const fakeAsyncSpawn = () => {
      const child = new EventEmitter();
      child.stdout = Object.assign(new EventEmitter(), { setEncoding() { return this; } });
      child.stderr = Object.assign(new EventEmitter(), { setEncoding() { return this; } });
      child.stdin = Object.assign(new EventEmitter(), { end() {} });
      child.kill = () => {};
      queueMicrotask(() => child.emit("error", new Error("spawn EPERM")));
      return child;
    };
    const asyncRes = await executeLoopLaunchAsyncWithSpawn(
      { profile: "codex", workspace: durableWs, prompt: "p", model: "gpt-5.6-terra", name: "t-async" },
      fakeAsyncSpawn,
      500,
    );
    assert.equal(asyncRes.ok, false);
    // Explicit runtime receipt issued via prepareLoopLaunchAuth is removed cleanly by auth.cleanup().
    const authCleanupTest = prepareLoopLaunchAuth(spec, realInv, false, { sessionRuntimeDir: rtDir });
    const lid = authCleanupTest.env.H2A_RUN_LAUNCH_ID;
    assert.ok(lid);
    authCleanupTest.cleanup();
    assert.equal(existsSync(join(rtDir, "daemon-launches", `${lid}.json`)), false);
  } finally {
    if (prevXdgRt === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = prevXdgRt;
  }
});

test("Criteria 20-23, 25: Track M3 Ed25519 provenance, cmdSend, cmdWakeRequest, presence pidNamespace, and drive/drumbeat hooks", async () => {
  const storeRoot = mkdtempSync(join(SCRATCH, "cli-store-"));
  const ws = mkdtempSync(join(SCRATCH, "cli-ws-"));
  const stateDir = mkdtempSync(join(SCRATCH, "cli-state-"));
  const rtDir = mkdtempSync(join(SCRATCH, "cli-rt-"), { mode: 0o700 });
  chmodSync(rtDir, 0o700);
  const actorId = "codex:track:112233445566";
  writeKeypairForActor(storeRoot, actorId);

  // Initialize real .track store.
  const eventsPath = join(ws, ".track", "events.jsonl");
  const initTrack = new Track(new EventStore(eventsPath), { by: "human:init" });
  initTrack.createItem({ kind: "chore", title: "seed", workspace: "ws-1" });

  // Verified agent writes via delegateToTrackNative -> actorOverride stamps by:"agent:<actorId>" & auth:"signed" Ed25519!
  setGlobalVerifiedCallerContext({
    verified: true,
    mode: "agent",
    isAgent: true,
    isH2aShell: false,
    isOwner: false,
    isScript: false,
    parentFicheRejected: false,
    isForeignPidNamespace: false,
    actorId,
    sessionKey: "sess_track_001",
    agentUuid: "uuid-track",
    host: "codex",
    delegatorInstance: null,
    delegatorSessionKey: null,
    verificationMode: "proc-lineage",
    sessionFiche: { sessionKey: "sess_track_001" },
  });
  const origCwd = process.cwd();
  const prevH2aRoot = process.env.H2A_ROOT;
  process.chdir(ws);
  process.env.H2A_ROOT = storeRoot;
  try {
    const s = captureStreams(ws);
    const rc = await runCli(["item", "new", "--kind", "chore", "--title", "agent-signed-item", "--workspace", "ws-1"], s);
    assert.equal(rc, 0, s.stderrText);
  } finally {
    process.chdir(origCwd);
    if (prevH2aRoot === undefined) delete process.env.H2A_ROOT;
    else process.env.H2A_ROOT = prevH2aRoot;
  }
  const allEvents = new EventStore(eventsPath).readAll();
  const created = allEvents.at(-1);
  assert.equal(created.by, `agent:${actorId}`);
  assert.deepEqual(
    {
      transport: created.prov?.transport,
      proposed: created.prov?.proposed,
      auth: created.prov?.auth,
      principal: created.prov?.principal,
      alg: created.prov?.sig?.alg,
      by: created.prov?.sig?.by,
    },
    {
      transport: "cli",
      proposed: true,
      auth: "signed",
      principal: actorId,
      alg: "Ed25519",
      by: actorId,
    },
  );
  assert.ok(typeof created.prov?.sig?.value === "string" && created.prov.sig.value.length > 20);

  // cmdSend ignores forged H2A_INSTANCE when caller context is verified agent.
  const prevInst = process.env.H2A_INSTANCE;
  process.env.H2A_INSTANCE = "codex:forged:ffffffffffff";
  const peer = "codex:peer:998877665544";
  writeKeypairForActor(storeRoot, peer);
  try {
    const sSend = captureStreams(ws);
    const sendRc = await runCli(["send", peer, "hello", "--root", storeRoot], sSend);
    assert.equal(sendRc, 0, sSend.stderrText);
    const sent = JSON.parse(sSend.stdoutText);
    assert.equal(sent.from, actorId);
  } finally {
    if (prevInst === undefined) delete process.env.H2A_INSTANCE;
    else process.env.H2A_INSTANCE = prevInst;
  }

  // cmdWakeRequest rewrites instructionLine depending on live fiche presence.
  const sWakeAbsent = captureStreams(ws);
  assert.equal(await runCli(["wake-request", "--to", actorId, "--root", storeRoot, "--dry-run"], sWakeAbsent), 0);
  const wakeAbsentJson = JSON.parse(sWakeAbsent.stdoutText);
  assert.match(wakeAbsentJson.request.instructionLine, /h2a_inbox_read/);

  // cmdPresenceReap fails closed in foreign PID namespace (except D16/isolated-tmp).
  setGlobalVerifiedCallerContext({
    verified: true,
    mode: "internal",
    isAgent: false,
    isH2aShell: false,
    isOwner: false,
    isScript: false,
    parentFicheRejected: false,
    isForeignPidNamespace: true,
    actorId: null,
    sessionKey: null,
    agentUuid: null,
    host: null,
    delegatorInstance: null,
    delegatorSessionKey: null,
    verificationMode: "internal",
    sessionFiche: null,
  });
  const reapFail = captureStreams(ws);
  assert.equal(cmdPresenceReap({ root: storeRoot }, reapFail), 2);
  assert.match(reapFail.stderrText, /presence-reap-pidns-forbidden/);

  // presence.ts never reaps sessions with a foreign pidNamespace.
  writePresence(storeRoot, {
    sessionId: "sess:foreign-ns",
    instance: peer,
    host: "codex",
    pid: 999998,
    pidNamespace: "4026539991",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: ["presence.peer_joined"],
  });
  const reapedList = reapAllDeadPresence(storeRoot, () => false);
  assert.equal(reapedList.some((r) => r.sessionId === "sess:foreign-ns"), false);
  assert.equal(reapDeadInstancePresence(storeRoot, peer, "", () => false).length, 0);
  assert.equal(listPresence(storeRoot, { includeExpired: true }).some((s) => s.sessionId === "sess:foreign-ns"), true);

  // cmdDriveReceive checks `--ignore-non-drive` BEFORE `!flags.to` and fails exit 2 for unaddressed `[h2a ...]`.
  delete globalThis[SYMBOL_CTX];
  const driveNon = captureStreams(ws);
  assert.equal(
    await runCli(["drive", "receive", "--line", "hello normal prompt", "--ignore-non-drive", "--root", storeRoot], driveNon),
    0,
  );
  assert.equal(JSON.parse(driveNon.stdoutText).ignored, true);

  const driveUnaddressed = captureStreams(ws);
  assert.equal(
    await runCli(["drive", "receive", "--line", "[h2a from=x] do task", "--ignore-non-drive", "--root", storeRoot], driveUnaddressed),
    2,
  );

  // cmdDoctor never fails or mutates owner-grants in agent mode; NB-6 read-only/EROFS check.
  setGlobalVerifiedCallerContext({
    verified: true,
    mode: "agent",
    isAgent: true,
    isH2aShell: false,
    isOwner: false,
    isScript: false,
    parentFicheRejected: false,
    isForeignPidNamespace: false,
    actorId,
    sessionKey: "sess_doc",
    agentUuid: "u-doc",
    host: "codex",
    delegatorInstance: null,
    delegatorSessionKey: null,
    verificationMode: "proc-lineage",
    sessionFiche: null,
  });
  const prevXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateDir;
  try {
    const docStreams = captureStreams(ws);
    const docRc = await runCli(
      ["doctor", "--root", storeRoot, "--skip-hosts", "--repair"],
      docStreams,
      { doctorHostInstallations: () => ({ ok: true, hosts: [] }) },
    );
    assert.equal(docRc, 0, docStreams.stderrText);
    const docJson = JSON.parse(docStreams.stdoutText);
    if (docJson.checks.ownerGrantsMaintenance?.dir) {
      assert.equal(docJson.checks.ownerGrantsMaintenance.repaired, false);
    }
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prevXdg;
  }
});

test("Criteria 21-22: MCP resolveMcpTransportAnchorAsync + live.ts sessionAnchor strict/audit-only & 10s sidecar timeout", async () => {
  const storeRoot = mkdtempSync(join(SCRATCH, "mcp-store-"));
  const stateDir = mkdtempSync(join(SCRATCH, "mcp-state-"));
  const rtDir = mkdtempSync(join(SCRATCH, "mcp-rt-"), { mode: 0o700 });
  chmodSync(rtDir, 0o700);
  const ws = mkdtempSync(join(SCRATCH, "mcp-ws-"));
  const fakeBin = mkdtempSync(join(SCRATCH, "mcp-bin-"));
  writeFileSync(join(fakeBin, "claude"), "");
  writeFileSync(join(fakeBin, "node"), "");

  const actorId = "claude:mcp:112233445566";
  const agentUuid = "33333333-4444-4555-8666-777777777777";
  writeKeypairForActor(storeRoot, actorId);

  const { procRoot, bootId, pidNs } = makeProcTree({
    procs: [
      { pid: 100, ppid: 1, comm: "claude", startTime: "100", exe: join(fakeBin, "claude"), argv: ["claude"] },
      { pid: 200, ppid: 100, comm: "node", startTime: "200", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] },
    ],
  });
  seedVerifiedFiche(rtDir, {
    actorId,
    agentUuid,
    host: "claude",
    bootId,
    pidNamespace: pidNs,
    leaderPid: 100,
    leaderStartTime: "100",
    cliPid: 100,
    cliStartTime: "100",
  });

  // (1) `/proc` anchor resolves own sessionAnchor.
  const anchorRes = await resolveMcpTransportAnchorAsync({
    pid: 200,
    processPid: 200,
    procRoot,
    sessionRuntimeDir: rtDir,
    env: makeFakeEnv(storeRoot, stateDir, rtDir),
  });
  assert.equal(anchorRes.ok, true);
  assert.ok(anchorRes.anchor, `expected anchor, got ${JSON.stringify(anchorRes)}`);
  assert.deepEqual(anchorRes.anchor, { actorId, agentUuid, sessionKey: anchorRes.anchor.sessionKey });

  // Strict claude mismatch on explicit --instance throws mcp-identity-mismatch and writes alert.
  const strictEnv = makeFakeEnv(storeRoot, stateDir, rtDir);
  const prevState = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateDir;
  try {
    assert.throws(
      () => resolveLiveIdentity({
        root: storeRoot,
        host: "claude",
        cwd: ws,
        explicitInstance: "claude:forged:000000000000",
        sessionAnchor: anchorRes.anchor,
      }),
      /mcp-identity-mismatch/,
    );
    await assert.rejects(
      () => resolveLiveIdentityAsync({
        root: storeRoot,
        host: "claude",
        cwd: ws,
        expectedInstance: "claude:other:000000000000",
        sessionAnchor: anchorRes.anchor,
      }),
      /mcp-identity-mismatch/,
    );
  } finally {
    if (prevState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prevState;
  }

  // Missing provider session + verified anchor resolves cleanly WITHOUT `fallback:*`.
  const resolved = resolveLiveIdentity({
    root: storeRoot,
    host: "claude",
    cwd: ws,
    sessionAnchor: anchorRes.anchor,
    readers: { homedir: () => stateDir, env: () => ({}), now: () => Date.now() },
  });
  assert.equal(resolved.instance, actorId);
  assert.equal(resolved.action, "reclaim");

  // (3) Sidecar with H2A_SESSION_REF polls until timeout -> sidecar-anchor-timeout (exit 2).
  const timeoutRes = await resolveMcpTransportAnchorAsync({
    pid: 200,
    processPid: 200,
    procRoot: makeProcTree({
      procs: [{ pid: 200, ppid: 1, comm: "node", startTime: "200", exe: join(fakeBin, "node"), argv: ["node", "bin.js"] }],
    }).procRoot,
    sessionRuntimeDir: rtDir,
    waitTimeoutMs: 60,
    pollIntervalMs: 15,
    env: makeFakeEnv(storeRoot, stateDir, rtDir, { H2A_SESSION_REF: "sess_never_created_01" }),
  });
  assert.equal(timeoutRes.ok, false);
  assert.equal(timeoutRes.exitCode, 2);
  assert.equal(timeoutRes.reasonCode, "sidecar-anchor-timeout");
  void strictEnv;
});

test("Criterion 19 static check: Codex --no-daemon enforcement and 51-key scrub matrix", () => {
  assert.deepEqual(applyCodexNoDaemon(["--model", "o3", "Fix bug"], { enabled: true }), [
    "--no-daemon",
    "--model",
    "o3",
    "Fix bug",
  ]);
  assert.deepEqual(applyCodexNoDaemon(["resume", "thread-1"], { enabled: true }), [
    "resume",
    "--no-daemon",
    "thread-1",
  ]);

  // Check static scrub table size and absence of protected owner keys.
  assert.equal(SESSION_IDENTITY_SCRUB_KEYS.length, 51);
  for (const keep of ["H2A_SESSION_HOST", "H2A_REMOTE_CONTROL", "REMOTE_DELEGATE_DEPTH", "TMPDIR", "H2A_MCP_AUTHORITY"]) {
    assert.equal(SESSION_IDENTITY_SCRUB_KEYS.includes(keep), false);
  }
  const scrubbed = scrubSessionIdentityEnv({ H2A_SESSION_REF: "x", H2A_SESSION_HOST: "native" });
  assert.equal(scrubbed.H2A_SESSION_REF, undefined);
  assert.equal(scrubbed.H2A_SESSION_HOST, "native");

  // Annex B static invariant: no unguarded bare `["resume"]` in runtime launcher production source files.
  const runtimeSrc = join(REPO_ROOT, "packages/h2a-runtime/src");
  for (const name of readdirSync(runtimeSrc)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const text = readFileSync(join(runtimeSrc, name), "utf8");
    assert.doesNotMatch(
      text,
      /const\s+args\s*=\s*\[\s*"resume"\s*(?:,\s*"--last"\s*)?\]/,
      `${name} must route Codex resume via codexResumeArgs / applyCodexNoDaemon`,
    );
  }
});

test("Criterion 15 & NB-7: anti-symlink scan blocks boundary escapes and doctor --repair prints exact purged tmux keys", async () => {
  const boundary = mkdtempSync(join(SCRATCH, "iso-bound-"));
  const outside = mkdtempSync(join(SCRATCH, "iso-outside-"));
  const inner = join(boundary, "store");
  mkdirSync(inner, { recursive: true });
  assert.equal(scanPathForSymlinkEscape(inner, boundary), undefined);

  // Live symlink escaping boundary.
  const escapeLink = join(inner, "escape-link");
  symlinkSync(outside, escapeLink);
  assert.match(scanPathForSymlinkEscape(inner, boundary) ?? "", /escapes isolated boundary/);
  rmSync(escapeLink, { force: true });

  // Dangling symlink escaping boundary.
  const danglingLink = join(inner, "dangling-escape");
  symlinkSync(join(outside, "missing-target"), danglingLink);
  assert.match(scanPathForSymlinkEscape(inner, boundary) ?? "", /escapes isolated boundary/);
  rmSync(danglingLink, { force: true });

  // NB-7: owner `h2a doctor --repair` scrubs leaked tmux global keys and prints exact purged list to stderr.
  const fakeTmuxBin = mkdtempSync(join(SCRATCH, "fake-tmux-bin-"));
  const scrubbedLog = join(SCRATCH, "tmux-scrubbed.txt");
  writeFileSync(
    join(fakeTmuxBin, "tmux"),
    `#!/usr/bin/env bash
if [ "$1" = "show-environment" ] && [ "$2" = "-g" ]; then
  printf 'H2A_SESSION_REF=leaked-ref\\nH2A_SESSION_HOST=native\\nH2A_RUN_LAUNCH_TOKEN=leaked-tok\\n'
  exit 0
fi
if [ "$1" = "set-environment" ] && [ "$2" = "-gu" ]; then
  printf '%s\\n' "$3" >> ${JSON.stringify(scrubbedLog)}
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );
  const storeRoot = mkdtempSync(join(SCRATCH, "doc-store-"));
  const stateDir = mkdtempSync(join(SCRATCH, "doc-state-"));
  const prevPath = process.env.PATH;
  const prevXdg = process.env.XDG_STATE_HOME;
  process.env.PATH = `${fakeTmuxBin}:${prevPath ?? ""}`;
  process.env.XDG_STATE_HOME = stateDir;
  delete globalThis[SYMBOL_CTX];
  try {
    const docStreams = captureStreams(storeRoot);
    await runCli(
      ["doctor", "--root", storeRoot, "--skip-hosts", "--repair"],
      docStreams,
      { doctorHostInstallations: () => ({ ok: true, hosts: [] }) },
    );
    const out = JSON.parse(docStreams.stdoutText);
    assert.deepEqual(out.checks.tmuxGlobalIdentityEnv.purgedKeys, [
      "H2A_SESSION_REF",
      "H2A_RUN_LAUNCH_TOKEN",
    ]);
    assert.match(
      docStreams.stderrText,
      /purged tmux global identity key\(s\): H2A_SESSION_REF, H2A_RUN_LAUNCH_TOKEN/,
    );
    const lines = readFileSync(scrubbedLog, "utf8").trim().split("\n");
    assert.deepEqual(lines, ["H2A_SESSION_REF", "H2A_RUN_LAUNCH_TOKEN"]);
    assert.equal(lines.includes("H2A_SESSION_HOST"), false);
  } finally {
    process.env.PATH = prevPath;
    if (prevXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prevXdg;
  }
});

test("CI hardening regressions: optional native identity, h2a_run allowedVerb, and non-root host-qualification forgery rejection", () => {
  // 1. Direct/test native-host callers omitting metadata.identity fall back to none-shell without TypeError.
  const omitted = prepareSessionIdentityLaunch(undefined);
  assert.deepEqual(omitted, { kind: "none-shell", sessionClass: "human" });

  // 2. prepareH2aRunAuth issues daemon receipt with allowedVerb "run" even though argv[0] is bin.js.
  const baseDir = mkdtempSync(join(SCRATCH, "h2a-run-auth-"));
  const wsDir = join(DURABLE_ROOT, `ws-${randomBytes(4).toString("hex")}`);
  mkdirSync(wsDir, { recursive: true, mode: 0o700 });
  const rtDir = join(baseDir, "runtime");
  mkdirSync(rtDir, { recursive: true, mode: 0o700 });
  const req = validateH2aRunRequest(
    {
      profile: "claude",
      name: "auth-verb-check",
      workspace: wsDir,
      prompt: "say hi",
      background: true,
    },
    wsDir,
  );
  const inv = buildH2aRunInvocation(req, H2A_BIN);
  assert.equal(inv.args[0], H2A_BIN);
  const auth = prepareH2aRunAuth(
    req,
    { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: baseDir },
    inv,
    false,
    rtDir,
  );
  try {
    const launchId = auth.env["H2A_RUN_LAUNCH_ID"];
    assert.ok(launchId, "expected H2A_RUN_LAUNCH_ID");
    const receiptPath = join(rtDir, "daemon-launches", `${launchId}.json`);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.allowedVerb, "run");
    const consumed = consumeDaemonLaunchReceipt(
      rtDir,
      {
        launchId,
        launchToken: auth.launchToken,
        verb: "run",
        ancestorPids: [{ pid: receipt.daemonPid, startTime: receipt.daemonStartTime }],
        expectedUid: process.getuid?.() ?? 1000,
      },
    );
    assert.equal(consumed.ok, true);
  } finally {
    auth.cleanup();
  }

  // 3. Forged UID != 0 / non-/run/h2a-qualification H2A_HOST_QUALIFICATION_RESERVATION cannot bypass owner-only-command.
  const forgedPath = join(baseDir, "forged-qual.json");
  writeFileSync(
    forgedPath,
    JSON.stringify({ version: 1, stageRoot: baseDir, runnerUid: process.getuid?.() ?? 1000 }),
  );
  const res = verifyCallerIdentity({
    argv: ["run", "claude", "--root", join(baseDir, "store")],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: baseDir,
      H2A_ROOT: join(baseDir, "store"),
      H2A_HOST_QUALIFICATION_RESERVATION: forgedPath,
    },
    cwd: wsDir,
    pid: 9999,
    uid: process.getuid?.() ?? 1000,
    platform: "linux",
    stdinIsTTY: false,
    stdoutIsTTY: false,
    procRoot: "/nonexistent-proc",
    stderr: () => {},
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reasonCode, "owner-only-command");
  }
  const forgedStageRt = join(baseDir, "runtime", "h2a");
  mkdirSync(forgedStageRt, { recursive: true, mode: 0o700 });
  assert.equal(
    readValidHostQualificationReservation(
      { H2A_HOST_QUALIFICATION_RESERVATION: forgedPath },
      { platform: "linux", uid: process.getuid?.() ?? 1000 },
    ),
    undefined,
  );
  try {
    const forgedRuntime = resolveSessionRuntimeDir({
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: baseDir,
        H2A_HOST_QUALIFICATION_RESERVATION: forgedPath,
      },
      uid: process.getuid?.() ?? 1000,
      platform: "linux",
      createIfMissing: false,
    });
    assert.notEqual(forgedRuntime.mode, "host-qualification");
    assert.notEqual(forgedRuntime.dir, forgedStageRt);
  } catch (err) {
    assert.equal(err?.name, "SessionRuntimeError");
  }

  // 4. sweepOrphanSessionFiches preserves live in-flight .tmp files (<60s old) and cleans stale ones.
  const sessDir = join(rtDir, "sessions");
  mkdirSync(sessDir, { recursive: true, mode: 0o700 });
  const liveTmp = join(sessDir, "active.json.12345.deadbeef0102.tmp");
  const staleTmp = join(sessDir, "abandoned.json.12345.deadbeef0103.tmp");
  writeFileSync(liveTmp, "{}", { mode: 0o600 });
  writeFileSync(staleTmp, "{}", { mode: 0o600 });
  const twoMinAgo = new Date(Date.now() - 120_000);
  utimesSync(staleTmp, twoMinAgo, twoMinAgo);
  sweepOrphanSessionFiches(rtDir);
  assert.equal(existsSync(liveTmp), true);
  assert.equal(existsSync(staleTmp), false);
});

