export const hash = `sha256:${'a'.repeat(64)}`;
export const identity = { machineId: '1'.repeat(32), bootId: '11111111-1111-4111-8111-111111111111',
  pidNamespace: '100', nsNet: '200', pid: 123, startTime: 456 };
export const epoch = { bootId: identity.bootId, counter: 1 };
export function marker() {
  return { schemaVersion: 2, service: 'h2a-mcp-central', namespaceId: 'ns-a',
    stateDirectory: '/lab/p/h2a-managed/1000/state/mcp/ns-a', prefixId: hash,
    endpoint: 'http://127.0.0.1:43210/mcp', endpointMode: 'discovered',
    generation: '22222222-2222-4222-8222-222222222222', publicationEpoch: epoch,
    predecessorGeneration: null, root: '/lab/root', uid: 1000, pid: 123,
    startedAt: '2026-10-11T00:00:00.000Z', processIdentity: identity,
    packageVersion: '0.98.7', buildId: 'fixture-build', manifestDigest: hash,
    protocol: 2, handoverProtocol: 1, handoverCapabilities: { managedImage: true,
      endpointPinned: false, restrictions: [], primitives: ['inventory'], attachTransfer: true,
      liveCoordinator: false }, mcpProtocolVersions: ['2025-03-26'],
    descriptorDigest: hash, contractDigest: hash, state: 'ready',
    token: 'decoy-with-no-authority', authKeyReference: 'private/root-key.json' };
}
export function evidence() {
  const m = marker();
  return { schemaVersion: 1, proofId: 'proof-a', mode: 'handover', namespaceId: m.namespaceId,
    root: m.root, uid: m.uid, attester: { generation: m.generation, publicationEpoch: epoch,
      processIdentity: identity, buildId: 'fixture-build' },
    verifier: { algorithmVersion: 'fixture-v1', buildId: 'unknown-future-build',
      reportDigest: hash, verdict: 'additive-compatible' },
    authorization: { upgradeId: 'upgrade-a', handoverId: 'handover-a', transactionEpoch: 1,
      controllerEpoch: 2, selectedManifestDigest: hash, delegatedControllerIdentity: identity,
      delegationReceiptDigest: hash },
    source: { generation: m.generation, buildId: m.buildId, profileId: 'linux-x64-node22',
      descriptorDigest: hash, contractDigest: hash },
    target: { generation: '33333333-3333-4333-8333-333333333333', publicationEpoch: { ...epoch, counter: 2 },
      endpoint: 'http://127.0.0.1:43211/mcp', buildId: 'unknown-future-build', manifestDigest: hash,
      descriptorDigest: hash, contractDigest: hash, catalogueRevision: 2 },
    attachmentId: 'attachment-a', inventoryRevision: 3, issuedAt: 1000, expiresAt: 2000,
    challengeNonce: 'nonce-a', mac: '0'.repeat(64) };
}
