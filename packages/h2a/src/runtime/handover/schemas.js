// JSON Schema vocabulary: draft 2020-12 subset. All named records are closed.
export const text = { type: 'string', minLength: 1 };
export const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const positive = { ...integer, minimum: 1 };
export const hash = { ...text, pattern: '^sha256:[0-9a-f]{64}$' };
export const uuid = { ...text, pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
export const absolute = { ...text, format: 'absolute-path' };
export const relative = { ...text, format: 'relative-path' };
export const endpoint = { ...text, format: 'endpoint' };
export const boolean = { type: 'boolean' };
export const json = {};
export const literal = (value) => ({ const: value });
export const choice = (...values) => ({ enum: values });
export const nullable = (schema) => ({ anyOf: [{ type: 'null' }, schema] });
export const list = (items) => ({ type: 'array', items });
export const record = (additionalProperties) => ({ type: 'object', additionalProperties });
export const object = (properties) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
export const versioned = (properties) => object({ schemaVersion: literal(1), ...properties });
export const identity = object({ machineId: { ...text, pattern: '^(?!0+$)[0-9a-f]{32}$' },
  bootId: uuid, pidNamespace: { ...text, pattern: '^[0-9]+$' }, nsNet: { ...text, pattern: '^[0-9]+$' },
  pid: positive, startTime: integer });
export const epoch = object({ bootId: uuid, counter: positive });
const capabilities = object({ managedImage: boolean, endpointPinned: boolean, restrictions: list(text),
  primitives: list(text), attachTransfer: boolean, liveCoordinator: literal(false) });
const image = { packageVersion: text, buildId: text, manifestDigest: hash };
const catalogue = { descriptorDigest: hash, contractDigest: hash };
const authority = { namespaceId: text, prefixId: hash, uid: integer };
const publication = { generation: uuid, publicationEpoch: epoch, processIdentity: identity };
const target = object({ generation: uuid, publicationEpoch: epoch, endpoint,
  buildId: text, manifestDigest: hash, ...catalogue, catalogueRevision: positive });
const authorization = object({ upgradeId: text, handoverId: text, transactionEpoch: positive,
  controllerEpoch: positive, selectedManifestDigest: hash, delegatedControllerIdentity: identity,
  delegationReceiptDigest: hash });
const mac = { ...text, pattern: '^[0-9a-f]{64}$' };
const mode = choice('cold-stop', 'live-transfer', 'catalogue');
export const schemas = {
  secret: versioned({ authorityBinding: hash, purpose: choice('lock', 'authentication'), key: { ...text, pattern: '^[0-9a-f]{64}$' } }),
  epochs: versioned({ revision: positive, bootId: uuid, counter: integer }),
  pause: versioned({ revision: positive, paused: boolean, requestedAt: integer, generation: nullable(uuid) }),
  componentControl: versioned({ revision: positive, activeTransaction: nullable(relative),
    sourceGeneration: uuid, transactionEpoch: integer, operatorStopCommitted: boolean }),
  imagePin: versioned({ upgradeId: text, handoverId: text, sourceManifestDigest: hash, targetManifestDigest: hash }),
  installation: versioned({ prefixId: hash, canonicalPrefix: absolute, uid: integer, managedRoot: absolute }),
  precheckEvidence: versioned({ targetBuildId: text, targetManifestDigest: hash, targetEntrypoint: absolute,
    selectionEpoch: positive, trialIdentity: identity, elapsedMs: integer, cleanupVerified: literal(true) }),
  startupReservation: versioned({ revision: positive, starterIdentity: identity, candidateIdentity: nullable(identity),
    entrypoint: absolute, createdAt: integer, state: choice('RESERVED', 'STARTING', 'READY', 'FAILED') }),
  namespace: versioned({ ...authority, canonicalRoot: absolute, canonicalMarkerLocation: absolute,
    stateDirectory: absolute, machineIdentity: identity.properties.machineId, authorityDomainReference: relative }),
  authorityDomain: versioned({ ...authority, canonicalMarkerLocation: absolute, canonicalRoot: absolute,
    processFrame: object({ machineId: identity.properties.machineId, bootId: uuid,
      pidNamespace: identity.properties.pidNamespace, nsNet: identity.properties.nsNet }),
    lockSecretReference: relative, revision: positive }),
  marker: object({ schemaVersion: literal(2), service: literal('h2a-mcp-central'), ...authority,
    stateDirectory: absolute, endpoint, endpointMode: choice('discovered', 'fixed'), ...publication,
    predecessorGeneration: nullable(uuid), root: absolute, pid: positive, startedAt: text, ...image,
    protocol: literal(2), handoverProtocol: literal(1), handoverCapabilities: capabilities,
    mcpProtocolVersions: list(text), ...catalogue, state: literal('ready'), token: text, authKeyReference: relative }),
  readiness: versioned({ clientNonce: text, serverNonce: text, connectionNonce: text,
    service: literal('h2a-mcp-central'), namespaceId: text, ...publication, endpoint,
    endpointMode: choice('discovered', 'fixed'), root: absolute, uid: integer, state: literal('ready'),
    ...image, mcpProtocolVersions: list(text), ...catalogue, capabilities,
    challengeValidityMs: positive, mac }),
  request: versioned({ generation: uuid, publicationEpoch: epoch, method: text, authority: text,
    path: text, bodyDigest: hash, requestUid: text, requestNonce: text, serverNonce: text,
    connectionNonce: text, attachmentId: nullable(text), transportEpoch: nullable(positive), mac }),
  frame: versioned({ generation: uuid, attachmentId: text, transportEpoch: positive,
    channel: text, sequence: positive, payloadDigest: hash, requestUid: nullable(text), mac }),
  administration: object({ protocolVersion: literal(1), mode, upgradeId: text, handoverId: text,
    transactionEpoch: positive, expectedGeneration: uuid, expectedPublicationEpoch: epoch,
    inventoryRevision: positive, stepId: text, payloadDigest: hash }),
  resume: versioned({ attachmentId: text, expectedGeneration: uuid, expectedTransportEpoch: positive,
    resumeAttemptId: text, expectedInstance: text, lastAcceptedNotificationSequence: integer }),
  compatibilityEvidence: versioned({ proofId: text, mode: choice('catalogue', 'handover'),
    namespaceId: text, root: absolute, uid: integer,
    attester: object({ ...publication, buildId: text }),
    verifier: object({ algorithmVersion: text, buildId: text, reportDigest: hash,
      verdict: literal('additive-compatible') }), authorization,
    source: object({ generation: nullable(uuid), buildId: text, profileId: text, ...catalogue }),
    target, attachmentId: text, inventoryRevision: positive, issuedAt: integer, expiresAt: positive,
    challengeNonce: text, mac }),
  inventory: versioned({ revision: positive, shims: list(object({ attachmentId: text,
    shimVersion: text, shimBuildId: text, shimProcessIdentity: identity, attachmentProtocol: literal(1),
    handoverProtocol: literal(1), downstreamProtocolVersion: text, servedDescriptorDigest: hash,
    servedContractDigest: hash, supportedCheckpointVersions: list(positive),
    capabilities: object({ listChanged: boolean, attachTransfer: boolean, admissionProof: boolean,
      transportResume: boolean }), clientQualification: json })),
    transports: list(json), operations: list(json), quarantines: list(text), launches: list(text),
    endpointPinned: boolean, writerRestrictions: list(text), managedImage: boolean }),
  ownership: versioned({ attachmentId: text, ownerGeneration: uuid, ownershipEpoch: positive,
    ownerProcessIdentity: identity, state: choice('ACTIVE', 'FROZEN', 'TRANSFERRING', 'CLOSED'),
    handoverId: nullable(text), checkpointVersion: positive, checkpointHash: nullable(hash),
    presenceSessionId: text, expectedInstance: text }),
  checkpoint: versioned({ attachmentId: text, ownershipEpoch: positive, context: json, identity: json,
    presence: json, downstreamProtocol: text, servedCatalogue: json, subscriptions: list(json),
    observedPeers: json, observedInbox: json, notifications: json, negotiations: json,
    truncation: json, blockages: json, producedSequence: integer, deliveredSequence: integer,
    wakeState: json, terminalReferences: list(json), delegationReferences: list(json), launches: list(json) }),
  launchMemo: versioned({ attachmentId: text, launchName: text, launchId: text,
    initialArgumentsDigest: hash, state: choice('reserved', 'launching', 'completed', 'unknown'),
    executionOwner: identity, childProcessIdentity: nullable(identity), launchReceiptReference: relative,
    launchTokenBinding: hash, briefReceipt: nullable(json), terminalResult: nullable(json), retrySafe: boolean }),
  componentTransaction: versioned({ revision: positive, component: choice('mcp', 'gateway'),
    upgradeId: text, handoverId: text, transactionEpoch: positive, mode,
    source: object({ ...publication, ...image }), target: object({ ...image, entrypoint: absolute }),
    coordinator: identity, controllerEpoch: positive, inventoryRevision: positive,
    state: choice('RESERVED', 'PRECHECKED', 'BARRIER', 'FROZEN', 'PUBLISHED', 'DRAINING',
      'RETIRED', 'STOP_COMMITTED', 'STOPPED', 'STARTING', 'READY', 'SUCCESSOR_FAILED',
      'ABORTED', 'DRAIN_BLOCKED', 'DEFERRED_PAUSED', 'RECOVERY_BLOCKED'),
    barrierDeadline: nullable(integer), precheckEvidenceDigest: nullable(hash),
    checkpointReferences: list(relative), stepResults: record(object({ payloadDigest: hash, result: json })),
    successorReservation: nullable(object({ attempts: { ...integer, maximum: 3 },
      candidateIdentity: nullable(identity), selectionEpoch: positive, targetManifestDigest: hash })) }),
  selection: versioned({ prefixId: hash, canonicalPrefix: absolute, uid: integer, selectionEpoch: positive,
    ...image, entrypoint: relative, previousSelectionReference: nullable(relative), upgradeId: text }),
  upgradeTransaction: versioned({ upgradeId: text, revision: positive, prefixId: hash,
    canonicalPrefix: absolute, uid: integer, requestedTarget: text, resolvedTarget: text,
    artifactDigests: record(hash), targetManifestDigest: hash,
    origin: choice('manual', 'automatic', 'bootstrap', 'compensation'), initiatorIdentity: identity,
    controllerIdentity: identity, controllerBuildId: text, controllerEpoch: positive,
    controllerAuthorityState: choice('ACTIVE', 'REVOKED', 'ACQUIRING'),
    delegationState: choice('NONE', 'DELEGATING', 'DELEGATED'), delegatedBuildId: nullable(text),
    delegationReceiptDigest: nullable(hash), privateTicketReference: nullable(relative),
    installationState: choice('PREPARING', 'PREPARED', 'SELECTING', 'SELECTED', 'DELEGATING',
      'ACTIVATING', 'PARTIAL', 'COMPLETED', 'ABORTED', 'RECOVERY_BLOCKED'), selectionEpoch: positive,
    previousSelectionReference: nullable(relative), componentTransactions: record(relative),
    observations: json, verification: json, createdAt: integer, updatedAt: integer }),
  delegationTicket: versioned({ upgradeId: text, controllerEpoch: positive, expectedRevision: positive,
    delegatedBuildId: text, targetManifestDigest: hash, delegatedControllerIdentity: identity,
    ticketNonce: text, expiresAt: positive }),
  manifest: versioned({ packageVersion: text, buildId: text, profile: object({ platform: literal('linux'),
    arch: choice('x64', 'arm64'), libc: literal('glibc'), nodeMajor: choice(22, 24), nodeAbi: text }),
    entrypoints: record(relative), startupWaitBudgetMs: { ...integer, minimum: 10000, maximum: 60000 },
    maxAttachments: positive, files: list(object({ path: relative, type: choice('file', 'symlink', 'directory'),
    mode: integer, digest: nullable(hash), target: nullable(relative) })),
    nativeArtifacts: list(object({ path: relative, digest: hash, nodeAbi: text, arch: text,
      libc: literal('glibc'), toolchainDigest: hash, probePath: relative })) })
};

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
freeze(schemas);
