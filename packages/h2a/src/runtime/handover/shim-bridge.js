import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { embeddedTools } from '../mcp-central-descriptor.js';
import { centralMcpMarkerPath, readCentralClientMarker, parseCentralMcpEndpoint } from '../mcp-central-discovery.js';
import { authenticatedHttpRequest, readAuthenticationKey } from './authenticated-http.js';
import { FrameVerifier } from './authentication.js';
import { currentIdentity, ownerLiveness } from './admission.js';
import { RequestMappings, nonAdmissionMatches } from './request-mappings.js';
import { CatalogueView, describeCatalogue, checkCatalogue } from './catalogue.js';
import { generationEnded } from './generation-end.js';
import { EvidenceAcceptances, shimAcceptanceRecorded } from './evidence.js';
import { shimEvidenceOptions } from './shim-evidence.js';
import { installationForEntry } from './selection.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readState } from './state.js';
import { digest } from './wire.js';
import { shimBuildInfo } from './shim-build.js';

const PROTOCOLS = ['2025-06-18', '2024-11-05'];
const rpc = value => value && value.jsonrpc === '2.0' && !Array.isArray(value);
function messages(text, type) {
  if (!text.trim()) return [];
  const chunks = type?.includes('text/event-stream') ? text.split(/\r?\n\r?\n/).flatMap(event => {
    const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    return data ? [data] : [];
  }) : [text];
  return chunks.flatMap(chunk => { const value = JSON.parse(chunk); return (Array.isArray(value) ? value : [value]).filter(rpc); });
}

// Discovery stays at this boundary; a registry-backed resolver can replace it
// without changing correlation, provenance or business ownership.
export async function bridgeCentralMcpStdio(options) {
  const markerPath = centralMcpMarkerPath(options), attachmentId = options.attachment?.id ?? randomUUID();
  const mappings = new RequestMappings(), view = new CatalogueView(describeCatalogue(embeddedTools));
  const buildInfo = shimBuildInfo();
  const acceptances = new EvidenceAcceptances(), owners = new Set();
  const retireOwners = () => {
    for (const owner of owners) if (owner !== current && ![...mappings.requests.values()].some(e => e.owner === owner)) {
      owner.events?.abort(); owners.delete(owner);
    }
  };
  const controller = new AbortController(), work = new Set();
  let current, pendingOwner, connecting, initialized, stopped = false, writer = Promise.resolve(), queued = 0;
  let viewOrigin = { generation: null, buildId: buildInfo.buildId, profileId: `linux-${process.arch}-node${process.versions.node.split('.')[0]}` };
  let transportState = 'CONNECTING', buffer = '', discarding = false, eventOwner;
  let leasing = false, nextRecovery = 0, failures = 0, recoveryStarted, healthySince, unavailableReason = 'central_unavailable';
  const recover = observed => {
    // Classify the replacement before arming recovery's first backoff. A
    // transient discovery failure cannot erase an already observed v1 owner.
    try {
      const marker = observed ?? readCentralClientMarker(markerPath);
      if (marker.schemaVersion !== 2 || marker.protocol !== 2) unavailableReason = 'legacy_requires_cold_upgrade';
    } catch { /* Missing or invalid discovery is not evidence of a v2 recovery. */ }
    // Loss is the first recovery event, even before connect() has failed.
    // Both supervision and downstream demand must leave the first backoff
    // interval available to an externally restarted central before autostart.
    if (transportState === 'READY') {
      healthySince = undefined; recoveryStarted ??= Date.now();
      nextRecovery = Math.max(nextRecovery, Date.now() + 1000 * (0.5 + Math.random() / 2));
    }
    transportState = 'RECOVERING';
  };
  const decoder = new StringDecoder('utf8');
  const track = promise => { work.add(promise); void promise.catch(() => {}).finally(() => work.delete(promise)); return promise; };
  const write = value => {
    if (stopped) return;
    let line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > 1024 * 1024) {
      if (value.id === undefined) return;
      line = JSON.stringify({ jsonrpc: '2.0', id: value.id, error: { code: -32011, message: 'response_too_large' } }) + '\n';
    }
    const size = Buffer.byteLength(line);
    if (queued + size > 8 * 1024 * 1024) { stop(); return; }
    queued += size;
    writer = writer.then(() => new Promise((resolve, reject) => options.stdout.write(line, e => e ? reject(e) : resolve())))
      .finally(() => { queued -= size; });
    void writer.catch(stop);
  };
  const error = (id, code, message = code, retrySafe = false) => write({ jsonrpc: '2.0', id,
    error: { code: -32011, message, data: { code, retrySafe } } });
  const request = (owner, path, init = {}) => authenticatedHttpRequest(markerPath, owner.marker,
    new URL(path, owner.marker.endpoint), { ...init, attachmentId, transportEpoch: owner.transportEpoch,
      notificationVerifier: owner.verifier, signal: init.signal ?? AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]) });
  const headers = owner => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'x-h2a-workspace': encodeURIComponent(options.workspaceRoot ?? process.cwd()),
    'x-h2a-attachment-id': attachmentId, 'x-h2a-transport-epoch': String(owner.transportEpoch),
    ...(options.attachment ? { 'x-h2a-attachment': Buffer.from(JSON.stringify(options.attachment)).toString('base64url') } : {}),
    ...(owner.sessionId ? { 'mcp-session-id': owner.sessionId } : {}) });
  const post = async (owner, message, signal, binding) => {
    const response = await request(owner, owner.marker.endpoint, { method: 'POST', headers: headers(owner),
      body: JSON.stringify(message), signal, requestUid: binding?.requestUid, requestNonce: binding?.requestNonce });
    if (!response.ok) { const e = new Error(`central MCP HTTP ${response.status}`); e.refusal = await response.json(); throw e; }
    return { response, frames: response.status === 202 || response.status === 204 ? [] : messages(await response.text(), response.headers.get('content-type')) };
  };
  const probeExpectedInstance = async owner => {
    if (!options.attachment || options.attachment.expectedInstance !== undefined) return;
    const response = await request(owner, `/_h2a-central/shim/${attachmentId}/status`, { headers: headers(owner) });
    if (!response.ok) return;
    const status = await response.json();
    if (status.attachmentId !== attachmentId || status.generation !== owner.generation || status.transportEpoch !== owner.transportEpoch ||
        typeof status.expectedInstance !== 'string' || !status.expectedInstance) throw new Error('attachment_status_mismatch');
    if (status.expectedInstance !== 'identity_disabled') options.attachment.expectedInstance = status.expectedInstance;
  };
  const refreshCatalogue = async owner => {
    // Until this generation/revision is complete, no individual upstream tool
    // contract is demonstrated. Keep the served list, close tool dispatch.
    view.upstream = undefined;
    const response = await request(owner, '/_h2a-central/catalogue');
    if (!response.ok) { view.state = 'DEGRADED_CATALOGUE'; return; }
    const next = await response.json(), before = view.served.descriptorDigest;
    if (!Number.isSafeInteger(next.revision) || next.revision < 1) throw new Error('catalogue_revision_invalid');
    if (view.install(next)) viewOrigin = { ...viewOrigin, generation: owner.marker.generation, buildId: owner.marker.buildId };
    if (view.served.descriptorDigest !== before) write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  };
  const finishAcceptance = async owner => {
    const { offer, receipt } = owner.pendingAcceptance;
    const recorded = () => shimAcceptanceRecorded(owner.marker, readAuthenticationKey(markerPath, owner.marker), receipt);
    if (!recorded()) {
      const ack = await request(owner, `/_h2a-central/shim/${attachmentId}/ack`, { method: 'POST', headers: headers(owner), body: JSON.stringify(receipt) });
      if (!ack.ok || digest(await ack.json()) !== digest(receipt) || !recorded()) throw new Error('shim_ack_invalid');
    }
    owner.acceptedProofDigest = receipt.proofDigest; owner.pendingAcceptance = undefined;
    if (receipt.mode === 'handover') owner.transfer = { offer, receipt };
    else {
      const before = view.served.descriptorDigest;
      view.install(offer.descriptor, receipt); viewOrigin = { ...viewOrigin, generation: owner.marker.generation, buildId: owner.marker.buildId };
      if (view.served.descriptorDigest !== before) write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    }
  };
  const pollOffer = async owner => {
    if (!options.attachment || !owner.registration) return;
    if (owner.pendingAcceptance) { await finishAcceptance(owner); return; }
    const response = await request(owner, `/_h2a-central/shim/${attachmentId}/offer`);
    if (!response.ok) throw new Error('shim_offer_unavailable');
    const value = await response.json(), offer = value.offer;
    if (!offer || owner.acceptedProofDigest === digest(offer.proof)) return;
    const sourceView = { ...viewOrigin, descriptorDigest: view.served.descriptorDigest, contractDigest: view.served.contractDigest };
    const evidenceOptions = shimEvidenceOptions(offer, { marker: owner.marker, markerPath,
      rootKey: readAuthenticationKey(markerPath, owner.marker), installation: installationForEntry(fileURLToPath(new URL('../../bin.js', import.meta.url))),
      sourceView, attachmentId, inventoryRevision: value.inventoryRevision, challengeNonce: owner.registration.challengeNonce });
    const receipt = acceptances.accept(offer.proof, evidenceOptions);
    owner.pendingAcceptance = { offer, receipt }; await finishAcceptance(owner);
  };
  const receive = async (message, owner) => {
    if (message.method && message.id !== undefined) {
      await post(owner, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Server requests were not negotiated' } }); return;
    }
    if (message.id !== undefined || !message.method) return;
    const sequence = message.params?._meta?.h2aNotificationSequence;
    if (Number.isSafeInteger(sequence)) {
      if (sequence <= (owner.lastAcceptedNotificationSequence ?? 0)) return;
      owner.lastAcceptedNotificationSequence = sequence;
    }
    if (message.method === 'notifications/progress') {
      const translated = mappings.progress(message.params?.progressToken, owner);
      if (translated) write({ ...message, params: { ...message.params, ...translated } });
    } else if (message.method === 'notifications/tools/list_changed') await refreshCatalogue(owner);
    else if (owner === current) write(message);
  };
  const notifications = owner => {
    if (eventOwner === owner || stopped) return;
    eventOwner = owner; owner.events = new AbortController();
    const signal = AbortSignal.any([controller.signal, owner.events.signal]);
    track((async () => {
      const response = await request(owner, owner.marker.endpoint, { headers: { ...headers(owner), accept: 'text/event-stream' }, signal });
      if (!response.ok) throw new Error('notification_stream_unavailable');
      let bytes = ''; const decode = new StringDecoder('utf8');
      for await (const chunk of response.body) {
        bytes += decode.write(Buffer.from(chunk));
        if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw new Error('notification_budget');
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(bytes))) {
          const event = bytes.slice(0, boundary.index); bytes = bytes.slice(boundary.index + boundary[0].length);
          for (const message of messages(event + '\n\n', 'text/event-stream')) await receive(message, owner);
        }
      }
    })().then(() => { if (!signal.aborted && current === owner && owner.registration) recover(); })
      .catch(() => { if (!signal.aborted && current === owner) recover(); })
      .finally(() => { if (eventOwner === owner) eventOwner = undefined; }));
  };
  const connect = () => {
    if (!connecting) healthySince = undefined;
    connecting ??= (async () => {
      let marker;
      try { marker = readCentralClientMarker(markerPath); }
      catch (e) { if (e.code !== 'ENOENT') throw e; await options.ensure?.(); marker = readCentralClientMarker(markerPath); }
      if (marker.schemaVersion !== 2 || marker.protocol !== 2) throw new Error('legacy_requires_cold_upgrade');
      if (options.endpoint && !current && marker.endpoint !== parseCentralMcpEndpoint(options.endpoint)) throw new Error('central MCP marker does not match requested endpoint');
      if (current?.pendingAcceptance) await finishAcceptance(current);
      if (!current && pendingOwner && pendingOwner.generation !== marker.generation && ownerLiveness(pendingOwner.marker, currentIdentity()) !== 'dead' &&
          !generationEnded(pendingOwner.marker, readAuthenticationKey(markerPath, pendingOwner.marker))) throw new Error('live_transfer_acceptance_required');
      if (current && current.marker.generation !== marker.generation && current.transfer) {
        const { offer, receipt } = current.transfer;
        if (receipt.mode !== 'handover' || digest(marker) !== digest(offer.targetPublication)) throw new Error('transfer_publication_mismatch');
        const control = readState(join(current.marker.stateDirectory, 'component-control.json'), 'componentControl')?.value;
        const tx = control?.activeTransaction && readState(join(current.marker.stateDirectory, control.activeTransaction), 'componentTransaction')?.value;
        if (!tx || !['PUBLISHED', 'RETIRED'].includes(tx.state) || tx.handoverId !== receipt.authorization.handoverId ||
            tx.transactionEpoch !== receipt.authorization.transactionEpoch) throw new Error('transfer_source_not_published');
        const owner = { marker, generation: marker.generation, attachmentId, transportEpoch: current.transportEpoch + 1,
          protocolVersion: initialized.protocolVersion,
          verifier: new FrameVerifier(marker, readAuthenticationKey(markerPath, marker)) };
        if (!offer.descriptor.protocolVersions.includes(owner.protocolVersion)) throw new Error('transfer_protocol_mismatch');
        const response = await request(owner, '/_h2a-central/attach-transfer', { method: 'POST', headers: headers(owner), body: JSON.stringify({
          attachmentId, expectedGeneration: marker.generation, expectedTransportEpoch: current.transportEpoch,
          handoverId: tx.handoverId, transactionEpoch: tx.transactionEpoch, proofId: receipt.proofId, proofDigest: receipt.proofDigest,
          checkpointReferences: tx.checkpointReferences, expectedInstance: options.attachment?.expectedInstance ?? 'identity_disabled',
          attemptId: current.transferAttemptId ??= randomUUID(), context: options.attachment }) });
        if (!response.ok) throw new Error('attach_transfer_refused');
        const result = await response.json();
        if (result.attachmentId !== attachmentId || result.generation !== marker.generation || result.transportEpoch !== owner.transportEpoch ||
            result.proofDigest !== receipt.proofDigest || !result.sessionId) throw new Error('attach_transfer_mismatch');
        owner.sessionId = result.sessionId;
        const catalogueResponse = await request(owner, '/_h2a-central/catalogue');
        if (!catalogueResponse.ok) throw new Error('transfer_catalogue_unavailable');
        const catalogue = await catalogueResponse.json(); checkCatalogue(catalogue);
        if (catalogue.revision !== offer.catalogueRevision || catalogue.descriptorDigest !== receipt.targetDescriptorDigest) throw new Error('transfer_catalogue_mismatch');
        owners.add(owner); current = owner;
        const before = view.served.descriptorDigest;
        view.install(offer.descriptor, receipt); viewOrigin = { ...viewOrigin, generation: marker.generation, buildId: marker.buildId };
        if (view.served.descriptorDigest !== before) write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
        transportState = 'READY'; notifications(owner); retireOwners(); return owner;
      }
      if (current && current.marker.generation !== marker.generation && ownerLiveness(current.marker, currentIdentity()) !== 'dead' &&
          !generationEnded(current.marker, readAuthenticationKey(markerPath, current.marker))) throw new Error('live_transfer_acceptance_required');
      if (current && current.marker.generation === marker.generation) {
        await probeExpectedInstance(current);
        const response = await request(current, '/_h2a-central/resume', { method: 'POST', headers: headers(current), body: JSON.stringify({
          schemaVersion: 1, attachmentId, expectedGeneration: marker.generation, expectedTransportEpoch: current.transportEpoch,
          resumeAttemptId: current.resumeAttemptId ??= randomUUID(), expectedInstance: options.attachment?.expectedInstance ?? 'identity_disabled',
          lastAcceptedNotificationSequence: current.lastAcceptedNotificationSequence ?? 0 }) });
        if (!response.ok) throw new Error('transport_resume_refused');
        const result = await response.json();
        if (result.attachmentId !== attachmentId || result.generation !== marker.generation || result.transportEpoch !== current.transportEpoch + 1 || !result.sessionId) throw new Error('transport_resume_mismatch');
        current.events?.abort();
        const previous = current;
        current = { ...current, sessionId: result.sessionId, transportEpoch: result.transportEpoch, resumeAttemptId: undefined };
        owners.add(current);
        mappings.resumeNotifications(previous, current);
        for (const notification of result.notifications ?? []) await receive(notification, current);
        // Work admitted under the previous transport keeps its exact owner.
        if (![...mappings.requests.values()].some(e => e.owner === previous)) { owners.delete(previous); previous.events?.abort(); }
        if (result.notificationGap) write({ jsonrpc: '2.0', method: 'notifications/h2a/session_state_gap', params: { reason: 'notification_gap' } });
      } else {
        const owner = pendingOwner?.generation === marker.generation ? pendingOwner : { marker, generation: marker.generation, sessionId: undefined, attachmentId, transportEpoch: 1,
          verifier: new FrameVerifier(marker, readAuthenticationKey(markerPath, marker)) };
        if (options.attachment && (current || (pendingOwner && pendingOwner.generation !== marker.generation))) options.attachment.resume = true;
        pendingOwner = owner;
        const id = mappings.nextId();
        const initializeMessage = { jsonrpc: '2.0', id, method: 'initialize', params: {
          protocolVersion: initialized.protocolVersion, capabilities: {}, clientInfo: { name: 'h2a-central-shim', version: '3' } } };
        let handshake, handshakeId = id;
        try { handshake = await post(owner, initializeMessage); }
        catch {
          // A lost initialize reply may already own a logical activation. Ask
          // for that attachment before retrying this idempotent handshake.
          if (options.attachment) {
            try { await probeExpectedInstance(owner); } catch { /* Unsupported status does not grant a resume or a new activation. */ }
            const resumed = await request(owner, '/_h2a-central/resume', { method: 'POST', headers: headers(owner), body: JSON.stringify({ schemaVersion: 1,
              attachmentId, expectedGeneration: marker.generation, expectedTransportEpoch: owner.transportEpoch,
              resumeAttemptId: owner.resumeAttemptId ??= randomUUID(), expectedInstance: options.attachment.expectedInstance ?? 'identity_disabled', lastAcceptedNotificationSequence: 0 }) });
            if (resumed.ok) {
              const result = await resumed.json();
              if (result.attachmentId === attachmentId && result.generation === marker.generation && result.transportEpoch === owner.transportEpoch + 1 &&
                  result.sessionId && PROTOCOLS.includes(result.protocolVersion)) {
                owner.transportEpoch = result.transportEpoch;
                handshake = { response: { headers: { get: name => name === 'mcp-session-id' ? result.sessionId : null } },
                  frames: [{ jsonrpc: '2.0', id: handshakeId, result: { protocolVersion: result.protocolVersion } }] };
              }
            }
          }
          if (!handshake) { handshakeId = mappings.nextId(); handshake = await post(owner, { ...initializeMessage, id: handshakeId }); }
        }
        const reply = handshake.frames.find(m => m.id === handshakeId);
        if (!reply?.result || !PROTOCOLS.includes(reply.result.protocolVersion)) throw new Error('initialize_invalid');
        owner.protocolVersion = reply.result.protocolVersion;
        owner.sessionId = handshake.response.headers.get('mcp-session-id');
        if (!owner.sessionId) throw new Error('initialize_session_missing');
        if (options.attachment && handshake.response.headers.get('x-h2a-instance')) options.attachment.expectedInstance = handshake.response.headers.get('x-h2a-instance');
        await post(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
        if (current) { current.events?.abort(); write({ jsonrpc: '2.0', method: 'notifications/h2a/session_state_gap', params: { reason: 'generation_replaced' } }); }
        current = owner; pendingOwner = undefined; owners.add(owner);
        retireOwners();
      }
      transportState = 'READY';
      await refreshCatalogue(current).catch(() => { view.state = 'DEGRADED_CATALOGUE'; });
      if (options.attachment && !current.registration) {
        const advertisement = { attachmentId, shimVersion: buildInfo.packageVersion, shimBuildId: buildInfo.buildId, shimProcessIdentity: options.attachment.shimProcessIdentity,
          attachmentProtocol: 1, handoverProtocol: 1, downstreamProtocolVersion: initialized.protocolVersion,
          servedDescriptorDigest: view.served.descriptorDigest, servedContractDigest: view.served.contractDigest, supportedCheckpointVersions: [1],
          capabilities: { listChanged: true, attachTransfer: true, admissionProof: true, transportResume: true },
          clientQualification: { profileId: `linux-${process.arch}-node${process.versions.node.split('.')[0]}` },
          sourceView: { ...viewOrigin, descriptorDigest: view.served.descriptorDigest, contractDigest: view.served.contractDigest } };
        const registered = await request(current, `/_h2a-central/shim/${attachmentId}/register`, { method: 'POST', headers: headers(current), body: JSON.stringify(advertisement) });
        if (registered.ok) current.registration = await registered.json();
      }
      notifications(current); return current;
    })().then(owner => { healthySince ??= Date.now(); unavailableReason = 'central_unavailable'; return owner; }).catch(e => {
      if (e.message === 'legacy_requires_cold_upgrade') unavailableReason = e.message;
      transportState = 'DEGRADED_TRANSPORT'; healthySince = undefined; recoveryStarted ??= Date.now(); failures++;
      const degraded = Date.now() - recoveryStarted >= 60000;
      nextRecovery = Date.now() + (degraded ? 30000 * (0.8 + Math.random() * 0.4) : [1000, 2000, 4000, 8000, 15000][Math.min(failures - 1, 4)] * (0.5 + Math.random() / 2));
      throw unavailableReason === 'legacy_requires_cold_upgrade' ? new Error(unavailableReason, { cause: e }) : e;
    }).finally(() => { connecting = undefined; });
    return connecting;
  };
  const available = async () => {
    if (connecting) return connecting;
    if (current && transportState === 'READY') return current;
    if (Date.now() < nextRecovery) throw new Error(unavailableReason);
    return connect();
  };
  const dispatch = async (message, entry) => {
    try {
      const owner = await Promise.race([available(), new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error(Date.now() >= entry.originalDeadline ? 'deadline_exceeded' : 'central_unavailable')), Math.min(2000, Math.max(0, entry.originalDeadline - Date.now())));
        timer.unref(); entry.waitTimer = timer;
        const cancelled = () => reject(new Error('cancelled'));
        entry.controller.signal.addEventListener('abort', cancelled, { once: true });
        entry.cancelWait = () => entry.controller.signal.removeEventListener('abort', cancelled);
      })]);
      clearTimeout(entry.waitTimer); entry.cancelWait?.();
      if (entry.terminalState !== null) return;
      if (Date.now() >= entry.originalDeadline) throw new Error('deadline_exceeded');
      if (message.method === 'tools/call' && !view.canCall(message.params?.name, owner.protocolVersion)) {
        if (mappings.settle(entry, 'non-admission')) error(message.id, 'tool_unavailable_on_generation'); return;
      }
      entry.owner = owner; entry.dispatchState = 'possible';
      const params = entry.progressToken ? { ...message.params, _meta: { ...message.params._meta, progressToken: entry.progressToken } } : message.params;
      const outgoing = { ...message, id: entry.upstreamId, ...(params ? { params } : {}) }; entry.requestDigest = digest(outgoing);
      const { frames } = await post(owner, outgoing,
        AbortSignal.any([controller.signal, entry.controller.signal, AbortSignal.timeout(Math.max(1, entry.originalDeadline - Date.now()))]), entry);
      for (const next of frames) {
        if (next.method) await receive(next, owner);
        else if (next.id === entry.upstreamId && mappings.settle(entry)) {
          if (options.attachment && message.method === 'tools/call' && message.params?.name === 'h2a_identity_status') {
            try { const status = JSON.parse(next.result.content[0].text); if (status.state === 'identity_ready') options.attachment.expectedInstance = status.instance; } catch { /* No identity was reported. */ }
          }
          write({ ...next, id: entry.downstreamId });
        }
      }
      if (entry.terminalState === null && mappings.settle(entry, 'unknown')) error(entry.downstreamId, 'outcome_unknown');
    } catch (e) {
      clearTimeout(entry.waitTimer);
      if (entry.terminalState !== null || stopped) return;
      if (entry.owner && nonAdmissionMatches(e.refusal, entry, message)) {
        if (mappings.settle(entry, 'non-admission')) error(entry.downstreamId, e.refusal.reason, e.refusal.reason, true); return;
      }
      if (entry.dispatchState === 'possible') { recover(); if (e.applicationDispatched === false) entry.dispatchState = 'not-sent'; }
      if (mappings.settle(entry, 'error')) error(entry.downstreamId, entry.dispatchState === 'possible' ? 'outcome_unknown' : ['deadline_exceeded', 'legacy_requires_cold_upgrade'].includes(e.message) ? e.message : 'central_unavailable', e.message);
    } finally { retireOwners(); }
  };
  const onMessage = message => {
    if (!rpc(message) || typeof message.method !== 'string' || (message.id !== undefined && !['number', 'string'].includes(typeof message.id))) {
      write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }); return;
    }
    if (message.id !== undefined && Buffer.byteLength(JSON.stringify(message.id)) > 1024) {
      write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request ID exceeds the frame budget' } }); return;
    }
    if (message.method === 'notifications/cancelled' && message.id === undefined) {
      const entry = mappings.cancel(message.params?.requestId);
      if (entry?.owner && entry.dispatchState === 'possible') track(post(entry.owner, { ...message, params: { ...message.params, requestId: entry.upstreamId } }).catch(() => {}));
      return;
    }
    if (message.method === 'initialize') {
      if (initialized) { error(message.id, 'already_initialized'); return; }
      const protocolVersion = PROTOCOLS.includes(message.params?.protocolVersion) ? message.params.protocolVersion : PROTOCOLS[0];
      initialized = { protocolVersion };
      write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: '@sentropic/h2a', version: buildInfo.packageVersion } } });
      track(connect().catch(() => {})); return;
    }
    if (!initialized) { if (message.id !== undefined) error(message.id, 'initialize_required'); return; }
    if (message.method === 'notifications/initialized') return;
    if (message.method === 'tools/list') {
      if (message.id !== undefined) {
        try { write({ jsonrpc: '2.0', id: message.id, result: view.page(message.params?.cursor) }); }
        catch (e) { error(message.id, 'catalogue_unavailable', e.message); }
      }
      return;
    }
    if (message.id === undefined) {
      if (current && transportState === 'READY') track(post(current, message).catch(() => {})); return;
    }
    let entry;
    const offeredDeadline = message.params?._meta?.deadline;
    const deadline = Number.isSafeInteger(offeredDeadline) ? Math.min(Date.now() + 55_000, offeredDeadline) : Date.now() + 55_000;
    try { entry = mappings.begin(message, undefined, deadline); }
    catch (e) { error(message.id, e.message); return; }
    track(dispatch(message, entry));
  };
  const onData = bytes => {
    buffer += decoder.write(Buffer.from(bytes));
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (discarding) { discarding = false; continue; }
      if (Buffer.byteLength(line) > 4 * 1024 * 1024) { error(null, 'input_budget'); continue; }
      try { onMessage(JSON.parse(line)); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    }
    if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { buffer = ''; discarding = true; error(null, 'input_budget'); }
  };
  let finish;
  const ended = new Promise(resolve => { finish = resolve; });
  const stop = () => {
    if (stopped) return; stopped = true; controller.abort(); mappings.close();
    for (const owner of owners) owner.events?.abort(); options.stdin.off('data', onData); options.stdin.pause(); finish();
  };
  options.stdin.on('data', onData); options.stdin.once('end', stop); options.stdin.once('close', stop);
  options.signal?.addEventListener('abort', stop, { once: true }); if (options.signal?.aborted) stop();
  const supervision = setInterval(() => {
    if (stopped || !initialized || leasing) return; leasing = true;
    track((async () => {
      if (transportState !== 'READY') {
        if (Date.now() < nextRecovery) return;
        try { await connect(); } catch { /* connect retains the bounded recovery schedule */ }
        return;
      }
      if (healthySince && Date.now() - healthySince >= 10000) { failures = 0; recoveryStarted = undefined; }
      const observed = readCentralClientMarker(markerPath);
      if (observed.schemaVersion !== 2 || observed.protocol !== 2) { recover(observed); return; }
      await pollOffer(current);
      if (observed.generation !== current.marker.generation) { recover(observed); return; }
      if (Date.now() - (current.lastLease ?? 0) >= 5000) {
        const response = await request(current, `/_h2a-central/lease/${current.sessionId}`, { headers: headers(current) });
        if (!response.ok) throw new Error('lease_unavailable');
        const status = await response.json();
        if (options.attachment && status.state === 'identity_ready' && status.instance) options.attachment.expectedInstance = status.instance;
        current.lastLease = Date.now(); notifications(current);
      }
    })().catch(() => recover()).finally(() => { leasing = false; }));
  }, 1000);
  supervision.unref(); await ended;
  clearInterval(supervision); options.signal?.removeEventListener('abort', stop);
  options.stdin.off('end', stop); options.stdin.off('close', stop);
  await Promise.allSettled([...work]); await writer.catch(() => {});
  if (current?.sessionId) {
    try { await request(current, current.marker.endpoint, { method: 'DELETE', headers: headers(current), signal: AbortSignal.timeout(1000) }); } catch { /* Central retains authority until explicit disconnect or proved death and drain. */ }
  }
}
