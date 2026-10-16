// Run only in a private qualification copy. Each guard is restored in finally,
// rebuilt when needed, and the same explicit oracle must pass after restoration.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
process.umask(0o022);
if (!resolve('.').startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_qualification_copy_required');
const prefix = 'packages/h2a/src/runtime/handover/';
const state = 'packages/h2a/test/mh-l3-state.test.js', network = 'packages/h2a/test/mh-l3-network.test.js';
const names = {
  resume: 'resume should fence transports, preserve one activation and quarantine unknown liveness within capacity',
  mapping: 'request mappings should distinguish typed IDs, remap progress, settle once and cancel the original owner',
  catalogue: 'catalogue should retain its served view and reject changed tools while accepting only provenance-checked additions',
  page: 'catalogue pages should stay under the frame bound and refuse a cursor from another revision',
  evidence: 'evidence should accept an unknown delegated build and acknowledge only its exact transaction after commit',
  ownership: 'new baseline should require a proved old generation end and fence its old owner without discarding admitted work',
  ordinary: 'ordinary catalogue evidence should bind durable delegation and the published target without granting transfer',
  ids: 'shim should map typed IDs and progress, ignore forged session headers and cancel without waiting for its POST',
  lost: 'lost tools/list and identity replies should never be automatically replayed',
  local: 'shim should initialize locally and retain its catalogue and stdio without any marker or identity',
  m21: 'M21 real compiled shim should attach-transfer to the conformance peer while its real old central preserves G0 work'
};
const cases = [
  ['transport-epoch', prefix+'attachment-transports.js', 'a.transportEpoch++;', '', state, names.resume],
  ['resume-context', prefix+'attachment-transports.js', 'immutable(context) !== a.contextDigest', 'false', state, names.resume],
  ['resume-liveness', prefix+'attachment-transports.js', "if (liveness !== 'alive') throw new Error('liveness_unknown');", '', state, names.resume],
  ['quarantine-capacity', prefix+'attachment-transports.js', 'this.attachments.size >= this.capacity', "[...this.attachments.values()].filter(a => a.state !== 'quarantined').length >= this.capacity", state, names.resume],
  ['resume-attempt', prefix+'attachment-transports.js', "if (previous.fingerprint !== fingerprint) throw new Error('resume_conflict');", '', state, names.resume],
  ['typed-id', prefix+'request-mappings.js', 'upstreamId: this.nextId()', 'upstreamId: message.id', state, names.mapping],
  ['progress-owner', prefix+'request-mappings.js', 'sameOwner(entry.owner, owner)', 'true', state, names.mapping],
  ['progress-cleanup', prefix+'request-mappings.js', 'this.tokens.delete(entry.progressToken);', '', state, names.mapping],
  ['single-settlement', prefix+'request-mappings.js', 'if (entry.terminalState !== null) return false;', '', state, names.mapping],
  ['cancel-resource', prefix+'request-mappings.js', "entry.cancellationState = 'won'; entry.controller.abort();", "entry.cancellationState = 'won';", state, names.mapping],
  ['catalogue-provenance', prefix+'catalogue.js', 'isCompatibilityAcceptance(acceptance)', 'Boolean(acceptance)', state, names.catalogue],
  ['schema-property-description', prefix+'catalogue.js', 'Object.entries(value).map(([name, schema])', "Object.entries(value).filter(([name]) => name !== 'description').map(([name, schema])", state, names.catalogue],
  ['catalogue-retention', prefix+'catalogue.js', "this.state = 'DEGRADED_CATALOGUE'; return false;", "this.served = next; this.state = 'DEGRADED_CATALOGUE'; return false;", state, names.catalogue],
  ['catalogue-page-revision', prefix+'catalogue.js', 'parsed.digest !== this.served.descriptorDigest || ', '', state, names.page],
  ['evidence-validation', prefix+'evidence.js', '    readCompatibilityEvidence(proof, options);', '', 'packages/h2a/test/mh-l3-evidence.test.js', names.evidence],
  ['evidence-idempotency', prefix+'evidence.js', "if (old.fingerprint !== fingerprint) throw new Error('evidence_acceptance_conflict');", '', 'packages/h2a/test/mh-l3-evidence.test.js', names.evidence],
  ['ordinary-controller', prefix+'shim-evidence.js', 'upgrade.controllerEpoch !== tx.controllerEpoch || ', '', 'packages/h2a/test/mh-l3-evidence.test.js', names.ordinary],
  ['generation-end-mac', prefix+'generation-end.js', "verify(key, 'compatibility', context(marker), value, mac)", 'true', 'packages/h2a/test/mh-l3-ownership.test.js', names.ownership],
  ['baseline-proof', prefix+'ownership.js', ' || !proveEnded(old.value)', '', 'packages/h2a/test/mh-l3-ownership.test.js', names.ownership],
  ['local-initialize', prefix+'shim-bridge.js', "      write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: '@sentropic/h2a', version: buildInfo.packageVersion } } });", '', network, names.local, true],
  ['application-replay', prefix+'shim-bridge.js', "      if (entry.terminalState !== null || stopped) return;", "      if (entry.terminalState !== null || stopped) return;\n      if (entry.dispatchState === 'possible') { try { await post(entry.owner, { ...message, id: entry.upstreamId }); } catch {} }", network, names.lost, true],
  ['session-header', prefix+'shim-bridge.js', '      for (const next of frames) {', "      owner.sessionId = 'forged-session';\n      for (const next of frames) {", network, names.ids, true],
  ['cancellation-owner', prefix+'shim-bridge.js', 'track(post(entry.owner, { ...message', 'track(post(current, { ...message', 'packages/h2a/test/mh-l3-transfer.test.js', names.m21, true],
  ['source-ack-mode', prefix+'participants.js', "a.shimAcceptance.mode !== 'handover'", 'false', 'packages/h2a/test/mh-l3-source-offer.test.js',
    'source should refuse transfer without an exact handover acknowledgement even for an accepted catalogue proof'],
  ['control-capacity', prefix+'request-mappings.js', 'this.requests.size >= this.capacity', 'false', network,
    'control should cancel local requests at the 32-call limit without any application dispatch', true],
  ['unframed-budget', prefix+'shim-bridge.js', 'if (Buffer.byteLength(buffer) > 4 * 1024 * 1024)', 'if (Buffer.byteLength(buffer) > 8 * 1024 * 1024)', network,
    'unframed oversized input should be bounded while later valid input still works', true],
  ['admission-nonce', prefix+'request-mappings.js', 'proof.requestNonce === entry.requestNonce && ', '', state,
    'non-admission should require every binding from the authenticated response'],
  ['lease-activation', 'packages/h2a/src/runtime/mcp-central.ts', "attachment.disconnected ? 'dead' : ownerLiveness({ processIdentity: attachment.logical?.context.shimProcessIdentity }, currentIdentity())", "'dead'", 'packages/h2a/test/mh-l3-central.test.js',
    'real central should keep one activation past its lease and resume with fencing and idempotent attempts', true],
  ['stale-delete', 'packages/h2a/src/runtime/mcp-central.ts', "        if (context.req.method === 'DELETE' && Number(context.req.header('x-h2a-auth-transport-epoch')) !== attachment.logical.transportEpoch) throw new Error('transport_fenced');", '', 'packages/h2a/test/mh-l3-central.test.js',
    'real central should keep one activation past its lease and resume with fencing and idempotent attempts', true],
  ['cancel-post-cleanup', 'packages/h2a/src/runtime/mcp/transport/streamable-http.ts', 'const cancelled = () => { release(); resolve(ctx.body(null, 202)) }', 'const cancelled = () => {}', 'packages/h2a/test/mh-l3-transport.test.js',
    'cancelled JSON POST should release its response immediately and discard late results before ID reuse', true],
  ['lost-initialize-activation', prefix+'shim-bridge.js', "          if (options.attachment) {\n            try {", "          if (false) {\n            try {", 'packages/h2a/test/mh-l3-central.test.js',
    'real central should resume an initialize reply lost after admission without creating another activation', true],
  ['control-challenge-reserve', prefix+'authentication.js', "[...this.connections.values()].filter(p => p.pool === pool).length >= this.capacity", 'this.connections.size >= this.capacity', 'packages/h2a/test/mh-l3-control.test.js',
    'control should retain separate challenge and nonce capacity when the application pool is full'],
  ['control-nonce-reserve', prefix+'authentication.js', 'const nonces = control ? this.controlNonces : this.nonces;', 'const nonces = this.nonces;', 'packages/h2a/test/mh-l3-control.test.js',
    'control should retain separate challenge and nonce capacity when the application pool is full'],
  ['durable-ack-mac', prefix+'evidence.js', "verify(key, 'compatibility', acknowledgementContext(marker), value, mac)", 'true', 'packages/h2a/test/mh-l3-evidence.test.js',
    'durable shim acceptance should survive a lost ACK only for its exact authenticated source and receipt'],
  ['durable-ack-persist', 'packages/h2a/src/runtime/mcp-central.ts', '      recordShimAcceptance(administration()!.marker, live.rootKey, receipt);', '', 'packages/h2a/test/mh-l3-transfer.test.js', names.m21, true]
  ,['schema-literal-description', prefix+'catalogue.js', ': structuredClone(v)]));', ': schemaContract(v)]));', state,
    'schema instance values and properties named description or dollar-ref should remain normative'],
  ['catalogue-protocol', prefix+'catalogue.js', 'this.upstream.protocolVersions.includes(protocolVersion) && ', '', state, names.catalogue],
  ['sse-readiness', prefix+'authenticated-http.js', '      outgoing.flushHeaders();', '', 'packages/h2a/test/mh-l3-central.test.js',
    'signed SSE should authenticate readiness promptly and release only its notification stream on disconnect', true],
  ['sse-reader-release', prefix+'authenticated-http.js', "      outgoing.once('close', releaseReader);", '', 'packages/h2a/test/mh-l3-central.test.js',
    'signed SSE should authenticate readiness promptly and release only its notification stream on disconnect', true],
  ['target-catalogue-revision', prefix+'shim-bridge.js', "        if (catalogue.revision !== offer.catalogueRevision || catalogue.descriptorDigest !== receipt.targetDescriptorDigest) throw new Error('transfer_catalogue_mismatch');", '', 'packages/h2a/test/mh-l3-transfer.test.js', names.m21, true]
  ,['loaded-shim-build', prefix+'shim-build.js', 'buildId: manifest.buildId', "buildId: 'foreign-build'", 'packages/h2a/test/mh-l3-transfer.test.js', names.m21, true]
  ,['unknown-identity-resume', prefix+'shim-bridge.js', '            try { await probeExpectedInstance(owner); }', '            try { }', 'packages/h2a/test/mh-l3-central.test.js',
    'resume should discover an unknown expected identity without weakening the instance guard or creating another binding', true]
  ,['resumed-progress', prefix+'shim-bridge.js', '        mappings.resumeNotifications(previous, current);', '', network,
    'resumed notifications should deliver progress for admitted work while cancellation keeps its original transport owner', true]
];
function compile() {
  const r = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b', 'packages/h2a', '--pretty', 'false'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mutation_compile_failed:' + r.stdout + r.stderr);
}
function run(file, name, label) {
  const r = spawnSync(process.execPath, ['scripts/mh-l3-test.mjs', file, label], { encoding: 'utf8', maxBuffer: 24*1024*1024,
    env: { ...process.env, MH_L3_CASE: name } });
  const log = `docs/plan/mh-l3/evidence/${basename(file)}-node${process.versions.node.split('.')[0]}-${label}.log`;
  const output = fs.readFileSync(log, 'utf8'), receipt = JSON.parse(output.split('\nreceipt: ').at(-1));
  return { status: r.status, output, receipt, log };
}
const chosen = process.argv.slice(2).length ? cases.filter(c => process.argv.slice(2).includes(c[0])) : cases;
if (!chosen.length || process.argv.slice(2).some(n => !cases.some(c => c[0] === n))) throw new Error('unknown_mutation');
const results = [];
const output = `docs/plan/mh-l3/mutations-node${process.versions.node.split('.')[0]}.json`;
const old = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)).results : [];
for (const [name, path, before, after, file, oracle, build] of chosen) {
  const original = fs.readFileSync(path, 'utf8');
  if (original.split(before).length !== 2) throw new Error('mutation_anchor_not_unique:' + name);
  let red;
  try { fs.writeFileSync(path, original.replace(before, after)); if (build) compile(); red = run(file, oracle, name+'-red'); }
  finally { fs.writeFileSync(path, original); if (build) compile(); }
  if (red.status !== 1 || red.receipt.tests !== 1 || red.receipt.invalid || red.receipt.signal || !red.output.includes('ERR_ASSERTION')) throw new Error('mutation_survived_or_failed_abnormally:'+name+':'+red.log);
  const green = run(file, oracle, name+'-green');
  if (green.status !== 0 || green.receipt.tests !== 1 || green.receipt.invalid || green.receipt.signal) throw new Error('restoration_failed:'+name+':'+green.log);
  results.push({ name, path, oracle, sourceSha256: createHash('sha256').update(original).digest('hex'), red: red.log, green: green.log, restored: fs.readFileSync(path,'utf8') === original });
  fs.writeFileSync(output, JSON.stringify({ node: process.version, results: [...old.filter(o => !results.some(r=>r.name===o.name)), ...results] }, null, 2)+'\n');
  process.stdout.write(`node${process.versions.node.split('.')[0]} ${name}: ERR_ASSERTION -> 1/1 passed, zero skips, restored\n`);
}
