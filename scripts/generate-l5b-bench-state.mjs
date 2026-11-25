#!/usr/bin/env node
// Deterministic L5B benchmark state generator (Node only, zero Python).
// Generates the exact §6.2.a state shape from repo handover & store formats:
//   - root state (14,097 files):
//       6,977 operation-* (6,972 completed, 1 pending, 4 unknown)
//       6,978 effect-*
//          64 generation-end-*
//          70 ownership-*
//           4 launch-* (unknown)
//           4 launch-location-*
//   - archive/batch-20261123 (32,935 files):
//      15,771 operation-*
//      15,773 effect-*
//       1,391 generation-end-*
//     + archive/manifest.jsonl in canonical 32-item sub-lot format
//   - modes 0700 (dirs) / 0600 (files)
//   - synthetic workspace root (registry/, negotiations/, .h2a-schema.json, inbox/)
//   - deterministic fingerprint (counts by type + SHA-256 of sorted path & content lists)
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalBytes, digest, sign } from "../packages/h2a/dist/runtime/handover/wire.js";

export const L5B_EXPECTED_COUNTS = Object.freeze({
  rootState: Object.freeze({
    operationsTotal: 6977,
    operationsCompleted: 6972,
    operationsPending: 1,
    operationsUnknown: 4,
    effects: 6978,
    generationEnds: 64,
    ownerships: 70,
    launches: 4,
    launchesUnknown: 4,
    launchLocations: 4,
    otherFiles: 0,
    totalFiles: 14097,
  }),
  archive: Object.freeze({
    batchDir: "batch-20261123",
    operations: 15771,
    effects: 15773,
    generationEnds: 1391,
    totalFiles: 32935,
    manifestPresent: true,
  }),
  workspaceRoot: Object.freeze({
    hasSchema: true,
    hasRegistry: true,
    hasNegotiations: true,
    hasInbox: true,
    hasKeys: false,
  }),
});

const MIGRATION_COMMIT_BATCH_SIZE = 32;
const SYNTH_KEY = Buffer.alloc(32, 0x42);
const SYNTH_WORKSPACE_ABS = "/synthetic/h2a-workspace";
const SYNTH_STATE_ABS = "/synthetic/h2a-mcp-central";
const SYNTH_TIMESTAMP_ISO = "2026-11-23T00:00:00.000Z";

function deterministicHex(label) {
  return createHash("sha256").update(`h2a-l5b-synth-v1:${label}`).digest("hex");
}

function deterministicUuid(label) {
  const bytes = createHash("sha256").update(`h2a-l5b-uuid-v1:${label}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const SYNTH_NAMESPACE_ID = deterministicUuid("namespace-id");
const SYNTH_PREFIX_ID = `sha256:${deterministicHex("prefix-id")}`;
const SYNTH_OLD_GEN = deterministicUuid("old-generation");
const SYNTH_MANIFEST_GEN = deterministicUuid("manifest-generation");
const SYNTH_IDENTITY = Object.freeze({
  machineId: deterministicHex("machine-id").slice(0, 32),
  bootId: deterministicUuid("boot-id"),
  pidNamespace: "4026539991",
  nsNet: "4026539992",
  pid: 999999,
  startTime: 1000,
});

function assertSafeTargetDir(dirPath, label) {
  const resolved = resolve(dirPath);
  if (resolved === "/tmp" || resolved.startsWith("/tmp/")) {
    throw new Error(`generator: refusing ${label} under /tmp: ${resolved}`);
  }
  if (resolved.startsWith("/run/user/") || resolved.endsWith("/h2a-workspace")) {
    throw new Error(`generator: refusing live state path for ${label}: ${resolved}`);
  }
  return resolved;
}

function writeCanonicalStateFile(filePath, value) {
  const buf = Buffer.concat([canonicalBytes(value), Buffer.from("\n")]);
  writeFileSync(filePath, buf, { mode: 0o600 });
}

function writePrivateTextFile(filePath, text) {
  writeFileSync(filePath, text, { encoding: "utf8", mode: 0o600 });
}

function makeGenerationEndProof(genUuid, endedAt, idxLabel) {
  const sourceMarker = {
    schemaVersion: 2,
    service: "h2a-mcp-central",
    namespaceId: SYNTH_NAMESPACE_ID,
    prefixId: SYNTH_PREFIX_ID,
    uid: 1000,
    stateDirectory: SYNTH_STATE_ABS,
    endpoint: "http://127.0.0.1:43210/mcp",
    endpointMode: "discovered",
    generation: genUuid,
    publicationEpoch: {
      bootId: SYNTH_IDENTITY.bootId,
      counter: Math.max(1, endedAt - 1795299999999),
    },
    predecessorGeneration: null,
    root: SYNTH_WORKSPACE_ABS,
    pid: SYNTH_IDENTITY.pid,
    startedAt: SYNTH_TIMESTAMP_ISO,
    processIdentity: SYNTH_IDENTITY,
    packageVersion: "0.98.11",
    buildId: "synth-seed",
    manifestDigest: `sha256:${deterministicHex(`manifest-${idxLabel}`)}`,
    protocol: 2,
    handoverProtocol: 1,
    handoverCapabilities: {
      managedImage: false,
      endpointPinned: false,
      restrictions: [],
      primitives: [],
      attachTransfer: false,
      liveCoordinator: false,
    },
    mcpProtocolVersions: ["2025-06-18"],
    descriptorDigest: `sha256:${deterministicHex("descriptor")}`,
    contractDigest: `sha256:${deterministicHex("contract")}`,
    state: "ready",
    token: deterministicUuid(`token-${idxLabel}`),
    authKeyReference: "authentication-key.json",
  };
  const value = {
    schemaVersion: 1,
    purpose: "generation-ended",
    generation: genUuid,
    source: sourceMarker,
    markerDigest: digest(sourceMarker),
    endedAt,
  };
  return {
    ...value,
    mac: sign(
      SYNTH_KEY,
      "compatibility",
      {
        service: sourceMarker.service,
        namespaceId: sourceMarker.namespaceId,
        generation: genUuid,
      },
      value
    ),
  };
}

function cmpBytewise(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function safeSegment(id) {
  if (typeof id !== "string" || id.length === 0) return "_";
  const cleaned = id.replace(/[:/\\<>"|?*]+/g, "__");
  if (cleaned.length === 0 || /^\.+$/.test(cleaned)) return "_";
  return cleaned;
}

function enforcePrivateModes(dirPath) {
  const st = lstatSync(dirPath);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    chmodSync(dirPath, 0o700);
    for (const name of readdirSync(dirPath)) {
      enforcePrivateModes(join(dirPath, name));
    }
  } else if (st.isFile()) {
    chmodSync(dirPath, 0o600);
  }
}

export function generateL5bBenchState({ stateDir, rootDir, force = false }) {
  const targetState = assertSafeTargetDir(stateDir, "--state");
  const targetRoot = assertSafeTargetDir(rootDir, "--root");

  for (const dir of [targetState, targetRoot]) {
    if (existsSync(dir)) {
      const entries = readdirSync(dir);
      if (entries.length > 0) {
        if (!force) {
          throw new Error(`generator: target directory is not empty (pass --force to overwrite): ${dir}`);
        }
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  const prevUmask = process.umask(0o077);
  try {
    const archiveDir = join(targetState, "archive");
    const batchDir = join(archiveDir, L5B_EXPECTED_COUNTS.archive.batchDir);
    mkdirSync(batchDir, { recursive: true, mode: 0o700 });

    // 1. Root ownership-* (70 CLOSED files across distinct attachmentIds)
    for (let i = 0; i < L5B_EXPECTED_COUNTS.rootState.ownerships; i++) {
      let attachmentId;
      if (i < 65) attachmentId = `synth-att-${String(i).padStart(2, "0")}`;
      else if (i < 69) attachmentId = `synth-att-launch-${i - 65}`;
      else attachmentId = "synth-att-pending";
      const ownershipValue = {
        schemaVersion: 1,
        attachmentId,
        ownerGeneration: SYNTH_OLD_GEN,
        ownershipEpoch: 1,
        ownerProcessIdentity: SYNTH_IDENTITY,
        state: "CLOSED",
        handoverId: null,
        checkpointVersion: 1,
        checkpointHash: null,
        presenceSessionId: `pending:${attachmentId}`,
        expectedInstance: `claude:synth-ws-${String(i).padStart(2, "0")}:${deterministicHex(`inst-${i}`).slice(0, 12)}`,
      };
      writeCanonicalStateFile(
        join(targetState, `ownership-${digest(attachmentId).slice(7)}.json`),
        ownershipValue
      );
    }

    // 2. Root launch-* (4 unknown) + launch-location-* (4) + 4 unknown brief ops + 4 effects
    //    plus their 4 completed :child ops in archive/batch-20261123 for drain reconciliation.
    const archiveOps = [];
    const archiveEffects = [];
    const archiveGenEnds = [];

    for (let k = 0; k < L5B_EXPECTED_COUNTS.rootState.launches; k++) {
      const launchId = deterministicUuid(`launch-${k}`);
      const attachmentId = `synth-att-launch-${k}`;
      const launchName = `synth-launch-${k}`;

      writeCanonicalStateFile(
        join(targetState, `launch-location-${launchId}.json`),
        {
          schemaVersion: 1,
          launchId,
          attachmentId,
          workspaceRoot: SYNTH_WORKSPACE_ABS,
          delegation: null,
        }
      );

      writeCanonicalStateFile(
        join(targetState, `launch-${digest({ attachmentId, launchName }).slice(7)}.json`),
        {
          schemaVersion: 1,
          attachmentId,
          launchName,
          launchId,
          initialArgumentsDigest: digest({ name: launchName }),
          state: "unknown",
          executionOwner: SYNTH_IDENTITY,
          childProcessIdentity: null,
          launchReceiptReference: `.h2a/runs/${launchName}/launch.json`,
          launchTokenBinding: digest(`launch-secret-${k}`),
          briefReceipt: null,
          terminalResult: { state: "unknown", launchId, retrySafe: false },
          retrySafe: false,
        }
      );

      const briefOpId = `${launchId}:brief`;
      const briefResult = { delivered: false, launchId };
      writeCanonicalStateFile(
        join(targetState, `operation-${digest(briefOpId).slice(7)}.json`),
        {
          schemaVersion: 1,
          revision: 2,
          operationId: briefOpId,
          attachmentId,
          ownerGeneration: SYNTH_OLD_GEN,
          executionOwner: SYNTH_IDENTITY,
          kind: "brief",
          state: "unknown",
          result: briefResult,
        }
      );
      writeCanonicalStateFile(
        join(targetState, `effect-${digest({ operationId: briefOpId, result: briefResult }).slice(7)}.json`),
        {
          schemaVersion: 1,
          operationId: briefOpId,
          attachmentId,
          destination: "current-owner",
          result: briefResult,
        }
      );

      // Corresponding completed :child operation and effect in archive/batch-20261123
      const childOpId = `${launchId}:child`;
      const childResult = { state: "started", ok: true, launchId };
      const childOpFile = `operation-${digest(childOpId).slice(7)}.json`;
      const childEffFile = `effect-${digest({ operationId: childOpId, result: childResult }).slice(7)}.json`;
      writeCanonicalStateFile(join(batchDir, childOpFile), {
        schemaVersion: 1,
        revision: 2,
        operationId: childOpId,
        attachmentId,
        ownerGeneration: SYNTH_OLD_GEN,
        executionOwner: SYNTH_IDENTITY,
        kind: "child",
        state: "completed",
        result: childResult,
      });
      writeCanonicalStateFile(join(batchDir, childEffFile), {
        schemaVersion: 1,
        operationId: childOpId,
        attachmentId,
        destination: "current-owner",
        result: childResult,
      });
      archiveOps.push(childOpFile);
      archiveEffects.push(childEffFile);
    }

    // 3. Root pending operation (1 callback pending)
    const pendingOpId = "synth-pending-op-00000";
    writeCanonicalStateFile(
      join(targetState, `operation-${digest(pendingOpId).slice(7)}.json`),
      {
        schemaVersion: 1,
        revision: 1,
        operationId: pendingOpId,
        attachmentId: "synth-att-pending",
        ownerGeneration: SYNTH_OLD_GEN,
        executionOwner: SYNTH_IDENTITY,
        kind: "callback",
        state: "pending",
        result: null,
      }
    );

    // 4. Root completed operations (6,972) + effects (6,972 + 2 extra = 6,974; +4 brief = 6,978)
    for (let i = 0; i < L5B_EXPECTED_COUNTS.rootState.operationsCompleted; i++) {
      const opId = `synth-root-op-${String(i).padStart(5, "0")}`;
      const attachmentId = `synth-att-${String(i % 65).padStart(2, "0")}`;
      const result = { completed: true, idx: i };
      writeCanonicalStateFile(
        join(targetState, `operation-${digest(opId).slice(7)}.json`),
        {
          schemaVersion: 1,
          revision: 2,
          operationId: opId,
          attachmentId,
          ownerGeneration: SYNTH_OLD_GEN,
          executionOwner: SYNTH_IDENTITY,
          kind: "call",
          state: "completed",
          result,
        }
      );
      writeCanonicalStateFile(
        join(targetState, `effect-${digest({ operationId: opId, result }).slice(7)}.json`),
        {
          schemaVersion: 1,
          operationId: opId,
          attachmentId,
          destination: "current-owner",
          result,
        }
      );
      if (i < 2) {
        const extraResult = { completed: true, idx: i, extra: true };
        writeCanonicalStateFile(
          join(targetState, `effect-${digest({ operationId: opId, result: extraResult }).slice(7)}.json`),
          {
            schemaVersion: 1,
            operationId: opId,
            attachmentId,
            destination: "current-owner",
            result: extraResult,
          }
        );
      }
    }

    // 5. Root generation-end-* (64)
    for (let i = 0; i < L5B_EXPECTED_COUNTS.rootState.generationEnds; i++) {
      const genUuid = deterministicUuid(`root-gen-${i}`);
      const proof = makeGenerationEndProof(genUuid, 1795392000000 + i, `root-${i}`);
      writeCanonicalStateFile(join(targetState, `generation-end-${genUuid}.json`), proof);
    }

    // 6. Archive batch-20261123 remaining operations (15,771 - 4 = 15,767) & effects (15,773 - 4 = 15,769)
    const remainingArchOps = L5B_EXPECTED_COUNTS.archive.operations - L5B_EXPECTED_COUNTS.rootState.launches;
    const extraArchEffects = L5B_EXPECTED_COUNTS.archive.effects - L5B_EXPECTED_COUNTS.archive.operations;
    for (let i = 0; i < remainingArchOps; i++) {
      const opId = `synth-arch-op-${String(i).padStart(5, "0")}`;
      const attachmentId = `synth-att-${String(i % 65).padStart(2, "0")}`;
      const result = { completed: true, archIdx: i };
      const opFile = `operation-${digest(opId).slice(7)}.json`;
      const effFile = `effect-${digest({ operationId: opId, result }).slice(7)}.json`;
      writeCanonicalStateFile(join(batchDir, opFile), {
        schemaVersion: 1,
        revision: 2,
        operationId: opId,
        attachmentId,
        ownerGeneration: SYNTH_OLD_GEN,
        executionOwner: SYNTH_IDENTITY,
        kind: "call",
        state: "completed",
        result,
      });
      writeCanonicalStateFile(join(batchDir, effFile), {
        schemaVersion: 1,
        operationId: opId,
        attachmentId,
        destination: "current-owner",
        result,
      });
      archiveOps.push(opFile);
      archiveEffects.push(effFile);
      if (i < extraArchEffects) {
        const extraRes = { completed: true, archIdx: i, extra: true };
        const extraEffFile = `effect-${digest({ operationId: opId, result: extraRes }).slice(7)}.json`;
        writeCanonicalStateFile(join(batchDir, extraEffFile), {
          schemaVersion: 1,
          operationId: opId,
          attachmentId,
          destination: "current-owner",
          result: extraRes,
        });
        archiveEffects.push(extraEffFile);
      }
    }

    // 7. Archive generation-end-* (1,391)
    for (let i = 0; i < L5B_EXPECTED_COUNTS.archive.generationEnds; i++) {
      const genUuid = deterministicUuid(`arch-gen-${i}`);
      const proof = makeGenerationEndProof(genUuid, 1795300000000 + i, `arch-${i}`);
      writeCanonicalStateFile(join(batchDir, `generation-end-${genUuid}.json`), proof);
      archiveGenEnds.push(genUuid);
    }

    // 8. Archive manifest.jsonl in canonical 32-item sub-lot format (same as OperationLedger)
    const manifestItems = [
      ...archiveOps.map((name) => ({ family: "operations", value: name })),
      ...archiveEffects.map((name) => ({ family: "effects", value: name })),
      ...archiveGenEnds.map((gen) => ({ family: "generationEnds", value: gen })),
    ];
    const manifestChunks = [];
    for (let i = 0; i < manifestItems.length; i += MIGRATION_COMMIT_BATCH_SIZE) {
      const slice = manifestItems.slice(i, i + MIGRATION_COMMIT_BATCH_SIZE);
      const record = {
        archivedAt: SYNTH_TIMESTAMP_ISO,
        reason: "startup-migration",
        generation: SYNTH_MANIFEST_GEN,
        batchDir: L5B_EXPECTED_COUNTS.archive.batchDir,
        operations: [],
        effects: [],
        generationEnds: [],
        ownerships: [],
        launches: [],
        wakes: [],
        checkpoints: [],
      };
      for (const item of slice) {
        record[item.family].push(item.value);
      }
      manifestChunks.push(Buffer.concat([canonicalBytes(record), Buffer.from("\n")]));
    }
    writeFileSync(join(archiveDir, "manifest.jsonl"), Buffer.concat(manifestChunks), { mode: 0o600 });

    // 9. Synthetic workspace root: .h2a-schema.json, registry/, negotiations/, inbox/
    const registryDir = join(targetRoot, "registry");
    const negotiationsDir = join(targetRoot, "negotiations");
    const inboxDir = join(targetRoot, "inbox");
    mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
    mkdirSync(registryDir, { recursive: true, mode: 0o700 });
    mkdirSync(negotiationsDir, { recursive: true, mode: 0o700 });
    mkdirSync(inboxDir, { recursive: true, mode: 0o700 });

    const schemaPayload = {
      version: "1",
      createdAt: SYNTH_TIMESTAMP_ISO,
      createdBy: "@sentropic/h2a@0.98.11",
    };
    writePrivateTextFile(
      join(targetRoot, ".h2a-schema.json"),
      `${JSON.stringify(schemaPayload, null, 2)}\n`
    );

    const registrations = [];
    for (let i = 0; i < 5; i++) {
      const uuid12 = deterministicHex(`reg-agent-${i}`).slice(0, 12);
      const instance = `claude:synth-agent-${i}:${uuid12}`;
      registrations.push({
        id: instance,
        instance,
        roles: ["AGENTS"],
        scopes: ["scope:synth"],
        capabilities: ["negotiate"],
        endpoints: [{ kind: "local-files", uri: `file://${SYNTH_WORKSPACE_ABS}` }],
        publicKeys: [],
        acceptedPolicies: [],
        createdAt: SYNTH_TIMESTAMP_ISO,
      });
    }
    registrations.push({
      id: "conductor:synth-01",
      instance: "conductor:synth-01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:synth"],
      capabilities: ["negotiate"],
      endpoints: [{ kind: "local-files", uri: `file://${SYNTH_WORKSPACE_ABS}` }],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: SYNTH_TIMESTAMP_ISO,
    });
    writePrivateTextFile(
      join(registryDir, "instances.jsonl"),
      registrations.map((r) => JSON.stringify(r)).join("\n") + "\n"
    );

    const firstAgent = registrations[0].instance;
    const actorInboxDir = join(inboxDir, safeSegment(firstAgent.toLowerCase()));
    mkdirSync(actorInboxDir, { recursive: true, mode: 0o700 });
    const synthEnvelope = {
      protocol: "sentropic.h2a",
      version: "0.1",
      id: "env-synth-001",
      type: "event",
      actor: {
        instance: "conductor:synth-01",
        role: "CONDUCTOR",
        scope: "scope:synth",
      },
      target: {
        instance: firstAgent,
      },
      body: {
        kind: "message",
        text: "synthetic-inbox-fixture",
      },
      createdAt: SYNTH_TIMESTAMP_ISO,
    };
    writePrivateTextFile(
      join(actorInboxDir, "env-synth-001.json"),
      JSON.stringify(synthEnvelope, null, 2)
    );

    enforcePrivateModes(targetState);
    enforcePrivateModes(targetRoot);
  } finally {
    process.umask(prevUmask);
  }

  return computeStateFingerprint(targetState, targetRoot);
}

function walkTree(baseDir, prefix) {
  const entries = [];
  const visit = (dir, relBase) => {
    const names = readdirSync(dir).sort(cmpBytewise);
    for (const name of names) {
      const full = join(dir, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      const st = lstatSync(full);
      const mode = st.mode & 0o777;
      if (st.isDirectory()) {
        entries.push({ key: `${prefix}/${rel}/`, rel, kind: "dir", mode, full });
        visit(full, rel);
      } else if (st.isFile()) {
        entries.push({ key: `${prefix}/${rel}`, rel, kind: "file", mode, full, size: st.size });
      }
    }
  };
  const rootStat = lstatSync(baseDir);
  entries.push({ key: `${prefix}/`, rel: "", kind: "dir", mode: rootStat.mode & 0o777, full: baseDir });
  visit(baseDir, "");
  return entries;
}

export function computeStateFingerprint(stateDir, rootDir) {
  const resolvedState = resolve(stateDir);
  const resolvedRoot = rootDir ? resolve(rootDir) : null;

  const stateEntries = existsSync(resolvedState) ? walkTree(resolvedState, "state") : [];
  const rootEntries = resolvedRoot && existsSync(resolvedRoot) ? walkTree(resolvedRoot, "root") : [];
  const allEntries = [...stateEntries, ...rootEntries].sort((a, b) => cmpBytewise(a.key, b.key));

  const rootCounts = {
    operationsTotal: 0,
    operationsCompleted: 0,
    operationsPending: 0,
    operationsUnknown: 0,
    effects: 0,
    generationEnds: 0,
    ownerships: 0,
    launches: 0,
    launchesUnknown: 0,
    launchLocations: 0,
    otherFiles: 0,
    totalFiles: 0,
  };
  const archive = {
    batches: {},
    manifestPresent: false,
    manifestLines: 0,
    totalFiles: 0,
  };
  let modeViolations = 0;

  for (const entry of stateEntries) {
    if (entry.kind === "dir" && entry.mode !== 0o700) modeViolations++;
    if (entry.kind === "file" && entry.mode !== 0o600) modeViolations++;
    if (entry.kind !== "file") continue;

    const rel = entry.rel;
    if (!rel.includes("/")) {
      rootCounts.totalFiles++;
      if (rel.startsWith("operation-") && rel.endsWith(".json")) {
        rootCounts.operationsTotal++;
        try {
          const op = JSON.parse(readFileSync(entry.full, "utf8"));
          if (op.state === "completed") rootCounts.operationsCompleted++;
          else if (op.state === "pending") rootCounts.operationsPending++;
          else if (op.state === "unknown") rootCounts.operationsUnknown++;
        } catch { /* count only */ }
      } else if (rel.startsWith("effect-") && rel.endsWith(".json")) {
        rootCounts.effects++;
      } else if (rel.startsWith("generation-end-") && rel.endsWith(".json")) {
        rootCounts.generationEnds++;
      } else if (rel.startsWith("ownership-") && rel.endsWith(".json")) {
        rootCounts.ownerships++;
      } else if (rel.startsWith("launch-location-") && rel.endsWith(".json")) {
        rootCounts.launchLocations++;
      } else if (/^launch-[a-f0-9]+\.json$/.test(rel)) {
        rootCounts.launches++;
        try {
          const memo = JSON.parse(readFileSync(entry.full, "utf8"));
          if (memo.state === "unknown") rootCounts.launchesUnknown++;
        } catch { /* count only */ }
      } else {
        rootCounts.otherFiles++;
      }
      continue;
    }

    if (rel === "archive/manifest.jsonl") {
      archive.manifestPresent = true;
      const lines = readFileSync(entry.full, "utf8").split("\n").filter((l) => l.trim().length > 0);
      archive.manifestLines = lines.length;
      continue;
    }

    const m = /^archive\/(batch-[^/]+)\/([^/]+)$/.exec(rel);
    if (m) {
      const [, batchName, fileName] = m;
      if (!archive.batches[batchName]) {
        archive.batches[batchName] = { operations: 0, effects: 0, generationEnds: 0, otherFiles: 0, totalFiles: 0 };
      }
      const b = archive.batches[batchName];
      b.totalFiles++;
      archive.totalFiles++;
      if (fileName.startsWith("operation-") && fileName.endsWith(".json")) b.operations++;
      else if (fileName.startsWith("effect-") && fileName.endsWith(".json")) b.effects++;
      else if (fileName.startsWith("generation-end-") && fileName.endsWith(".json")) b.generationEnds++;
      else b.otherFiles++;
    }
  }

  for (const entry of rootEntries) {
    if (entry.kind === "dir" && entry.mode !== 0o700) modeViolations++;
    if (entry.kind === "file" && entry.mode !== 0o600) modeViolations++;
  }

  const workspaceRoot = {
    hasSchema: resolvedRoot ? existsSync(join(resolvedRoot, ".h2a-schema.json")) : false,
    hasRegistry: resolvedRoot ? existsSync(join(resolvedRoot, "registry")) : false,
    hasNegotiations: resolvedRoot ? existsSync(join(resolvedRoot, "negotiations")) : false,
    hasInbox: resolvedRoot ? existsSync(join(resolvedRoot, "inbox")) : false,
    hasKeys: resolvedRoot ? existsSync(join(resolvedRoot, "keys")) : false,
    files: rootEntries.filter((e) => e.kind === "file").length,
    dirs: rootEntries.filter((e) => e.kind === "dir").length,
  };

  const listHasher = createHash("sha256");
  const contentHasher = createHash("sha256");
  for (const entry of allEntries) {
    const modeOct = entry.mode.toString(8).padStart(4, "0");
    listHasher.update(`${entry.key}\n`);
    if (entry.kind === "file") {
      const fHash = createHash("sha256").update(readFileSync(entry.full)).digest("hex");
      contentHasher.update(`${entry.key}\t${modeOct}\t${fHash}\n`);
    } else {
      contentHasher.update(`${entry.key}\t${modeOct}\n`);
    }
  }

  const shapeMismatches = [];
  const expRoot = L5B_EXPECTED_COUNTS.rootState;
  for (const [k, v] of Object.entries(expRoot)) {
    if (rootCounts[k] !== v) shapeMismatches.push(`rootState.${k}: expected ${v}, got ${rootCounts[k]}`);
  }
  const expArch = L5B_EXPECTED_COUNTS.archive;
  const batch = archive.batches[expArch.batchDir];
  if (!batch) {
    shapeMismatches.push(`archive.${expArch.batchDir}: missing`);
  } else {
    if (batch.operations !== expArch.operations) shapeMismatches.push(`archive.operations: expected ${expArch.operations}, got ${batch.operations}`);
    if (batch.effects !== expArch.effects) shapeMismatches.push(`archive.effects: expected ${expArch.effects}, got ${batch.effects}`);
    if (batch.generationEnds !== expArch.generationEnds) shapeMismatches.push(`archive.generationEnds: expected ${expArch.generationEnds}, got ${batch.generationEnds}`);
    if (batch.totalFiles !== expArch.totalFiles) shapeMismatches.push(`archive.totalFiles: expected ${expArch.totalFiles}, got ${batch.totalFiles}`);
  }
  if (!archive.manifestPresent || archive.manifestLines <= 0) {
    shapeMismatches.push("archive.manifest.jsonl: missing or empty");
  }
  if (modeViolations !== 0) {
    shapeMismatches.push(`modes: ${modeViolations} entries not 0700/0600`);
  }
  const expWs = L5B_EXPECTED_COUNTS.workspaceRoot;
  if (resolvedRoot) {
    for (const k of ["hasSchema", "hasRegistry", "hasNegotiations", "hasInbox", "hasKeys"]) {
      if (workspaceRoot[k] !== expWs[k]) shapeMismatches.push(`workspaceRoot.${k}: expected ${expWs[k]}, got ${workspaceRoot[k]}`);
    }
  } else {
    shapeMismatches.push("workspaceRoot: not provided");
  }

  return {
    counts: {
      rootState: rootCounts,
      archive,
      workspaceRoot,
    },
    modes: {
      violations: modeViolations,
      enforced: modeViolations === 0,
    },
    entriesCount: allEntries.length,
    sortedListSha256: listHasher.digest("hex"),
    sortedContentSha256: contentHasher.digest("hex"),
    shapeMatchesL5b: shapeMismatches.length === 0,
    shapeMismatches,
  };
}

function parseCliArgs(argv) {
  const getOpt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : "";
  };
  const out = getOpt("--out");
  const stateDir = getOpt("--state") || (out ? join(out, "state") : "");
  const rootDir = getOpt("--root") || (out ? join(out, "root") : "");
  const force = argv.includes("--force");
  const fingerprintOnly = argv.includes("--fingerprint-only");
  const help = argv.includes("--help") || argv.includes("-h");
  return { stateDir, rootDir, force, fingerprintOnly, help };
}

function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: generate-l5b-bench-state.mjs (--out <dir> | --state <dir> --root <dir>) [--force] [--fingerprint-only]");
    process.exit(0);
  }
  if (!opts.stateDir || !opts.rootDir) {
    console.error("generate-l5b-bench-state: --out <dir> or both --state <dir> and --root <dir> are required");
    process.exit(2);
  }
  const fp = opts.fingerprintOnly
    ? computeStateFingerprint(opts.stateDir, opts.rootDir)
    : generateL5bBenchState({ stateDir: opts.stateDir, rootDir: opts.rootDir, force: opts.force });
  console.log(JSON.stringify(fp, null, 2));
  if (!fp.shapeMatchesL5b) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
