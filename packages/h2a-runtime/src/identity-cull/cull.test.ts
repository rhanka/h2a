import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  planLosslessRestoration,
  refuseCullExecution,
  runIdentityCullDryRun,
  verifyHeldDescriptorCas,
} from "./cull.js";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function row(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    host: "claude",
    providerSessionId: "conversation-a",
    workspaceId: "ws:fixture",
    instance: "claude:fixture:000000000001",
    agentUuid: "00000000-0000-4000-8000-000000000001",
    at: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

const completeEvidence = {
  life: { complete: true, noLife: true, twoObservationsAgree: true, resumeSafe: true },
  ownership: { complete: true, noOwnedWork: true },
  protectedSetComplete: true,
} as const;

const canonicalBindingWriterInventory = {
  complete: true,
  paths: [{
    id: "reclaimOrMint",
    writesBindings: true,
    requiresCanonicalFence: true,
    fenceProtocol: "identity-binding-fence-v1",
    fenceEpochRequired: true,
  }],
} as const;

function writeBindings(root: string, rows: readonly Record<string, string>[]): void {
  mkdirSync(join(root, "identity"), { recursive: true });
  writeFileSync(join(root, "identity", "bindings.jsonl"), rows.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

function makeRun(rows: readonly Record<string, string>[], evidence = completeEvidence) {
  const base = mkdtempSync(join(tmpdir(), "h2a-identity-cull-"));
  scratchRoots.push(base);
  const defRoot = join(base, "def");
  const pinRoot = join(base, "pin");
  writeBindings(defRoot, rows);
  const defBindingsPath = join(defRoot, "identity", "bindings.jsonl");
  const before = readFileSync(defBindingsPath);
  writeBindings(pinRoot, [
    row({ instance: "claude:h2a:e3c21fe83da3", agentUuid: "e3c21fe8-3da3-4cf3-a837-6fdbadda8d95" }),
    row({ instance: "claude:h2a:c18853e319ea", agentUuid: "c18853e3-19ea-410f-bba8-88f69d97d9b5", providerSessionId: "pin-conductor" }),
    row({ instance: "claude:h2a:87db03b72762", agentUuid: "87db03b7-2762-43fb-8977-8dd67f625c82", providerSessionId: "pin-architect" }),
  ]);
  const result = runIdentityCullDryRun({
    defRoot,
    pinRoot,
    outputDir: join(base, "packet"),
    ownerAllowlist: ["focus:local-human"],
    evidence,
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });
  const decisions = readFileSync(join(result.packetDir, "decisions.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { decision: string; gates: Record<string, { verdict: string; reason: string }> });
  return { base, defRoot, defBindingsPath, before, result, decisions };
}

describe("identity cull dry-run", () => {
  it("keeps all PIN actors, live DEF actors, and the owner/human control", () => {
    const { result, decisions } = makeRun([
      row({ instance: "claude:h2a:e3c21fe83da3", agentUuid: "e3c21fe8-3da3-4cf3-a837-6fdbadda8d95" }),
      row({ instance: "claude:h2a:c18853e319ea", agentUuid: "c18853e3-19ea-410f-bba8-88f69d97d9b5", providerSessionId: "def-pin-conductor" }),
      row({ instance: "claude:h2a:87db03b72762", agentUuid: "87db03b7-2762-43fb-8977-8dd67f625c82", providerSessionId: "def-pin-architect" }),
      row({ instance: "claude:h2a:16f6e26295a3", agentUuid: "16f6e262-95a3-4cf3-a837-6fdbadda8d95", providerSessionId: "conversation-live" }),
      row({ instance: "claude:h2a:c3d1621ed118", agentUuid: "c3d1621e-d118-4cf3-a837-6fdbadda8d95", providerSessionId: "conversation-live-cond" }),
      row({ instance: "claude:h2a:8b329a6c9c31", agentUuid: "8b329a6c-9c31-4cf3-a837-6fdbadda8d95", providerSessionId: "conversation-live-arch" }),
      row({ instance: "focus:local-human", agentUuid: "10000000-0000-4000-8000-000000000001", providerSessionId: "conversation-owner" }),
    ]);
    expect(result.cullSetSize).toBe(0);
    expect(decisions).toHaveLength(7);
    expect(decisions.every((decision) => decision.decision === "KEEP")).toBe(true);
    expect(decisions.every((decision) => decision.gates.P.reason === "P_PROTECTED_IDENTITY")).toBe(true);
  });

  it("keeps a quiet single-conversation identity when S_R is absent", () => {
    const { result, decisions } = makeRun([row()]);
    expect(result.cullSetSize).toBe(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.gates.L.verdict).toBe("PASS");
    expect(decisions[0]!.gates.O.verdict).toBe("PASS");
    expect(decisions[0]!.gates.P.verdict).toBe("PASS");
    expect(decisions[0]!.gates.C).toEqual({ verdict: "UNKNOWN", reason: "C_MIGRATION_MAP_MISSING" });
    expect(decisions[0]!.decision).toBe("KEEP");
  });

  it("keeps fallback rows and rows outside an unattested defect window", () => {
    const { decisions } = makeRun([
      row({ providerSessionId: "fallback:claude:ws:fixture" }),
      row({ providerSessionId: "conversation-outside", instance: "claude:fixture:000000000002", agentUuid: "00000000-0000-4000-8000-000000000002", at: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(decisions).toHaveLength(2);
    expect(decisions.every((decision) => decision.decision === "KEEP")).toBe(true);
    expect(decisions.every((decision) => decision.gates.C.reason === "C_MIGRATION_MAP_MISSING")).toBe(true);
  });

  it("does not merge concurrent same-name same-workspace conversations", () => {
    const { result, decisions } = makeRun([
      row({ providerSessionId: "conversation-one", instance: "claude:same-name:000000000001", agentUuid: "00000000-0000-4000-8000-000000000001" }),
      row({ providerSessionId: "conversation-two", instance: "claude:same-name:000000000002", agentUuid: "00000000-0000-4000-8000-000000000002" }),
    ]);
    expect(result.componentCount).toBe(2);
    expect(decisions.every((decision) => decision.decision === "KEEP")).toBe(true);
  });

  it("emits an empty cull set and full packet when no migration map exists", () => {
    const { result, defBindingsPath, before } = makeRun([row(), row({ providerSessionId: "conversation-two", instance: "claude:fixture:000000000002", agentUuid: "00000000-0000-4000-8000-000000000002" })]);
    expect(result.cullSetSize).toBe(0);
    expect(readFileSync(defBindingsPath)).toEqual(before);
    expect(readFileSync(join(result.packetDir, "would-cull.jsonl"), "utf8")).toBe("");
    for (const artifact of ["run-manifest.json", "coverage.json", "dependencies.json", "decisions.jsonl", "would-cull.jsonl", "keep.jsonl", "lookup-replay.json", "positive-controls.json", "summary.json", "member-hashes.json"]) {
      expect(() => readFileSync(join(result.packetDir, artifact))).not.toThrow();
    }
  });

  it("reports the fence primitive and executor handoff without claiming staging executed check-to-act", () => {
    const { result } = makeRun([row()]);
    const manifest = JSON.parse(readFileSync(join(result.packetDir, "run-manifest.json"), "utf8")) as {
      executionHardGated: boolean;
      fencePrimitiveProvided: boolean;
      checkActExecutedByStaging: boolean;
      "checkActIsExecutorScopePer_§7_1": boolean;
      handoffContract: { specReference: string; executorScope: string; transferRule: string };
      structuralWriterFence: { protocol: string; epochRequired: boolean; heldDescriptorCas: string };
    };
    expect(manifest).not.toHaveProperty("structuralWriterInvariant");
    expect(manifest.executionHardGated).toBe(true);
    expect(manifest.fencePrimitiveProvided).toBe(true);
    expect(manifest.checkActExecutedByStaging).toBe(false);
    expect(manifest["checkActIsExecutorScopePer_§7_1"]).toBe(true);
    expect(manifest.handoffContract).toMatchObject({ specReference: "SPEC #156 §7.1 and §8" });
    expect(manifest.handoffContract.executorScope).toContain("final held-descriptor compare through descriptor-relative rename and read-back");
    expect(manifest.handoffContract.transferRule).toContain("transmits the held fence and descriptor");
    expect(manifest.structuralWriterFence).toMatchObject({
      protocol: "identity-binding-fence-v1",
      epochRequired: true,
    });
    expect(manifest.structuralWriterFence.heldDescriptorCas).toContain("fstat+full-read+fstat");
  });

  it("refuses outputDir chain symlinks into DEF or PIN before any packet write", () => {
    const base = mkdtempSync(join(tmpdir(), "h2a-identity-cull-symlink-"));
    scratchRoots.push(base);
    const defRoot = join(base, "def");
    const pinRoot = join(base, "pin");
    const outsideRoot = join(base, "outside");
    writeBindings(defRoot, [row()]);
    writeBindings(pinRoot, [row({ providerSessionId: "pin" })]);
    mkdirSync(outsideRoot);
    for (const [name, target] of [["redirect-def", defRoot], ["redirect-pin", pinRoot]] as const) {
      symlinkSync(target, join(outsideRoot, name), "dir");
      expect(() => runIdentityCullDryRun({
        defRoot,
        pinRoot,
        outputDir: join(outsideRoot, name, "packet"),
        ownerAllowlist: ["focus:local-human"],
        evidence: completeEvidence,
      })).toThrow("packet output path refuses symlink component");
    }
    for (const protectedRoot of [defRoot, pinRoot]) {
      expect(() => runIdentityCullDryRun({
        defRoot,
        pinRoot,
        outputDir: join(protectedRoot, "packet-direct"),
        ownerAllowlist: ["focus:local-human"],
        evidence: completeEvidence,
      })).toThrow("packet output must be outside both DEF and PIN roots");
      expect(existsSync(join(protectedRoot, "packet-direct"))).toBe(false);
    }
    expect(existsSync(join(defRoot, "packet"))).toBe(false);
    expect(existsSync(join(pinRoot, "packet"))).toBe(false);
  });

  it("refuses a packet directory rename and symlink swap before any packet byte can land under DEF or PIN", () => {
    for (const protectedRootName of ["def", "pin"] as const) {
      const base = mkdtempSync(join(tmpdir(), "h2a-identity-cull-write-swap-"));
      scratchRoots.push(base);
      const defRoot = join(base, "def");
      const pinRoot = join(base, "pin");
      const packetDir = join(base, "packet");
      writeBindings(defRoot, [row()]);
      writeBindings(pinRoot, [row({ providerSessionId: "pin" })]);
      const protectedRoot = protectedRootName === "def" ? defRoot : pinRoot;
      const protectedBindings = join(protectedRoot, "identity", "bindings.jsonl");
      const before = readFileSync(protectedBindings);
      const movedPacket = join(protectedRoot, `moved-packet-${protectedRootName}`);
      let swapped = false;

      expect(() => runIdentityCullDryRun({
        defRoot,
        pinRoot,
        outputDir: packetDir,
        ownerAllowlist: ["focus:local-human"],
        evidence: completeEvidence,
        beforePacketWrite: (attempt) => {
          if (swapped || attempt.kind !== "file" || attempt.name !== "def-bindings.jsonl") return;
          swapped = true;
          renameSync(attempt.packetRoot, movedPacket);
          symlinkSync(protectedRoot, attempt.packetRoot, "dir");
        },
      })).toThrow("packet write containment lost");

      expect(swapped).toBe(true);
      expect(existsSync(join(movedPacket, "evidence", "def-bindings.jsonl"))).toBe(false);
      expect(readFileSync(protectedBindings)).toEqual(before);
    }
  });
});

describe("identity cull execution guard", () => {
  it("refuses execution without owner authorization, S_R, and a verified non-empty cull set", () => {
    const refusal = refuseCullExecution();
    expect(refusal.executed).toBe(false);
    expect(refusal.refusalCodes).toEqual(expect.arrayContaining([
      "OWNER_AUTHORIZATION_MISSING_OR_INVALID",
      "S_R_MISSING_OR_UNRATIFIED",
      "VERIFIED_NONEMPTY_CULL_SET_MISSING",
      "SINGLE_WRITER_INVARIANT_UNVERIFIED",
      "EXECUTION_DISABLED_PENDING_SEPARATE_OWNER_GO",
    ]));
  });

  it("detects an append on the held descriptor before the rename boundary and aborts", () => {
    const base = mkdtempSync(join(tmpdir(), "h2a-identity-cas-"));
    scratchRoots.push(base);
    const bindingPath = join(base, "bindings.jsonl");
    const initial = Buffer.from(`${JSON.stringify(row())}\n`);
    writeFileSync(bindingPath, initial);
    let renameCalled = false;
    let heldFence: unknown;
    const result = verifyHeldDescriptorCas({
      bindingPath,
      expectedSize: initial.length,
      expectedSha256: `sha256:${createHash("sha256").update(initial).digest("hex")}`,
      writerInventory: canonicalBindingWriterInventory,
      afterPreflight: () => {
        heldFence = JSON.parse(readFileSync(join(base, ".lock"), "utf8"));
        appendFileSync(bindingPath, `${JSON.stringify(row({ providerSessionId: "late" }))}\n`);
      },
      rename: () => { renameCalled = true; },
    });
    expect(result).toEqual({ state: "ABORTED", reason: "HELD_DESCRIPTOR_SIZE_MISMATCH" });
    expect(renameCalled).toBe(false);
    expect(heldFence).toMatchObject({ protocol: "identity-binding-fence-v1" });
    expect(existsSync(join(base, ".lock"))).toBe(false);
  });

  it("provides staging verification without executing a supplied rename callback", () => {
    const base = mkdtempSync(join(tmpdir(), "h2a-identity-cas-staging-"));
    scratchRoots.push(base);
    const bindingPath = join(base, "bindings.jsonl");
    const initial = Buffer.from(`${JSON.stringify(row())}\n`);
    writeFileSync(bindingPath, initial);
    let renameCalled = false;

    expect(verifyHeldDescriptorCas({
      bindingPath,
      expectedSize: initial.length,
      expectedSha256: `sha256:${createHash("sha256").update(initial).digest("hex")}`,
      writerInventory: canonicalBindingWriterInventory,
      rename: () => { renameCalled = true; },
    })).toEqual({ state: "STAGING_VERIFIED" });
    expect(renameCalled).toBe(false);
    expect(existsSync(join(base, ".lock"))).toBe(false);
  });

  it("aborts the held-descriptor CAS when a binding writer bypass is present", () => {
    const base = mkdtempSync(join(tmpdir(), "h2a-identity-cas-bypass-"));
    scratchRoots.push(base);
    const bindingPath = join(base, "bindings.jsonl");
    const initial = Buffer.from(`${JSON.stringify(row())}\n`);
    writeFileSync(bindingPath, initial);

    expect(verifyHeldDescriptorCas({
      bindingPath,
      expectedSize: initial.length,
      expectedSha256: `sha256:${createHash("sha256").update(initial).digest("hex")}`,
      writerInventory: {
        complete: true,
        paths: [
          ...canonicalBindingWriterInventory.paths,
          {
            id: "direct-append-bypass",
            writesBindings: true,
            requiresCanonicalFence: false,
            canBypassFence: true,
          },
        ],
      },
    })).toEqual({ state: "ABORTED", reason: "SINGLE_WRITER_PRECONDITION_FAILED" });
  });

  it("refuses lossless restoration when both append tails have no proven order", () => {
    const plan = planLosslessRestoration({
      original: Buffer.from(`${JSON.stringify(row())}\n`),
      nPre: Buffer.from(`${JSON.stringify(row({ providerSessionId: "pre" }))}\n`),
      nPost: Buffer.from(`${JSON.stringify(row({ providerSessionId: "post" }))}\n`),
      tailOrderProven: false,
    });
    expect(plan).toEqual({ state: "REFUSED", reason: "TAIL_ORDER_AMBIGUOUS" });
  });
});
