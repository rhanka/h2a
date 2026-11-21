import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  identitySelf,
  runCli
} from "../dist/index.js";
import { reclaimOrMintAsync } from "../dist/runtime/identity/bindings.js";
import { createIdentityController } from "../dist/runtime/mcp/identity-state.js";
import { fixtureIdentity, proofDeps } from "./helpers/identity-proof-fixture.mjs";

const QUALIFIED_FS_TYPES = new Set(["ef53", "58465342", "9123683e", "f2f52010"]);
const OTHER_BOOT_A = "00000000-0000-4000-8000-000000000001";
const OTHER_BOOT_B = "00000000-0000-4000-8000-000000000002";
const PREV_NS = "pid:[4026539999]";
const PREV_TIMENS = "time:[4026539999]";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-slot-possession-"));
  const fsType = (statfsSync(dir).type >>> 0).toString(16);
  assert.ok(
    QUALIFIED_FS_TYPES.has(fsType),
    `test root must sit on a recovery-qualified filesystem (statfs f_type=${fsType})`
  );
  const root = join(dir, "store");
  const identityDir = join(root, "identity");
  const commitsDir = join(identityDir, "commits");
  mkdirSync(commitsDir, { recursive: true });
  return { dir, root, identityDir, commitsDir, lock: join(identityDir, ".lock") };
}

function cleanup(x) {
  rmSync(x.dir, { recursive: true, force: true });
}

function otherBoot() {
  const self = identitySelf();
  return self.boot === OTHER_BOOT_A ? OTHER_BOOT_B : OTHER_BOOT_A;
}

function hexToken(n) {
  return n.toString(16).padStart(32, "0");
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function makeBindingSlot({
  host = "claude",
  providerSessionId = "sess-abandoned-01",
  workspaceId = "ws-abandoned",
  instance = "claude:abandoned:000000000001",
  agentUuid = "00000000-0000-4000-8000-000000000001",
  pred = "genesis",
  fenceEpoch = hexToken(0x1111),
  proof,
  holder
}) {
  const kh = sha256Hex(`${host}\0${providerSessionId}`).slice(0, 32);
  const row = {
    host,
    providerSessionId,
    instance,
    agentUuid,
    workspaceId,
    at: "2026-11-08T19:45:00.000Z"
  };
  const line = `${JSON.stringify(row)}\n`;
  const lineId = sha256Hex(line);
  const slotName = `${kh}.${pred}.json`;
  const slot = {
    version: 1,
    kh,
    pred,
    fenceEpoch,
    line,
    lineId,
    ...(proof !== undefined ? { proof } : {}),
    ...(holder !== undefined ? { holder } : {})
  };
  return { slotName, slot, row, lineId, kh };
}

function quarantineDirs(identityDir) {
  if (!existsSync(identityDir)) return [];
  return readdirSync(identityDir).filter((n) => n.startsWith(".stale-slot-aside-")).sort();
}

function streams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

async function waitForTerminalStatus(controller, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = controller.status();
    if (st.state === "identity_ready" || st.state === "identity_failed") return st;
    await new Promise((r) => setTimeout(r, 20));
  }
  return controller.status();
}

test("incident repro: abandoned previous-boot binding slot in shared .h2a is quarantined and two independent MCP sessions reach identity_ready", async () => {
  const x = freshStore();
  let c1, c2;
  try {
    const self = identitySelf();
    const prevBoot = otherBoot();
    const epoch = hexToken(0x7862);
    // Previous-boot lock + uncommitted binding slot whose key possession file is missing.
    writeFileSync(
      x.lock,
      JSON.stringify({
        recordVersion: 2,
        protocol: "identity-binding-fence-v1",
        platform: "linux",
        publication: "link",
        hostKind: self.hostKind,
        host: self.host,
        boot: prevBoot,
        ns: PREV_NS,
        timeNs: PREV_TIMENS,
        pid: 27359,
        start: "proc:1",
        token: epoch,
        fenceEpoch: epoch,
        at: Date.now() - 120_000
      })
    );
    const { slotName, slot } = makeBindingSlot({
      host: "claude",
      providerSessionId: "sess-matchid-prev",
      workspaceId: "ws-matchid",
      instance: "claude:matchid:prev00000001",
      agentUuid: "prev00000001-0000-4000-8000-000000000001",
      fenceEpoch: epoch,
      proof: {
        instance: "claude:matchid:prev00000001",
        publicKeySha256: "b".repeat(64),
        sources: [
          { file: "keys/claude-matchid-prev00000001.key.pem", dev: 1, ino: 1, size: 100, mtimeMs: 1, ctimeMs: 1, offset: 0, length: 100, sha256: "a".repeat(64) },
          { file: "keys/claude-matchid-prev00000001.pub.pem", dev: 1, ino: 2, size: 100, mtimeMs: 1, ctimeMs: 1, offset: 0, length: 100, sha256: "b".repeat(64) },
          { file: "registry/instances.jsonl", dev: 1, ino: 3, size: 100, mtimeMs: 1, ctimeMs: 1, offset: 0, length: 100, sha256: "c".repeat(64) }
        ]
      }
    });
    writeFileSync(join(x.commitsDir, slotName), JSON.stringify(slot));

    const matchidCwd = join(x.dir, "matchID");
    const conductorCwd = join(x.dir, "conductor");
    mkdirSync(matchidCwd, { recursive: true });
    mkdirSync(conductorCwd, { recursive: true });

    c1 = createIdentityController({
      request: { root: x.root, host: "claude", cwd: matchidCwd, providerEnv: { CLAUDE_CODE_SESSION_ID: "sess-matchid-prev" } },
      timeoutMs: 8000,
      activate: (id) => ({ ok: true, sessionId: `sess:${id.instance}` })
    });
    c1.start();
    const s1 = await waitForTerminalStatus(c1);

    c2 = createIdentityController({
      request: { root: x.root, host: "claude", cwd: conductorCwd, providerEnv: { CLAUDE_CODE_SESSION_ID: "sess-conductor-live" } },
      timeoutMs: 8000,
      activate: (id) => ({ ok: true, sessionId: `sess:${id.instance}` })
    });
    c2.start();
    const s2 = await waitForTerminalStatus(c2);

    assert.equal(s1.state, "identity_ready", `matchid expected identity_ready, got ${JSON.stringify(s1)}`);
    assert.equal(s2.state, "identity_ready", `conductor expected identity_ready, got ${JSON.stringify(s2)}`);

    // Slot was quarantined (never deleted), with a receipt.
    assert.equal(existsSync(join(x.commitsDir, slotName)), false);
    const aside = quarantineDirs(x.identityDir);
    assert.equal(aside.length, 1);
    const asidePath = join(x.identityDir, aside[0]);
    assert.equal(existsSync(join(asidePath, slotName)), true);
    assert.equal(existsSync(join(asidePath, "receipt.json")), true);
    const receipt = JSON.parse(readFileSync(join(asidePath, "receipt.json"), "utf8"));
    assert.equal(receipt.reason, "abandoned-slot-possession-proof-missing");
    assert.ok(Array.isArray(receipt.slots) && receipt.slots.some((s) => s.file === slotName));
  } finally {
    try { c1?.cancel("transport_closed"); } catch {}
    try { c2?.cancel("transport_closed"); } catch {}
    cleanup(x);
  }
});

test("same-boot dead-PID binding slot with missing proof is quarantined and reclaimOrMintAsync succeeds", async () => {
  const x = freshStore();
  try {
    const self = identitySelf();
    const deadChild = spawnSync(
      process.execPath,
      [
        "-e",
        "import('./dist/index.js').then(m => process.stdout.write(JSON.stringify(m.identitySelf())))"
      ],
      { cwd: join(import.meta.dirname, ".."), encoding: "utf8" }
    );
    assert.equal(deadChild.status, 0, deadChild.stderr);
    const deadSelf = JSON.parse(deadChild.stdout);

    const epoch = hexToken(0x2222);
    const { slotName, slot } = makeBindingSlot({
      host: "claude",
      providerSessionId: "sess-dead-pid",
      workspaceId: "ws-dead-pid",
      instance: "claude:deadpid:000000000002",
      agentUuid: "00000002-0000-4000-8000-000000000002",
      fenceEpoch: epoch,
      holder: {
        hostKind: self.hostKind,
        host: self.host,
        boot: self.boot,
        ns: deadSelf.ns,
        timeNs: deadSelf.timeNs,
        pid: deadSelf.pid,
        start: deadSelf.start
      }
    });
    writeFileSync(join(x.commitsDir, slotName), JSON.stringify(slot));

    const bound = await reclaimOrMintAsync(
      x.root,
      { host: "claude", providerSessionId: "sess-live-caller", workspaceId: "ws-live" },
      proofDeps(x.root, {
        verifyProof: () => false,
        mint: () => ({ instance: "claude:live:000000000003", agentUuid: "00000003-0000-4000-8000-000000000003" }),
        now: () => Date.now()
      })
    );
    assert.equal(bound.instance, "claude:live:000000000003");
    assert.equal(existsSync(join(x.commitsDir, slotName)), false);
    const aside = quarantineDirs(x.identityDir);
    assert.equal(aside.length, 1);
    assert.equal(existsSync(join(x.identityDir, aside[0], slotName)), true);
  } finally {
    cleanup(x);
  }
});

test("repaired valid slot is unlinked from identity/commits and recovers even if proof source inodes changed across boot", async () => {
  const x = freshStore();
  try {
    const inst = "claude:valid:000000000004";
    const agentUuid = "00000004-0000-4000-8000-000000000004";
    fixtureIdentity(x.root, inst, agentUuid);
    const { preparePossession } = await import("../dist/runtime/identity/possession.js");
    const freshReceipt = preparePossession(x.root, inst);
    assert.ok(freshReceipt);
    const driftedProof = {
      ...freshReceipt,
      sources: freshReceipt.sources.map((s) => ({ ...s, ino: s.ino === 0 ? 0 : s.ino + 999999 }))
    };
    const { slotName, slot } = makeBindingSlot({
      host: "claude",
      providerSessionId: "sess-valid-uncommitted",
      workspaceId: "ws-valid",
      instance: inst,
      agentUuid,
      fenceEpoch: hexToken(0x3333),
      proof: driftedProof
    });
    writeFileSync(join(x.commitsDir, slotName), JSON.stringify(slot));

    const reclaimed = await reclaimOrMintAsync(
      x.root,
      { host: "claude", providerSessionId: "sess-valid-uncommitted", workspaceId: "ws-valid" },
      proofDeps(x.root, {
        verifyProof: () => true,
        mint: () => ({ instance: "claude:wrong:999", agentUuid: "wrong-999" }),
        now: () => Date.now()
      })
    );
    assert.equal(reclaimed.instance, inst);
    assert.equal(reclaimed.action, "reclaim");
    // Repaired slot must be unlinked from identity/commits/ so it never lingers as a zombie slot.
    assert.equal(existsSync(join(x.commitsDir, slotName)), false);
    assert.equal(quarantineDirs(x.identityDir).length, 0);
  } finally {
    cleanup(x);
  }
});

test("concurrent registry/.lock contention during prepareBindingSlots is retried instead of failing with slot possession proof missing", async () => {
  const x = freshStore();
  try {
    const inst = "claude:race:000000000005";
    const agentUuid = "00000005-0000-4000-8000-000000000005";
    fixtureIdentity(x.root, inst, agentUuid);
    const { preparePossession } = await import("../dist/runtime/identity/possession.js");
    const receipt = preparePossession(x.root, inst);
    assert.ok(receipt);
    const { slotName, slot } = makeBindingSlot({
      host: "claude",
      providerSessionId: "sess-lock-race",
      workspaceId: "ws-race",
      instance: inst,
      agentUuid,
      fenceEpoch: hexToken(0x4444),
      proof: receipt
    });
    writeFileSync(join(x.commitsDir, slotName), JSON.stringify(slot));

    const registryLock = join(x.root, "registry", ".lock");
    const distUrl = new URL("../dist/index.js", import.meta.url).href;
    const { prepareBindingSlots } = await import("../dist/runtime/identity/binding-commit.js");
    const { Worker } = await import("node:worker_threads");
    const sab = new SharedArrayBuffer(8);
    const ctrl = new Int32Array(sab);
    const lockWorker = new Worker(
      `
      import { workerData } from "node:worker_threads";
      const { withLockSync } = await import(workerData.distUrl);
      const ctrl = new Int32Array(workerData.sab);
      withLockSync(workerData.registryLock, () => {
        Atomics.store(ctrl, 0, 1);
        Atomics.notify(ctrl, 0);
        Atomics.wait(ctrl, 1, 0, 400);
      }, { timeoutMs: 2000 });
      `,
      { eval: true, workerData: { sab, registryLock, distUrl } }
    );
    try {
      Atomics.wait(ctrl, 0, 0, 5000);
      assert.equal(Atomics.load(ctrl, 0), 1, "worker must hold registry/.lock");
      // Direct check: prepareBindingSlots must throw LockTimeoutError instead of swallowing it as receipt: undefined
      assert.throws(() => prepareBindingSlots(x.identityDir), { name: "LockTimeoutError" });
      // Release the worker shortly so reclaimOrMintAsync retries and succeeds
      setTimeout(() => {
        Atomics.store(ctrl, 1, 1);
        Atomics.notify(ctrl, 1);
      }, 60);
      const res = await reclaimOrMintAsync(
        x.root,
        { host: "claude", providerSessionId: "sess-lock-race", workspaceId: "ws-race" },
        proofDeps(x.root, {
          verifyProof: () => true,
          mint: () => ({ instance: "claude:wrong:000000000006", agentUuid: "00000006-0000-4000-8000-000000000006" }),
          now: () => Date.now()
        })
      );
      assert.equal(res.instance, inst);
      assert.equal(res.action, "reclaim");
    } finally {
      Atomics.store(ctrl, 1, 1);
      Atomics.notify(ctrl, 1);
      await lockWorker.terminate();
    }
  } finally {
    cleanup(x);
  }
});

test("live holder on a slot with missing possession proof fails closed (never weakens check) and is marked retryable: true with diagnostic", async () => {
  const x = freshStore();
  let controller;
  try {
    const self = identitySelf();
    const epoch = hexToken(0x5555);
    const { slotName, slot } = makeBindingSlot({
      host: "claude",
      providerSessionId: "sess-live-unprovable",
      workspaceId: "ws-live-unprovable",
      instance: "claude:liveunprovable:000000000007",
      agentUuid: "00000007-0000-4000-8000-000000000007",
      fenceEpoch: epoch,
      holder: {
        hostKind: self.hostKind,
        host: self.host,
        boot: self.boot,
        ns: self.ns,
        timeNs: self.timeNs,
        pid: process.pid,
        start: self.start
      }
    });
    const slotPath = join(x.commitsDir, slotName);
    writeFileSync(slotPath, JSON.stringify(slot));

    controller = createIdentityController({
      request: { root: x.root, host: "claude", cwd: x.dir, providerEnv: { CLAUDE_CODE_SESSION_ID: "sess-other-session" } },
      timeoutMs: 8000,
      retryMinIntervalMs: 10,
      activate: (id) => ({ ok: true, sessionId: `sess:${id.instance}` })
    });
    controller.start();

    const failed = await waitForTerminalStatus(controller);
    assert.equal(failed.state, "identity_failed");
    assert.equal(failed.cause, "identity_storage_failed");
    assert.match(failed.message, /slot possession proof missing/);
    assert.equal(failed.retryable, true);
    assert.equal(failed.diagnostic?.reasonCode, "slot-possession-proof-missing");
    // Integrity check was NOT weakened: slot is still in identity/commits/ and not quarantined or committed.
    assert.equal(existsSync(slotPath), true);
    assert.equal(quarantineDirs(x.identityDir).length, 0);

    // Once the live-holder slot is removed/completed, controller.retry() succeeds without manual /mcp reconnect.
    unlinkSync(slotPath);
    const retried = controller.retry();
    assert.equal(retried, true);
    const recovered = await waitForTerminalStatus(controller);
    assert.equal(recovered.state, "identity_ready");
  } finally {
    try { controller?.cancel("transport_closed"); } catch {}
    cleanup(x);
  }
});

test("h2a doctor detects abandoned binding slot and h2a doctor --repair quarantines it without deleting", async () => {
  const x = freshStore();
  try {
    const self = identitySelf();
    const prevBoot = otherBoot();
    assert.equal(await runCli(["init", "--root", x.root], streams(x.dir), {}), 0);
    const { slotName, slot } = makeBindingSlot({
      host: "claude",
      providerSessionId: "sess-doctor-abandoned",
      workspaceId: "ws-doctor",
      instance: "claude:doctor:000000000008",
      agentUuid: "00000008-0000-4000-8000-000000000008",
      fenceEpoch: hexToken(0x6666),
      holder: {
        hostKind: self.hostKind,
        host: self.host,
        boot: prevBoot,
        ns: PREV_NS,
        timeNs: PREV_TIMENS,
        pid: 4242,
        start: "proc:1"
      }
    });
    writeFileSync(join(x.commitsDir, slotName), JSON.stringify(slot));
    const doctorDeps = { doctorHostInstallations: () => ({ ok: true, hosts: [] }) };

    // 1. Plain doctor reports unhealthy identityBindingSlots
    const s1 = streams(x.dir);
    const code1 = await runCli(["doctor", "--root", x.root, "--skip-hosts"], s1, doctorDeps);
    assert.equal(code1, 2);
    const report1 = JSON.parse(s1.stdoutText);
    assert.equal(report1.ok, false);
    assert.equal(report1.checks?.identityBindingSlots?.ok, false);
    assert.equal(report1.checks?.identityBindingSlots?.count, 1);

    // 2. doctor --repair --dry-run does not mutate
    const s2 = streams(x.dir);
    const code2 = await runCli(["doctor", "--root", x.root, "--repair", "--dry-run", "--skip-hosts"], s2, doctorDeps);
    assert.equal(code2, 2);
    const report2 = JSON.parse(s2.stdoutText);
    assert.equal(report2.checks?.identityBindingSlots?.skipped, true);
    assert.equal(report2.checks?.identityBindingSlots?.dryRun, true);
    assert.equal(existsSync(join(x.commitsDir, slotName)), true);

    // 3. doctor --repair quarantines into .stale-slot-aside-* with receipt.json
    const s3 = streams(x.dir);
    const code3 = await runCli(["doctor", "--root", x.root, "--repair", "--skip-hosts"], s3, doctorDeps);
    assert.equal(code3, 0, `doctor --repair failed: ${s3.stdoutText} ${s3.stderrText}`);
    const report3 = JSON.parse(s3.stdoutText);
    assert.equal(report3.ok, true);
    assert.equal(report3.checks?.identityBindingSlots?.ok, true);
    assert.equal(report3.checks?.identityBindingSlots?.recovered, true);
    assert.equal(existsSync(join(x.commitsDir, slotName)), false);
    const aside = quarantineDirs(x.identityDir);
    assert.equal(aside.length, 1);
    assert.equal(existsSync(join(x.identityDir, aside[0], slotName)), true);
    assert.equal(existsSync(join(x.identityDir, aside[0], "receipt.json")), true);
  } finally {
    cleanup(x);
  }
});
