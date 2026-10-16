#!/usr/bin/env node
// packages/h2a/src/runtime/upgrade/managed-launcher.js
import fs3 from "node:fs";
import { dirname as dirname3, join as join5 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// packages/h2a/src/runtime/handover/authority.js
import { realpathSync, statSync } from "node:fs";
import { join as join2 } from "node:path";

// packages/h2a/src/runtime/handover/wire.js
import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
function canonicalBytes(value) {
  const stack = /* @__PURE__ */ new Set();
  const string = (s) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const next = s.charCodeAt(++i);
        if (!(next >= 56320 && next <= 57343)) throw new Error("invalid_unicode");
      } else if (c >= 56320 && c <= 57343) throw new Error("invalid_unicode");
    }
    return JSON.stringify(s);
  };
  const emit = (v) => {
    if (v === null || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "string") return string(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== "object" || v === null || stack.has(v)) throw new Error("invalid_json");
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      throw new Error("invalid_json_object");
    }
    if (Reflect.ownKeys(v).some((key) => typeof key === "symbol")) throw new Error("invalid_json_key");
    stack.add(v);
    let result;
    if (Array.isArray(v)) {
      const values = [];
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) throw new Error("invalid_json_array");
        values.push(emit(v[i]));
      }
      result = `[${values.join(",")}]`;
    } else {
      result = `{${Object.keys(v).sort().map((key) => `${string(key)}:${emit(v[key])}`).join(",")}}`;
    }
    stack.delete(v);
    return result;
  };
  return Buffer.from(emit(value), "utf8");
}
function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalBytes(value)).digest("hex")}`;
}

// packages/h2a/src/runtime/handover/formats.js
import { isAbsolute, posix } from "node:path";

// packages/h2a/src/runtime/handover/schemas.js
var text = { type: "string", minLength: 1 };
var integer = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
var positive = { ...integer, minimum: 1 };
var hash = { ...text, pattern: "^sha256:[0-9a-f]{64}$" };
var uuid = { ...text, pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
var absolute = { ...text, format: "absolute-path" };
var relative = { ...text, format: "relative-path" };
var endpoint = { ...text, format: "endpoint" };
var boolean = { type: "boolean" };
var json = {};
var literal = (value) => ({ const: value });
var choice = (...values) => ({ enum: values });
var nullable = (schema) => ({ anyOf: [{ type: "null" }, schema] });
var list = (items) => ({ type: "array", items });
var record = (additionalProperties) => ({ type: "object", additionalProperties });
var object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});
var versioned = (properties) => object({ schemaVersion: literal(1), ...properties });
var identity = object({
  machineId: { ...text, pattern: "^(?!0+$)[0-9a-f]{32}$" },
  bootId: uuid,
  pidNamespace: { ...text, pattern: "^[0-9]+$" },
  nsNet: { ...text, pattern: "^[0-9]+$" },
  pid: positive,
  startTime: integer
});
var epoch = object({ bootId: uuid, counter: positive });
var capabilities = object({
  managedImage: boolean,
  endpointPinned: boolean,
  restrictions: list(text),
  primitives: list(text),
  attachTransfer: boolean,
  liveCoordinator: literal(false)
});
var image = { packageVersion: text, buildId: text, manifestDigest: hash };
var catalogue = { descriptorDigest: hash, contractDigest: hash };
var catalogueSource = object({ generation: nullable(uuid), buildId: text, profileId: text, ...catalogue });
var authority = { namespaceId: text, prefixId: hash, uid: integer };
var publication = { generation: uuid, publicationEpoch: epoch, processIdentity: identity };
var target = object({
  generation: uuid,
  publicationEpoch: epoch,
  endpoint,
  buildId: text,
  manifestDigest: hash,
  ...catalogue,
  catalogueRevision: positive
});
var authorization = object({
  upgradeId: text,
  handoverId: text,
  transactionEpoch: positive,
  controllerEpoch: positive,
  selectedManifestDigest: hash,
  delegatedControllerIdentity: identity,
  delegationReceiptDigest: hash
});
var mac = { ...text, pattern: "^[0-9a-f]{64}$" };
var mode = choice("cold-stop", "live-transfer", "catalogue");
var schemas = {
  catalogueSource,
  processIdentity: identity,
  generationEnd: versioned({ purpose: literal("generation-ended"), generation: uuid, source: json, markerDigest: hash, endedAt: integer, mac }),
  shimAcceptance: versioned({ sourceGeneration: uuid, sourceMarkerDigest: hash, receipt: json, mac }),
  delegationReceipt: versioned({
    upgradeId: text,
    controllerEpoch: positive,
    previousRevision: positive,
    delegatedControllerIdentity: identity,
    delegatedBuildId: text,
    targetManifestDigest: hash,
    ticketDigest: hash
  }),
  liveSourceAuthorization: versioned({
    purpose: literal("live-source-authorization"),
    source: json,
    targetPublication: json,
    target: object({ ...image, entrypoint: absolute }),
    authorization,
    inventoryRevision: positive,
    selectionEpoch: positive,
    issuedAt: integer,
    expiresAt: positive,
    ticketMac: mac,
    mac
  }),
  liveSourcePublication: versioned({
    purpose: literal("live-source-publication"),
    authorizationDigest: hash,
    markerDigest: hash,
    checkpointReferences: list(relative),
    mac
  }),
  participantRevision: versioned({ revision: positive }),
  launchLocation: versioned({ launchId: text, attachmentId: text, workspaceRoot: absolute, delegation: nullable(json) }),
  writerControl: versioned({
    revision: positive,
    root: absolute,
    stateDirectory: absolute,
    gate: choice("OPEN", "BARRIER", "CLOSED"),
    handoverId: nullable(text),
    restriction: choice("qualified", "legacy_writer_unfenced", "store_writer_set_unknown"),
    closureEvidenceDigest: nullable(hash)
  }),
  admittedOperation: versioned({
    revision: positive,
    operationId: text,
    attachmentId: text,
    ownerGeneration: uuid,
    executionOwner: identity,
    kind: choice("call", "child", "brief", "callback", "wake"),
    state: choice("pending", "unknown", "completed"),
    result: nullable(json)
  }),
  ownerEffect: versioned({ operationId: text, attachmentId: text, destination: literal("current-owner"), result: json }),
  wakeIntent: versioned({
    revision: positive,
    attachmentId: text,
    key: hash,
    envelopeIds: list(text),
    instructionLine: text,
    state: choice("intent", "unknown", "delivered", "deferred"),
    result: nullable(boolean)
  }),
  secret: versioned({ authorityBinding: hash, purpose: choice("lock", "authentication"), key: { ...text, pattern: "^[0-9a-f]{64}$" } }),
  epochs: versioned({ revision: positive, bootId: uuid, counter: integer }),
  pause: versioned({ revision: positive, paused: boolean, requestedAt: integer, generation: nullable(uuid) }),
  componentControl: versioned({
    revision: positive,
    activeTransaction: nullable(relative),
    sourceGeneration: uuid,
    ownerIdentity: identity,
    ownerState: choice("ACTIVE", "CLOSED"),
    transactionEpoch: integer,
    operatorStopCommitted: boolean,
    operatorStopped: boolean
  }),
  imagePin: versioned({ upgradeId: text, handoverId: text, sourceManifestDigest: hash, targetManifestDigest: hash }),
  installation: versioned({ prefixId: hash, canonicalPrefix: absolute, uid: integer, managedRoot: absolute }),
  precheckEvidence: versioned({
    targetBuildId: text,
    targetManifestDigest: hash,
    targetEntrypoint: absolute,
    selectionEpoch: positive,
    trialIdentity: identity,
    elapsedMs: integer,
    cleanupVerified: literal(true)
  }),
  emptyCheckpoint: versioned({
    generation: uuid,
    publicationEpoch: epoch,
    inventoryRevision: positive,
    drainRevision: positive,
    emptyAttachments: literal(true)
  }),
  startupReservation: versioned({
    revision: positive,
    starterIdentity: identity,
    candidateIdentity: nullable(identity),
    entrypoint: absolute,
    createdAt: integer,
    state: choice("RESERVED", "STARTING", "READY", "FAILED")
  }),
  namespace: versioned({
    ...authority,
    canonicalRoot: absolute,
    canonicalMarkerLocation: absolute,
    stateDirectory: absolute,
    machineIdentity: identity.properties.machineId,
    authorityDomainReference: relative
  }),
  authorityDomain: versioned({
    ...authority,
    canonicalMarkerLocation: absolute,
    canonicalRoot: absolute,
    processFrame: object({
      machineId: identity.properties.machineId,
      bootId: uuid,
      pidNamespace: identity.properties.pidNamespace,
      nsNet: identity.properties.nsNet
    }),
    lockSecretReference: relative,
    revision: positive
  }),
  marker: object({
    schemaVersion: literal(2),
    service: literal("h2a-mcp-central"),
    ...authority,
    stateDirectory: absolute,
    endpoint,
    endpointMode: choice("discovered", "fixed"),
    ...publication,
    predecessorGeneration: nullable(uuid),
    root: absolute,
    pid: positive,
    startedAt: text,
    ...image,
    protocol: literal(2),
    handoverProtocol: literal(1),
    handoverCapabilities: capabilities,
    mcpProtocolVersions: list(text),
    ...catalogue,
    state: literal("ready"),
    token: text,
    authKeyReference: relative
  }),
  readiness: versioned({
    clientNonce: text,
    serverNonce: text,
    connectionNonce: text,
    service: literal("h2a-mcp-central"),
    namespaceId: text,
    ...publication,
    endpoint,
    endpointMode: choice("discovered", "fixed"),
    root: absolute,
    uid: integer,
    state: literal("ready"),
    ...image,
    mcpProtocolVersions: list(text),
    ...catalogue,
    capabilities,
    challengeValidityMs: positive,
    mac
  }),
  request: versioned({
    generation: uuid,
    publicationEpoch: epoch,
    method: text,
    authority: text,
    path: text,
    bodyDigest: hash,
    requestUid: text,
    requestNonce: text,
    serverNonce: text,
    connectionNonce: text,
    attachmentId: nullable(text),
    transportEpoch: nullable(positive),
    mac
  }),
  frame: versioned({
    generation: uuid,
    attachmentId: text,
    transportEpoch: positive,
    channel: text,
    sequence: positive,
    payloadDigest: hash,
    requestUid: nullable(text),
    mac
  }),
  administration: object({
    protocolVersion: literal(1),
    mode,
    upgradeId: text,
    handoverId: text,
    transactionEpoch: positive,
    expectedGeneration: uuid,
    expectedPublicationEpoch: epoch,
    inventoryRevision: positive,
    stepId: text,
    payloadDigest: hash
  }),
  resume: versioned({
    attachmentId: text,
    expectedGeneration: uuid,
    expectedTransportEpoch: positive,
    resumeAttemptId: text,
    expectedInstance: text,
    lastAcceptedNotificationSequence: integer
  }),
  compatibilityEvidence: versioned({
    proofId: text,
    mode: choice("catalogue", "handover"),
    namespaceId: text,
    root: absolute,
    uid: integer,
    attester: object({ ...publication, buildId: text }),
    verifier: object({
      algorithmVersion: text,
      buildId: text,
      reportDigest: hash,
      verdict: literal("additive-compatible")
    }),
    authorization,
    source: catalogueSource,
    target,
    attachmentId: text,
    inventoryRevision: positive,
    issuedAt: integer,
    expiresAt: positive,
    challengeNonce: text,
    mac
  }),
  inventory: versioned({
    revision: positive,
    shims: list(object({
      attachmentId: text,
      shimVersion: text,
      shimBuildId: text,
      shimProcessIdentity: identity,
      attachmentProtocol: literal(1),
      handoverProtocol: literal(1),
      downstreamProtocolVersion: text,
      servedDescriptorDigest: hash,
      servedContractDigest: hash,
      supportedCheckpointVersions: list(positive),
      capabilities: object({
        listChanged: boolean,
        attachTransfer: boolean,
        admissionProof: boolean,
        transportResume: boolean
      }),
      clientQualification: json
    })),
    transports: list(json),
    operations: list(json),
    quarantines: list(text),
    launches: list(text),
    endpointPinned: boolean,
    writerRestrictions: list(text),
    managedImage: boolean
  }),
  ownership: versioned({
    attachmentId: text,
    ownerGeneration: uuid,
    ownershipEpoch: positive,
    ownerProcessIdentity: identity,
    state: choice("ACTIVE", "FROZEN", "TRANSFERRING", "CLOSED"),
    handoverId: nullable(text),
    checkpointVersion: positive,
    checkpointHash: nullable(hash),
    presenceSessionId: text,
    expectedInstance: text
  }),
  checkpoint: versioned({
    attachmentId: text,
    ownershipEpoch: positive,
    context: json,
    identity: json,
    presence: json,
    downstreamProtocol: text,
    servedCatalogue: json,
    subscriptions: list(json),
    observedPeers: json,
    observedInbox: json,
    notifications: json,
    negotiations: json,
    truncation: json,
    blockages: json,
    producedSequence: integer,
    deliveredSequence: integer,
    wakeState: json,
    terminalReferences: list(json),
    delegationReferences: list(json),
    launches: list(json)
  }),
  launchMemo: versioned({
    attachmentId: text,
    launchName: text,
    launchId: text,
    initialArgumentsDigest: hash,
    state: choice("reserved", "launching", "completed", "unknown"),
    executionOwner: identity,
    childProcessIdentity: nullable(identity),
    launchReceiptReference: relative,
    launchTokenBinding: hash,
    briefReceipt: nullable(json),
    terminalResult: nullable(json),
    retrySafe: boolean
  }),
  componentTransaction: versioned({
    revision: positive,
    component: choice("mcp", "gateway"),
    upgradeId: text,
    handoverId: text,
    transactionEpoch: positive,
    mode,
    source: object({ ...publication, ...image }),
    target: object({ ...image, entrypoint: absolute }),
    coordinator: identity,
    controllerEpoch: positive,
    inventoryRevision: positive,
    state: choice(
      "RESERVED",
      "PRECHECKED",
      "BARRIER",
      "FROZEN",
      "PUBLISHED",
      "DRAINING",
      "RETIRED",
      "STOP_COMMITTED",
      "STOPPED",
      "STARTING",
      "READY",
      "SUCCESSOR_FAILED",
      "ABORTED",
      "DRAIN_BLOCKED",
      "DEFERRED_PAUSED",
      "RECOVERY_BLOCKED"
    ),
    barrierDeadline: nullable(integer),
    precheckEvidenceDigest: nullable(hash),
    checkpointReferences: list(relative),
    stepResults: record(object({ payloadDigest: hash, result: json })),
    successorReservation: nullable(object({
      attempts: { ...integer, maximum: 3 },
      candidateIdentity: nullable(identity),
      selectionEpoch: positive,
      targetManifestDigest: hash
    }))
  }),
  selection: versioned({
    prefixId: hash,
    canonicalPrefix: absolute,
    uid: integer,
    selectionEpoch: positive,
    ...image,
    entrypoint: relative,
    previousSelectionReference: nullable(relative),
    upgradeId: text
  }),
  upgradeTransaction: versioned({
    upgradeId: text,
    revision: positive,
    prefixId: hash,
    canonicalPrefix: absolute,
    uid: integer,
    requestedTarget: text,
    resolvedTarget: text,
    artifactDigests: record(hash),
    targetManifestDigest: hash,
    origin: choice("manual", "automatic", "bootstrap", "compensation"),
    initiatorIdentity: identity,
    controllerIdentity: identity,
    controllerBuildId: text,
    controllerEpoch: positive,
    controllerAuthorityState: choice("ACTIVE", "REVOKED", "ACQUIRING"),
    delegationState: choice("NONE", "DELEGATING", "DELEGATED"),
    delegatedBuildId: nullable(text),
    delegationReceiptDigest: nullable(hash),
    privateTicketReference: nullable(relative),
    installationState: choice(
      "PREPARING",
      "PREPARED",
      "SELECTING",
      "SELECTED",
      "DELEGATING",
      "ACTIVATING",
      "PARTIAL",
      "COMPLETED",
      "ABORTED",
      "RECOVERY_BLOCKED"
    ),
    selectionEpoch: positive,
    previousSelectionReference: nullable(relative),
    componentTransactions: record(relative),
    observations: json,
    verification: json,
    createdAt: integer,
    updatedAt: integer
  }),
  delegationTicket: versioned({
    upgradeId: text,
    controllerEpoch: positive,
    expectedRevision: positive,
    delegatedBuildId: text,
    targetManifestDigest: hash,
    delegatedControllerIdentity: identity,
    ticketNonce: text,
    expiresAt: positive
  }),
  manifest: versioned({
    packageVersion: text,
    buildId: text,
    profile: object({
      platform: literal("linux"),
      arch: choice("x64", "arm64"),
      libc: literal("glibc"),
      nodeMajor: choice(22, 24),
      nodeAbi: text
    }),
    entrypoints: record(relative),
    startupWaitBudgetMs: { ...integer, minimum: 1e4, maximum: 6e4 },
    maxAttachments: positive,
    files: list(object({
      path: relative,
      type: choice("file", "symlink", "directory"),
      mode: integer,
      digest: nullable(hash),
      target: nullable(relative)
    })),
    nativeArtifacts: list(object({
      path: relative,
      digest: hash,
      nodeAbi: text,
      arch: text,
      libc: literal("glibc"),
      toolchainDigest: hash,
      probePath: relative
    }))
  })
};
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
schemas.shimInventoryItem = schemas.inventory.properties.shims.items;
freeze(schemas);

// packages/h2a/src/runtime/handover/formats.js
function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.includes("\0") && !isAbsolute(value) && value.split("/").every((p) => p && p !== "." && p !== "..");
}
function numericEndpoint(value) {
  const u = new URL(value);
  if (u.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(u.hostname) || !u.port || u.username || u.password || u.search || u.hash || u.href !== value) {
    throw new Error("invalid_endpoint");
  }
  return value;
}
function check(schema, value, path) {
  const fail = () => {
    throw new Error(`invalid_format:${path}`);
  };
  if ("const" in schema && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.anyOf && !schema.anyOf.some((s) => {
    try {
      check(s, value, path);
      return true;
    } catch {
      return false;
    }
  })) fail();
  if (schema.type === "null" && value !== null) fail();
  if (schema.type === "boolean" && typeof value !== "boolean") fail();
  if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || schema.pattern && !new RegExp(schema.pattern).test(value)) fail();
    if (schema.format === "relative-path" && !safeRelative(value)) fail();
    if (schema.format === "absolute-path" && (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || posix.normalize(value) !== value)) fail();
    if (schema.format === "endpoint") numericEndpoint(value);
  }
  if (schema.type === "integer" && (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER))) fail();
  if (schema.type === "array") {
    if (!Array.isArray(value)) fail();
    value.forEach((v, i) => check(schema.items, v, `${path}/${i}`));
  }
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail();
    for (const key of Object.keys(value)) {
      const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : void 0;
      if (!child && schema.additionalProperties === false) fail();
      check(child ?? schema.additionalProperties ?? {}, value[key], `${path}/${key}`);
    }
  }
}
function validate(name, value) {
  if (!Object.hasOwn(schemas, name)) throw new Error("unknown_schema");
  canonicalBytes(value);
  check(schemas[name], value, name);
  if (name === "marker" && (value.pid !== value.processIdentity.pid || value.publicationEpoch.bootId !== value.processIdentity.bootId || value.handoverCapabilities.endpointPinned !== (value.endpointMode === "fixed"))) throw new Error("contradictory_marker");
  if (name === "compatibilityEvidence" && value.expiresAt <= value.issuedAt) throw new Error("invalid_evidence_interval");
  if (name === "upgradeTransaction" && (value.updatedAt < value.createdAt || value.delegationState === "DELEGATING" && value.controllerAuthorityState === "ACTIVE")) throw new Error("contradictory_delegation");
  return value;
}

// packages/h2a/src/runtime/handover/state.js
import fs from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
function privateDirectory(path, uid = process.getuid()) {
  const absolute2 = resolve(path);
  let part = parse(absolute2).root;
  for (const segment of absolute2.slice(part.length).split("/").filter(Boolean)) {
    part = join(part, segment);
    if (!fs.lstatSync(part).isDirectory()) throw new Error("private_directory_required");
  }
  const info = fs.lstatSync(absolute2);
  if (info.uid !== uid || (info.mode & 511) !== 448) throw new Error("private_directory_required");
  return info;
}
function privateFile(info, uid) {
  if (!info.isFile() || info.uid !== uid || (info.mode & 511) !== 384) {
    throw new Error("private_state_required");
  }
}
function readState(path, schema, uid = process.getuid()) {
  privateDirectory(dirname(path), uid);
  let info;
  try {
    info = fs.lstatSync(path);
  } catch (e) {
    if (e.code === "ENOENT") return void 0;
    throw e;
  }
  privateFile(info, uid);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    privateFile(opened, uid);
    if (opened.dev !== info.dev || opened.ino !== info.ino) throw new Error("state_compare_failed");
    const bytes = fs.readFileSync(fd, "utf8");
    const value = validate(schema, JSON.parse(bytes));
    if (`${canonicalBytes(value)}
` !== bytes) throw new Error("noncanonical_state");
    return { value, dev: opened.dev, ino: opened.ino, digest: digest(value) };
  } finally {
    fs.closeSync(fd);
  }
}

// packages/h2a/src/runtime/handover/authority.js
function prefixLayout(physicalPrefix, legacyPrefix, uid) {
  const canonicalPrefix = realpathSync(physicalPrefix);
  const actual = statSync(canonicalPrefix);
  const legacy = statSync(realpathSync(legacyPrefix));
  if (!actual.isDirectory() || actual.dev !== legacy.dev || actual.ino !== legacy.ino) {
    throw new Error("legacy_prefix_mismatch");
  }
  if (uid !== process.getuid() || actual.uid !== uid || actual.mode & 18) {
    throw new Error("prefix_owner_mismatch");
  }
  return {
    canonicalPrefix,
    uid,
    prefixId: digest({ canonicalPrefix, uid }),
    managedRoot: join2(canonicalPrefix, "h2a-managed", String(uid)),
    legacyLock: join2(canonicalPrefix, ".h2a-upgrade.lock")
  };
}

// packages/h2a/src/runtime/handover/selection.js
import fs2 from "node:fs";
import { dirname as dirname2, join as join4, resolve as resolve3, relative as relative3 } from "node:path";

// packages/h2a/src/runtime/handover/image.js
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync as realpathSync2 } from "node:fs";
import { join as join3, relative as relative2, resolve as resolve2, sep } from "node:path";
import { createHash as createHash2 } from "node:crypto";
var bytesHash = (bytes) => `sha256:${createHash2("sha256").update(bytes).digest("hex")}`;
function payload(root) {
  if (!lstatSync(root).isDirectory()) throw new Error("image_directory_required");
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join3(directory, name);
      const rel = relative2(root, path).split(sep).join("/");
      if (rel === "manifest.json") continue;
      const info = lstatSync(path);
      const mode2 = info.mode & 511;
      if (info.isSymbolicLink()) {
        const raw = readlinkSync(path);
        const resolved = resolve2(directory, raw);
        const target2 = relative2(root, resolved).split(sep).join("/");
        if (!safeRelative(target2)) throw new Error("image_link_outside");
        const final = relative2(root, realpathSync2(path)).split(sep).join("/");
        if (!safeRelative(final)) throw new Error("image_link_outside");
        files.push({ path: rel, type: "symlink", mode: mode2, digest: bytesHash(Buffer.from(raw)), target: target2 });
      } else if (info.isDirectory()) {
        files.push({ path: rel, type: "directory", mode: mode2, digest: null, target: null });
        walk(path);
      } else if (info.isFile()) {
        if (info.nlink !== 1) throw new Error("image_hardlink");
        files.push({ path: rel, type: "file", mode: mode2, digest: bytesHash(readFileSync(path)), target: null });
      } else throw new Error("image_special_file");
    }
  };
  walk(root);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function validateContents(manifest) {
  const entries = new Map(manifest.files.map((f) => [f.path, f]));
  if (entries.size !== manifest.files.length || entries.has("manifest.json")) throw new Error("invalid_manifest_entries");
  const expectedAbi = { 22: "127", 24: "137" }[manifest.profile.nodeMajor];
  if (manifest.profile.nodeAbi !== expectedAbi) throw new Error("native_profile_mismatch");
  for (const entry of Object.values(manifest.entrypoints)) {
    if (!entries.has(entry) || entries.get(entry).type !== "file") throw new Error("image_entrypoint_missing");
  }
  for (const native of manifest.nativeArtifacts) {
    if (native.nodeAbi !== manifest.profile.nodeAbi || native.arch !== manifest.profile.arch || native.libc !== manifest.profile.libc) throw new Error("native_profile_mismatch");
    const entry = entries.get(native.path);
    if (!entry || entry.type !== "file") throw new Error("native_artifact_missing");
    if (entry.digest !== native.digest) throw new Error("native_digest_mismatch");
    if (native.probePath !== "node_modules/node-pty" || !entries.has(`${native.probePath}/package.json`)) {
      throw new Error("native_probe_missing");
    }
  }
}
function verifyImage(root, manifest, expectedManifestDigest) {
  if (typeof expectedManifestDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(expectedManifestDigest)) {
    throw new Error("manifest_digest_required");
  }
  validate("manifest", manifest);
  validateContents(manifest);
  if (digest(manifest) !== expectedManifestDigest || digest(payload(root)) !== digest(manifest.files)) {
    throw new Error("payload_mismatch");
  }
  return { verified: true, manifestDigest: expectedManifestDigest };
}

// packages/h2a/src/runtime/handover/selection.js
function resolveSelectedEntry(installation) {
  if (installation.uid !== process.getuid() || fs2.realpathSync(installation.canonicalPrefix) !== installation.canonicalPrefix || installation.prefixId !== digest({ canonicalPrefix: installation.canonicalPrefix, uid: installation.uid })) throw new Error("foreign_installation_authority");
  let selection;
  try {
    selection = readState(join4(installation.managedRoot, "state", "selected-build.json"), "selection")?.value;
  } catch (cause) {
    throw new Error("selection_unreadable", { cause });
  }
  if (!selection) throw new Error("selection_unreadable");
  if (selection.prefixId !== installation.prefixId || selection.canonicalPrefix !== installation.canonicalPrefix || selection.uid !== installation.uid) throw new Error("foreign_installation_authority");
  const imageRoot = join4(installation.managedRoot, "images", selection.manifestDigest.slice(7));
  privateDirectory(imageRoot);
  const manifestPath = join4(imageRoot, "manifest.json");
  if (!fs2.lstatSync(manifestPath).isFile()) throw new Error("image_manifest_required");
  const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
  verifyImage(imageRoot, manifest, selection.manifestDigest);
  if (manifest.buildId !== selection.buildId || manifest.packageVersion !== selection.packageVersion || !Object.values(manifest.entrypoints).includes(selection.entrypoint) || manifest.profile.nodeMajor !== Number(process.versions.node.split(".")[0]) || manifest.profile.nodeAbi !== process.versions.modules || manifest.profile.arch !== process.arch || process.platform !== "linux") throw new Error("selection_profile_mismatch");
  return { selection, manifest, imageRoot, entrypoint: resolve3(imageRoot, selection.entrypoint) };
}

// packages/h2a/src/runtime/upgrade/managed-launcher.js
function installationAt(url) {
  const launcher = fs3.realpathSync(fileURLToPath(url)), root = dirname3(dirname3(launcher));
  if (join5(root, "launcher/h2a.mjs") !== launcher || dirname3(root).split("/").at(-1) !== "h2a-managed" || root.split("/").at(-1) !== String(process.getuid())) throw new Error("managed_launcher_location_invalid");
  privateDirectory(root);
  const installation = readState(join5(root, "installation.json"), "installation")?.value;
  if (!installation) throw new Error("installation_incomplete");
  const physical = prefixLayout(dirname3(dirname3(root)), dirname3(dirname3(root)), process.getuid());
  for (const key of ["canonicalPrefix", "prefixId", "uid", "managedRoot"]) {
    if (installation[key] !== physical[key]) throw new Error("foreign_installation_authority");
  }
  return { installation, launcher };
}
function loadingProfile() {
  if (process.platform !== "linux" || ![22, 24].includes(Number(process.versions.node.split(".")[0])) || !process.report.getReport().header.glibcVersionRuntime) throw new Error("authority_profile_unqualified");
  delete process.env.NODE_PATH;
  const options = [process.env.NODE_OPTIONS ?? "", ...process.execArgv].join(" ").trim();
  if (options && !/^(?:--max-old-space-size=[0-9]+\s*)+$/.test(options)) throw new Error("external_loader_unqualified");
}
function entryState(installation, launcher) {
  const path = join5(installation.canonicalPrefix, "bin/h2a");
  let externalInstallDetected = true;
  try {
    externalInstallDetected = fs3.realpathSync(path) !== launcher;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let pathShadowing = false;
  for (const directory of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const command = join5(directory, "h2a");
    try {
      fs3.accessSync(command, fs3.constants.X_OK);
      pathShadowing = fs3.realpathSync(command) !== launcher;
      break;
    } catch (e) {
      if (!["ENOENT", "EACCES", "ENOTDIR"].includes(e.code)) throw e;
    }
  }
  return { externalInstallDetected, pathShadowing };
}
function verifiedHistory(installation) {
  const state = join5(installation.managedRoot, "state"), history = join5(state, "selection-history");
  const candidates = [join5(state, "last-valid-selection.json")];
  for (const name of fs3.readdirSync(history).filter((n) => /^[1-9][0-9]*\.json$/.test(n)).sort((a, b) => Number.parseInt(b) - Number.parseInt(a))) {
    candidates.push(join5(history, name));
  }
  for (const path of candidates) {
    try {
      const selection = readState(path, "selection")?.value;
      if (!selection) continue;
      validate("selection", selection);
      if (["prefixId", "canonicalPrefix", "uid"].some((k) => selection[k] !== installation[k])) continue;
      const root = join5(installation.managedRoot, "images", selection.manifestDigest.slice(7));
      privateDirectory(root);
      const manifestPath = join5(root, "manifest.json");
      if (!fs3.lstatSync(manifestPath).isFile()) continue;
      const manifest = JSON.parse(fs3.readFileSync(manifestPath, "utf8"));
      verifyImage(root, manifest, selection.manifestDigest);
      if (manifest.buildId !== selection.buildId || manifest.packageVersion !== selection.packageVersion || !Object.values(manifest.entrypoints).includes(selection.entrypoint) || manifest.profile.nodeMajor !== Number(process.versions.node.split(".")[0]) || manifest.profile.nodeAbi !== process.versions.modules || manifest.profile.arch !== process.arch || process.platform !== "linux") continue;
      return selection;
    } catch {
    }
  }
  return null;
}
function transactionsAt(installation) {
  const directory = join5(installation.managedRoot, "state/upgrade/transactions");
  return fs3.readdirSync(directory).sort().map((name) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(name)) throw new Error("RECOVERY_BLOCKED:unknown_journal");
    const tx = readState(join5(directory, name), "upgradeTransaction")?.value;
    if (!tx || tx.upgradeId + ".json" !== name || ["prefixId", "canonicalPrefix", "uid"].some((k) => tx[k] !== installation[k])) throw new Error("foreign_installation_authority");
    return {
      upgradeId: tx.upgradeId,
      revision: tx.revision,
      phase: tx.installationState,
      selectionEpoch: tx.selectionEpoch,
      controllerEpoch: tx.controllerEpoch,
      controllerBuildId: tx.controllerBuildId,
      controllerAuthorityState: tx.controllerAuthorityState
    };
  });
}
async function launchManaged(url) {
  loadingProfile();
  const { installation, launcher } = installationAt(url), observation = entryState(installation, launcher);
  const args = process.argv.slice(2), status = args[0] === "upgrade" && args[1] === "status";
  let current, selectionError;
  try {
    current = resolveSelectedEntry(installation);
  } catch (error) {
    selectionError = error;
  }
  const transactions = transactionsAt(installation);
  if (status) {
    const selection = current?.selection ?? verifiedHistory(installation);
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      ok: true,
      installationLayout: "managed",
      ...observation,
      selectionState: current ? "verified" : "unreadable",
      selection: current?.selection ?? null,
      recoveryCandidate: current ? null : selection,
      mutationsAllowed: false,
      transactions
    }) + "\n");
    return;
  }
  if (selectionError) throw selectionError;
  if (observation.externalInstallDetected) throw new Error("external_install_detected");
  if (observation.pathShadowing) throw new Error("path_shadowing");
  if (transactions.some((tx) => tx.phase === "SELECTING")) throw new Error("selection_recovery_required");
  process.argv[1] = current.entrypoint;
  await import(pathToFileURL(current.entrypoint).href);
}
if (process.argv[1] && fs3.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await launchManaged(import.meta.url);
  } catch (error) {
    if (process.argv.includes("--json") || process.argv[2] === "upgrade") process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, reason: error.message }) + "\n");
    else process.stderr.write(`h2a: ${error.message}
`);
    process.exitCode = 1;
  }
}
export {
  launchManaged
};
