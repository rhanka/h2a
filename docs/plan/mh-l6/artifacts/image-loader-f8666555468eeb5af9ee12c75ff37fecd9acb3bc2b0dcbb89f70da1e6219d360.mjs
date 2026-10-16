// packages/h2a/src/runtime/upgrade/image-execution.js
import fs3 from "node:fs";
import cp from "node:child_process";
import threads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { createHash as createHash4 } from "node:crypto";
import { basename, dirname as dirname3, isAbsolute as isAbsolute2, join as join5, resolve as resolve4, sep as sep3 } from "node:path";
import { fileURLToPath as fileURLToPath2, pathToFileURL } from "node:url";

// packages/h2a/src/runtime/handover/state.js
import fs from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

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
import { realpathSync, statSync } from "node:fs";
import { join as join2 } from "node:path";
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

// packages/h2a/src/runtime/upgrade/image-policy.js
import fs2 from "node:fs";
import Module from "node:module";
import { dirname as dirname2, join as join4, relative as relative3, resolve as resolve3, sep as sep2 } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash as createHash3 } from "node:crypto";

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

// packages/h2a/src/runtime/upgrade/image-policy.js
function assertImageRuntime(manifest) {
  if (typeof Module.registerHooks !== "function" || process.platform !== "linux" || ![22, 24].includes(Number(process.versions.node.split(".")[0])) || !process.report.getReport().header.glibcVersionRuntime || manifest.profile.nodeMajor !== Number(process.versions.node.split(".")[0]) || manifest.profile.nodeAbi !== process.versions.modules || manifest.profile.arch !== process.arch || manifest.profile.libc !== "glibc") throw new Error("image_loader_unqualified");
}
function installImagePolicy(directory, manifest, manifestDigest) {
  const root = resolve3(directory);
  privateDirectory(root);
  if (fs2.realpathSync(root) !== root) throw new Error("image_root_invalid");
  const snapshot = structuredClone(manifest);
  assertImageRuntime(snapshot);
  verifyImage(root, snapshot, manifestDigest);
  const entries = new Map(snapshot.files.map((row) => [row.path, row]));
  const inside2 = (path) => path === root || path.startsWith(root + sep2);
  const fromUrl = (url) => {
    try {
      return url?.startsWith("file:") ? fileURLToPath(url) : null;
    } catch {
      return null;
    }
  };
  const inImage = (url) => {
    const path = fromUrl(url);
    return path !== null && inside2(path);
  };
  const fail = (reason) => {
    const error = new Error(reason);
    error.code = "ERR_IMAGE_MODULE";
    throw error;
  };
  const bytesFor = (requested) => {
    const path = fs2.realpathSync(requested);
    if (!inside2(path)) fail("image_external_module");
    const row = entries.get(relative3(root, path).split(sep2).join("/"));
    if (!row || row.type !== "file") fail("image_module_missing");
    const info = fs2.lstatSync(path);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 511) !== row.mode) fail("image_module_integrity");
    const fd = fs2.openSync(path, fs2.constants.O_RDONLY | fs2.constants.O_NOFOLLOW);
    try {
      const opened = fs2.fstatSync(fd);
      if (opened.dev !== info.dev || opened.ino !== info.ino || !opened.isFile() || opened.nlink !== 1 || (opened.mode & 511) !== row.mode) fail("image_module_integrity");
      const bytes = fs2.readFileSync(fd);
      if ("sha256:" + createHash3("sha256").update(bytes).digest("hex") !== row.digest) fail("image_module_integrity");
      return bytes;
    } finally {
      fs2.closeSync(fd);
    }
  };
  const metadataFor = (file) => {
    for (let cursor = dirname2(file); inside2(cursor); cursor = dirname2(cursor)) {
      const path = join4(cursor, "package.json"), key = relative3(root, path).split(sep2).join("/");
      if (entries.has(key)) bytesFor(path);
      else if (fs2.existsSync(path)) fail("image_module_integrity");
      if (cursor === root) break;
    }
  };
  const hooks = Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromImage = inImage(context.parentURL);
      if (fromImage) metadataFor(fromUrl(context.parentURL));
      let result;
      try {
        result = nextResolve(specifier, context);
      } catch (cause) {
        if (!fromImage) throw cause;
        throw Object.assign(new Error("image_dependency_missing", { cause }), { code: cause.code });
      }
      if (result.url.startsWith("node:")) return result;
      if (!inImage(result.url)) fail("image_external_module");
      const path = fromUrl(result.url);
      bytesFor(path);
      metadataFor(path);
      return result;
    },
    load(url, context, nextLoad) {
      if (url.startsWith("node:")) return nextLoad(url, context);
      if (!inImage(url)) fail("image_external_module");
      const path = fromUrl(url);
      metadataFor(path);
      const result = nextLoad(url, context), bytes = bytesFor(path);
      if (["module", "commonjs", "json"].includes(result.format)) return { ...result, source: bytes };
      return result;
    }
  });
  return Object.freeze({ root, manifestDigest, deregister() {
    hooks.deregister();
  } });
}

// packages/h2a/src/runtime/upgrade/image-execution.js
var contextKey = /* @__PURE__ */ Symbol.for("sentropic.h2a.image-context/v1");
var memory = /^--max-old-space-size=[0-9]+$/;
var inside = (root, path) => path === root || path.startsWith(root + sep3);
function imageExecutionContext() {
  return globalThis[contextKey];
}
function verifyImageLoader(path, managedRoot, expectedDigest) {
  privateDirectory(managedRoot);
  privateDirectory(join5(managedRoot, "bootstrap"));
  const name = basename(path), match = /^image-loader-([0-9a-f]{64})\.mjs$/.exec(name);
  if (!match || path !== join5(managedRoot, "bootstrap", name) || fs3.realpathSync(path) !== path) throw new Error("image_loader_location_invalid");
  const info = fs3.lstatSync(path);
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 511) !== 448) throw new Error("image_loader_integrity");
  const actual = "sha256:" + createHash4("sha256").update(fs3.readFileSync(path)).digest("hex");
  if (actual !== "sha256:" + match[1] || expectedDigest && actual !== expectedDigest) throw new Error("image_loader_integrity");
  return path;
}
function imageAt(managedRoot, file) {
  const path = file instanceof URL ? fileURLToPath2(file) : resolve4(file);
  const prefix = join5(managedRoot, "images") + sep3;
  if (!path.startsWith(prefix)) return void 0;
  const hash2 = path.slice(prefix.length).split(sep3)[0];
  if (!/^[0-9a-f]{64}$/.test(hash2)) throw new Error("image_root_invalid");
  const root = join5(managedRoot, "images", hash2);
  if (!inside(root, fs3.realpathSync(path))) throw new Error("image_external_module");
  return { root, manifestDigest: "sha256:" + hash2 };
}
function cleanEnv(env = process.env) {
  const result = { ...env };
  const options = (result.NODE_OPTIONS ?? "").trim().split(/\s+/).filter(Boolean);
  if (options.some((option) => !memory.test(option))) throw new Error("external_loader_unqualified");
  delete result.NODE_PATH;
  return result;
}
function installImageExecutionPolicy(root, manifest, manifestDigest, loader) {
  const managedRoot = dirname3(dirname3(root));
  verifyImageLoader(loader, managedRoot);
  const previous = imageExecutionContext();
  if (previous) {
    if (previous.root !== root || previous.manifestDigest !== manifestDigest || previous.loader !== loader) throw new Error("image_context_conflict");
    return previous;
  }
  const preload = (target2) => {
    verifyImageLoader(loader, managedRoot);
    const url = pathToFileURL(loader);
    url.searchParams.set("image", target2.root);
    return "--import=" + url.href;
  };
  const ownImport = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "file:" && fileURLToPath2(url) === loader;
    } catch {
      return false;
    }
  };
  const withoutOwnPreload = (values) => {
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const arg = values[i];
      if (arg === "--import" && ownImport(values[i + 1])) {
        i++;
        continue;
      }
      if (arg.startsWith("--import=") && ownImport(arg.slice(9))) continue;
      result.push(arg);
    }
    return result;
  };
  const flags = (values) => {
    const result = withoutOwnPreload(values);
    if (result.some((arg) => !memory.test(arg))) throw new Error("external_loader_unqualified");
    return result;
  };
  cleanEnv();
  delete process.env.NODE_PATH;
  flags(process.execArgv);
  installImagePolicy(root, manifest, manifestDigest);
  const context = Object.freeze({ root, manifestDigest, loader });
  Object.defineProperty(globalThis, contextKey, { value: context, configurable: false, writable: false });
  const currentNode = fs3.realpathSync(process.execPath);
  const qualifiedNode = (command, env) => {
    let path = command;
    if (!isAbsolute2(path)) {
      path = (env.PATH ?? "").split(":").map((dir) => join5(dir, command)).find((candidate) => {
        try {
          fs3.accessSync(candidate, fs3.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
    }
    if (!path || fs3.realpathSync(path) !== currentNode) throw new Error("image_child_runtime_unqualified");
  };
  const original = Object.fromEntries(["spawn", "spawnSync", "execFile", "execFileSync", "fork"].map((key) => [key, cp[key]]));
  const nodeArgs = (command, args, options = {}) => {
    const cwd = options.cwd ? options.cwd instanceof URL ? fileURLToPath2(options.cwd) : resolve4(options.cwd) : process.cwd();
    const candidates = args.map((arg, index) => ({ arg, index })).filter(({ arg }) => typeof arg === "string" && (isAbsolute2(arg) ? inside(join5(managedRoot, "images"), arg) : inside(join5(managedRoot, "images"), resolve4(cwd, arg))));
    if (!candidates.length) return { args, options };
    if (!["node", "nodejs"].includes(basename(command)) && command !== process.execPath) return { args, options };
    let first = -1;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--import") {
        index++;
        continue;
      }
      if (args[index] === "--") {
        first = index + 1;
        break;
      }
      if (!args[index].startsWith("-")) {
        first = index;
        break;
      }
    }
    const script = first === -1 ? void 0 : candidates.find((row) => row.index === first);
    if (!script || options.shell) throw new Error("image_child_entry_unqualified");
    const target2 = imageAt(managedRoot, resolve4(cwd, script.arg));
    const env = cleanEnv(options.env);
    qualifiedNode(command, env);
    const prefixFlags = args.slice(0, first).filter((arg) => arg !== "--");
    return { args: [...flags(prefixFlags), preload(target2), ...args.slice(first)], options: { ...options, env } };
  };
  for (const key of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
    cp[key] = function(command, args, options, callback) {
      if (!Array.isArray(args)) return original[key].apply(this, arguments);
      const planned = nodeArgs(command, args, typeof options === "object" && options !== null ? options : {});
      const tail = typeof options === "function" ? options : callback;
      return original[key].call(this, command, planned.args, planned.options, ...tail ? [tail] : []);
    };
  }
  cp.fork = function(file, args, options) {
    if (!Array.isArray(args)) {
      options = args ?? {};
      args = [];
    }
    options ??= {};
    const target2 = imageAt(managedRoot, file);
    if (!target2) {
      return original.fork.call(this, file, args, { ...options, execArgv: withoutOwnPreload(options.execArgv ?? process.execArgv) });
    }
    const env = cleanEnv(options.env);
    qualifiedNode(options.execPath ?? process.execPath, env);
    return original.fork.call(this, file, args, {
      ...options,
      env,
      execArgv: [...flags(options.execArgv ?? process.execArgv), preload(target2)]
    });
  };
  const OriginalWorker = threads.Worker;
  threads.Worker = class ImageWorker extends OriginalWorker {
    constructor(file, options = {}) {
      if (options.eval || file instanceof URL && file.protocol !== "file:") throw new Error("image_worker_entry_unqualified");
      const target2 = imageAt(managedRoot, file);
      if (!target2) throw new Error("image_worker_entry_unqualified");
      const env = options.env === threads.SHARE_ENV ? options.env : cleanEnv(options.env);
      const workerFlags = flags(options.execArgv ?? process.execArgv);
      const limit = workerFlags.at(-1)?.split("=")[1];
      const resourceLimits = { ...limit ? { maxOldGenerationSizeMb: Number(limit) } : {}, ...options.resourceLimits };
      super(file, { ...options, env, resourceLimits, execArgv: [preload(target2)] });
    }
  };
  syncBuiltinESMExports();
  return context;
}
function preloadImage(url) {
  const parsed = new URL(url), loader = fileURLToPath2(parsed), managedRoot = dirname3(dirname3(loader));
  verifyImageLoader(loader, managedRoot);
  const installation = readState(join5(managedRoot, "installation.json"), "installation")?.value;
  const physical = prefixLayout(dirname3(dirname3(managedRoot)), dirname3(dirname3(managedRoot)), process.getuid());
  if (!installation || ["prefixId", "canonicalPrefix", "uid", "managedRoot"].some((key) => installation[key] !== physical[key])) throw new Error("foreign_installation_authority");
  if ([...parsed.searchParams.keys()].join(",") !== "image") throw new Error("image_loader_context_invalid");
  const root = parsed.searchParams.get("image");
  if (!root || root !== resolve4(root)) throw new Error("image_root_invalid");
  const target2 = imageAt(managedRoot, root);
  if (!target2 || root !== target2.root) throw new Error("image_root_invalid");
  const manifest = JSON.parse(fs3.readFileSync(join5(root, "manifest.json"), "utf8"));
  installImageExecutionPolicy(root, manifest, target2.manifestDigest, loader);
}

// packages/h2a/src/runtime/upgrade/image-preloader.js
preloadImage(import.meta.url);
