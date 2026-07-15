import { readFileSync, realpathSync } from "node:fs";
import { hostname } from "node:os";

import {
  H2A_ACTIVITY_WINDOW_DEFAULT_MS,
  H2A_ATTESTER_COMPREHENSION_RIGHT,
  H2A_COMPREHENSION_ATTESTATION_BODY_KIND,
  H2A_ROLES,
  H2A_DECLARATION_INTERET_BODY_KIND,
  H2A_SESSION_NOTIFICATION_TOPICS,
  H2A_SESSION_STATES,
  auditNhiPosture,
  deriveConnectionConfidence,
  buildComprehensionAttestation,
  canAttestComprehension,
  computeHash,
  createEnvelope,
  deriveWorkspaceId,
  effectiveOrgInstances,
  isComprehensionAttestation,
  nhiAttestationEnvelope,
  nhiInventory,
  nhiTrustBundle,
  signCanonical,
  signEnvelope,
  type H2AActorRegistration,
  type H2AActorRef,
  type H2AEnvelope,
  type H2AJournalPayload,
  type H2ANegotiationRecord,
  type H2ARole,
  type H2AConnectionConfidence,
  type H2ASession,
  type H2ASessionInterests,
  type H2ASessionNotificationTopic,
  type H2ASessionState,
  type H2AWorkspaceRef
} from "@sentropic/h2a";

function mcpReadMachineId(): string {
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(p, "utf8").trim();
      if (id.length > 0) return id;
    } catch { /* try next */ }
  }
  return hostname() || "unknown-machine";
}

import {
  listBlockages,
  raiseBlockage,
  resolveBlockage
} from "../blockage/registry.js";
import { conductorFor } from "../governance/conductor.js";
import { appendConductorClaim } from "../governance/claims.js";
import { conductorLaunchCheck } from "../governance/launch-check.js";
import { canonicalAddress, isHostQualifiedAddress, listPresence, resolveRecipient, writePresence } from "../local-files/index.js";
import { createLocalStore } from "../local-files/store.js";
import type { LocalStore } from "../local-files/store.js";
import { lastSpawnRequestAt, recordSpawnRequest, spawnAllowed } from "../governance/spawns.js";
import { gatherNhiSnapshot } from "../nhi.js";
import { agentVersion } from "../version/agent-version.js";
import type { SessionRegistry } from "./sessions.js";
import {
  createObjectiveLoop,
  declareObjectiveLoopDone,
  joinObjectiveLoop,
  listLoopEvents,
  listObjectiveLoops,
  readObjectiveLoop,
  reportObjectiveLoop,
  stopObjectiveLoop,
  validateLoopLaunchSpec,
  type H2ALoopLaunchSpec
} from "../loop/index.js";

export interface McpToolResult {
  [key: string]: unknown;
}

export interface McpErrorResult {
  error: string;
}

const ESCALATION_CHANNELS = new Set(["advise", "decide", "alert"]);

function safeError(reason: unknown): McpErrorResult {
  if (reason instanceof Error) return { error: reason.message };
  return { error: String(reason) };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function handleRegisterInstance(
  store: LocalStore,
  args: { registration?: H2AActorRegistration } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.registration !== "object" || args.registration === null) {
    return { error: "h2a_register_instance: missing 'registration' object" };
  }
  try {
    store.registerInstance(args.registration);
    return { ok: true, instance: args.registration.id };
  } catch (err) {
    return safeError(err);
  }
}

// ---------------------------------------------------------------------------
// WP-F (presence-honesty): connection-confidence helpers — ADVISORY surfacing
// only; nothing here gates routing (that change is parked).
// ---------------------------------------------------------------------------

/** Clock-skew margin (ms) for a mirrored session's cross-machine timestamp. */
const ACTIVITY_SKEW_MARGIN_MS = 120_000;

/** Activity window (ms): `H2A_ACTIVITY_WINDOW_MS` env override, else the default. */
function activityWindowMs(): number {
  const raw = process.env.H2A_ACTIVITY_WINDOW_MS;
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return H2A_ACTIVITY_WINDOW_DEFAULT_MS;
}

/** Confidence of one session, adding a skew margin for mirrored records. */
function confidenceOf(session: H2ASession, now: number): H2AConnectionConfidence {
  return deriveConnectionConfidence(session, {
    now,
    activityWindowMs: activityWindowMs(),
    ...(session.mirroredAt ? { skewMarginMs: ACTIVITY_SKEW_MARGIN_MS } : {})
  });
}

/** Best confidence across sessions: active > idle-uncertain > unknown. */
function bestConfidence(
  sessions: readonly H2ASession[],
  now: number
): H2AConnectionConfidence | undefined {
  if (sessions.length === 0) return undefined;
  const set = new Set(sessions.map((s) => confidenceOf(s, now)));
  if (set.has("active")) return "active";
  if (set.has("idle-uncertain")) return "idle-uncertain";
  return "unknown";
}

export function handleDiscoverInstances(
  store: LocalStore,
  args: { role?: H2ARole; scope?: string } | undefined
): McpToolResult | McpErrorResult {
  try {
    let instances = store.listInstances();
    // DEC-110: gate discovery on the effective org view (registration ∪
    // provisioned membership grants), matching the CLI `discover` verb.
    const effective = effectiveOrgInstances(instances, store.listOrgMembership());
    const effByInstance = new Map(effective.map((e) => [e.instance, e]));
    if (args?.role) {
      const wanted = args.role;
      instances = instances.filter((reg) => effByInstance.get(reg.instance)?.roles.includes(wanted));
    }
    if (args?.scope) {
      const wanted = args.scope;
      instances = instances.filter((reg) => effByInstance.get(reg.instance)?.scopes.includes(wanted));
    }
    return { instances };
  } catch (err) {
    return safeError(err);
  }
}

export function handleInbox(
  store: LocalStore,
  args:
    | {
        action?: "read" | "put" | "pop";
        instance?: string;
        envelope?: H2AEnvelope;
        envelopeId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_inbox: missing 'instance'" };
  }
  // Narrowed once here so the type survives into the filter closures below.
  const instance: string = args.instance;
  try {
    switch (args.action) {
      case "read":
        return { envelopes: store.readInbox(args.instance) };
      case "put": {
        if (!args.envelope) return { error: "h2a_inbox put: missing 'envelope'" };
        if (!isHostQualifiedAddress(args.instance)) {
          return {
            error: `h2a: recipient "${args.instance}" is not host-qualified — address it as <host>:<label> (e.g. claude:${String(args.instance).replace(/^:+/, "") || "agent"}). A bare label is ambiguous (the same label can exist on several hosts) and routes to an orphan inbox nobody reads. Resolve the exact peer via discover.`
          };
        }
        // WP-2: resolve-before-send legibility gate (does NOT change destination).
        {
          const liveSessions = listPresence(store.paths.root).map((s) => s.instance);
          const registeredIds = store.listInstances().map((i) => i.instance ?? i.id);
          const resolution = resolveRecipient({
            target: args.instance,
            liveInstances: liveSessions,
            registeredInstances: registeredIds
          });
          if (resolution.kind === "refuse") {
            return {
              error: resolution.reason,
              ...(resolution.candidates ? { candidates: resolution.candidates } : {})
            };
          }
          // deliver / deliver-dormant / deliver-hint → proceed with put.
        }
        store.putInboxMessage(args.instance, args.envelope);
        // Bug-2 backstop: report whether the recipient actually has a fresh
        // session. The write always succeeds (a dormant deposit-for-wake is
        // legitimate), but the caller must know live vs dormant rather than
        // assuming delivery. Exact-instance match — a live agent is addressed by
        // its full perennial id; the bare channel/alias form reads as dormant.
        const allFresh = listPresence(store.paths.root);
        const matchingFresh = allFresh.filter(
          (s) => canonicalAddress(s.instance) === canonicalAddress(instance)
        );
        const freshSessions = matchingFresh.length;
        // WP-F: honest at-send connection confidence for the recipient —
        // recipientLive is heartbeat-based (which the keepalive prober can also
        // refresh); recipientConfidence reflects ACTUAL MCP-channel traffic, so
        // an "idle-uncertain" recipient may be silently disconnected even while
        // recipientLive is true. Advisory — the put still delivers (dormant
        // deposit-for-wake stays legitimate).
        const recipientConfidence = bestConfidence(matchingFresh, Date.now());
        // WP-2: enrich return with resolution metadata.
        const liveSessions2 = allFresh.map((s) => s.instance);
        const registeredIds2 = store.listInstances().map((i) => i.instance ?? i.id);
        const resolution2 = resolveRecipient({
          target: args.instance,
          liveInstances: liveSessions2,
          registeredInstances: registeredIds2
        });
        return {
          ok: true,
          envelopeId: args.envelope.id,
          recipientLive: freshSessions > 0,
          freshSessions,
          ...(recipientConfidence ? { recipientConfidence } : {}),
          resolution: resolution2.kind,
          ...(resolution2.kind === "deliver-hint" ? { liveCandidate: resolution2.liveCandidate, reason: resolution2.reason } : {}),
          ...(resolution2.kind === "deliver-dormant" ? { reason: resolution2.reason, dormant: true } : {})
        };
      }
      case "pop": {
        if (typeof args.envelopeId !== "string" || args.envelopeId.length === 0) {
          return { error: "h2a_inbox pop: missing 'envelopeId'" };
        }
        const envelope = store.popInboxMessage(args.instance, args.envelopeId);
        if (!envelope) {
          return { error: `h2a_inbox pop: no envelope ${args.envelopeId} for ${args.instance}` };
        }
        return { envelope };
      }
      default:
        return {
          error: `h2a_inbox: unknown action '${String(args.action)}', expected read|put|pop`
        };
    }
  } catch (err) {
    return safeError(err);
  }
}

export function handleAppendJournal(
  store: LocalStore,
  args: { negotiationId?: string; payload?: H2AJournalPayload<unknown> } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_append_journal: missing 'negotiationId'" };
  }
  if (!args.payload || typeof args.payload !== "object") {
    return { error: "h2a_append_journal: missing 'payload'" };
  }
  try {
    const entry = store.appendNegotiationEvent(args.negotiationId, args.payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleOpenNegotiation(
  store: LocalStore,
  args: { record?: H2ANegotiationRecord } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.record !== "object" || args.record === null) {
    return { error: "h2a_open_negotiation: missing 'record' object" };
  }
  try {
    const persisted = store.openNegotiation(args.record);
    return { record: persisted };
  } catch (err) {
    return safeError(err);
  }
}

interface OfferLikeArgs {
  negotiationId?: string;
  instance?: string;
  artifact?: unknown;
  eventId?: string;
  causationId?: string;
  correlationId?: string;
}

/**
 * Resolve causation/correlation for an MCP-driven journal append, mirroring
 * the CLI semantics (DEC-033): explicit args always win, otherwise inherit
 * from the previous journal entry — `causationId` defaults to the previous
 * entry's `id`, `correlationId` is propagated as-is.
 */
function resolveChain(
  store: LocalStore,
  negotiationId: string,
  explicit: { causationId?: string; correlationId?: string }
): { causationId?: string; correlationId?: string } {
  const entries = store.readNegotiationJournal(negotiationId);
  const previous = entries[entries.length - 1] as
    | { id: string; correlationId?: string }
    | undefined;
  const out: { causationId?: string; correlationId?: string } = {};
  if (explicit.causationId) {
    out.causationId = explicit.causationId;
  } else if (previous) {
    out.causationId = previous.id;
  }
  if (explicit.correlationId) {
    out.correlationId = explicit.correlationId;
  } else if (previous && previous.correlationId !== undefined) {
    out.correlationId = previous.correlationId;
  }
  return out;
}

function handleOfferLike(
  store: LocalStore,
  toolName: "h2a_offer" | "h2a_counteroffer",
  args: OfferLikeArgs | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: `${toolName}: missing 'negotiationId'` };
  }
  if (typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: `${toolName}: missing 'instance'` };
  }
  if (args.artifact === undefined) {
    return { error: `${toolName}: missing 'artifact'` };
  }
  const record = store.readNegotiation(args.negotiationId);
  if (!record) {
    return { error: `${toolName}: negotiation ${args.negotiationId} not found` };
  }
  const type = toolName === "h2a_offer" ? "propose" : "counter";
  const chain = resolveChain(store, args.negotiationId, {
    causationId: args.causationId,
    correlationId: args.correlationId
  });
  const payload: H2AJournalPayload<{ artifact: unknown }> = {
    id: args.eventId ?? `evt-${type}-${Date.now().toString(36)}`,
    type,
    actor: { instance: args.instance, role: "CONDUCTOR", scope: record.scope },
    body: { artifact: args.artifact },
    createdAt: nowIso(),
    ...chain
  };
  try {
    const entry = store.appendNegotiationEvent(args.negotiationId, payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleOffer(
  store: LocalStore,
  args: OfferLikeArgs | undefined
): McpToolResult | McpErrorResult {
  return handleOfferLike(store, "h2a_offer", args);
}

export function handleCounteroffer(
  store: LocalStore,
  args: OfferLikeArgs | undefined
): McpToolResult | McpErrorResult {
  return handleOfferLike(store, "h2a_counteroffer", args);
}

export function handleSign(
  store: LocalStore,
  args:
    | {
        negotiationId?: string;
        instance?: string;
        artifact?: unknown;
        privateKeyPem?: string;
        eventId?: string;
        causationId?: string;
        correlationId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_sign: missing 'negotiationId'" };
  }
  if (typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_sign: missing 'instance'" };
  }
  if (args.artifact === undefined) {
    return { error: "h2a_sign: missing 'artifact'" };
  }
  if (typeof args.privateKeyPem !== "string" || args.privateKeyPem.length === 0) {
    return { error: "h2a_sign: missing 'privateKeyPem'" };
  }
  const record = store.readNegotiation(args.negotiationId);
  if (!record) {
    return { error: `h2a_sign: negotiation ${args.negotiationId} not found` };
  }
  try {
    const artifactHash = computeHash(args.artifact);
    const signature = signCanonical(
      { artifactHash },
      { by: args.instance, privateKeyPem: args.privateKeyPem }
    );
    const chain = resolveChain(store, args.negotiationId, {
      causationId: args.causationId,
      correlationId: args.correlationId
    });
    const payload: H2AJournalPayload<{
      kind: "signature";
      artifactHash: string;
      signature: typeof signature;
    }> = {
      id: args.eventId ?? `evt-sign-${Date.now().toString(36)}`,
      type: "event",
      actor: { instance: args.instance, role: "CONDUCTOR", scope: record.scope },
      body: { kind: "signature", artifactHash, signature },
      createdAt: nowIso(),
      ...chain
    };
    const entry = store.appendNegotiationEvent(args.negotiationId, payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleStabilize(
  store: LocalStore,
  args: { negotiationId?: string; eventId?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_stabilize: missing 'negotiationId'" };
  }
  try {
    const result = store.stabilizeNegotiation(args.negotiationId, { eventId: args.eventId });
    return {
      record: result.record,
      artifactHash: result.artifactHash,
      signers: result.signers,
      artifactPath: result.artifactPath,
      advisoryEvents: result.advisoryEvents.map((entry) => ({
        id: entry.id,
        sequence: entry.sequence
      })),
      finalEvent: { id: result.finalEvent.id, sequence: result.finalEvent.sequence }
    };
  } catch (err) {
    return safeError(err);
  }
}

function findRegisteredInstance(
  store: LocalStore,
  instance: string
): H2AActorRegistration | undefined {
  return store.findInstance(instance) ?? store.listInstances().find((entry) => entry.instance === instance);
}

function roleFromArg(value: unknown): H2ARole | undefined {
  if (typeof value !== "string") return undefined;
  return H2A_ROLES.includes(value as H2ARole) ? (value as H2ARole) : undefined;
}

export function handleAttestComprehension(
  store: LocalStore,
  args:
    | {
        negotiationId?: string;
        instance?: string;
        dossier?: unknown;
        dossierHash?: string;
        privateKeyPem?: string;
        role?: string;
        scope?: string;
        eventId?: string;
        at?: string;
        causationId?: string;
        correlationId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_attest_comprehension: missing 'instance'" };
  }
  if (typeof args.privateKeyPem !== "string" || args.privateKeyPem.length === 0) {
    return { error: "h2a_attest_comprehension: missing 'privateKeyPem'" };
  }
  if (args.dossierHash === undefined && args.dossier === undefined) {
    return { error: "h2a_attest_comprehension: missing 'dossierHash' or 'dossier'" };
  }
  const registration = findRegisteredInstance(store, args.instance);
  if (!registration) {
    return { error: `h2a_attest_comprehension: instance ${args.instance} not registered` };
  }
  const record = args.negotiationId ? store.readNegotiation(args.negotiationId) : undefined;
  if (args.negotiationId && !record) {
    return { error: `h2a_attest_comprehension: negotiation ${args.negotiationId} not found` };
  }
  const role = args.role === undefined ? registration.roles[0] : roleFromArg(args.role);
  if (!role) {
    return { error: `h2a_attest_comprehension: unknown or missing role ${String(args.role ?? "")}` };
  }
  const scope = args.scope ?? record?.scope ?? registration.scopes[0];
  if (!scope) {
    return { error: `h2a_attest_comprehension: ${args.instance} has no scope` };
  }
  if (!canAttestComprehension(role, registration.capabilities)) {
    return {
      error: `h2a_attest_comprehension: role ${role} for ${args.instance} cannot attest comprehension; AGENTS require ${H2A_ATTESTER_COMPREHENSION_RIGHT}`
    };
  }

  try {
    const body = buildComprehensionAttestation({
      subject: args.instance,
      dossierHash: args.dossierHash ?? computeHash(args.dossier),
      ...(args.at ? { at: args.at } : {})
    });
    if (
      body.kind !== H2A_COMPREHENSION_ATTESTATION_BODY_KIND ||
      !isComprehensionAttestation(body)
    ) {
      return { error: "h2a_attest_comprehension: invalid comprehension-attestation body" };
    }
    const actor: H2AActorRef = { instance: args.instance, role, scope };
    const signature = signCanonical(body, { by: args.instance, privateKeyPem: args.privateKeyPem });
    if (args.negotiationId) {
      const chain = resolveChain(store, args.negotiationId, {
        causationId: args.causationId,
        correlationId: args.correlationId
      });
      const payload: H2AJournalPayload<typeof body> = {
        id: args.eventId ?? `evt-comprehension-${Date.now().toString(36)}`,
        type: "event",
        actor,
        body,
        signatures: [signature],
        createdAt: body.at,
        ...chain
      };
      const entry = store.appendNegotiationEvent(args.negotiationId, payload);
      return { entry };
    }
    const envelope = createEnvelope({
      id: args.eventId ?? `env-comprehension-${Date.now().toString(36)}`,
      type: "event",
      actor,
      body,
      signatures: [signature],
      createdAt: body.at
    });
    return { envelope };
  } catch (err) {
    return safeError(err);
  }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function handleDeclareConflitInteret(
  store: LocalStore,
  args:
    | {
        negotiationId?: string;
        instance?: string;
        interets?: unknown;
        bindings?: unknown;
        masqueImpactCollectif?: boolean;
        eventId?: string;
        at?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_declare_conflit_interet: missing 'negotiationId'" };
  }
  if (typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_declare_conflit_interet: missing 'instance'" };
  }
  const interets = stringList(args.interets);
  if (!interets || interets.length === 0) {
    return { error: "h2a_declare_conflit_interet: 'interets' must be a non-empty string array" };
  }
  const bindings = args.bindings === undefined ? [] : stringList(args.bindings);
  if (bindings === undefined) {
    return { error: "h2a_declare_conflit_interet: 'bindings' must be a string array when provided" };
  }
  try {
    const entry = store.declareConflitInteret(
      args.negotiationId,
      {
        kind: H2A_DECLARATION_INTERET_BODY_KIND,
        subject: args.instance,
        interets,
        ...(bindings.length > 0 ? { bindings } : {}),
        ...(args.masqueImpactCollectif === true ? { masqueImpactCollectif: true } : {}),
        at: args.at ?? nowIso()
      },
      { eventId: args.eventId }
    );
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleConflictPosture(
  store: LocalStore,
  args: { negotiationId?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_conflict_posture: missing 'negotiationId'" };
  }
  try {
    return {
      negotiationId: args.negotiationId,
      postures: store.derivePosturesConflit(args.negotiationId)
    };
  } catch (err) {
    return safeError(err);
  }
}

export function handleEscalate(
  store: LocalStore,
  args:
    | {
        negotiationId?: string;
        instance?: string;
        channel?: string;
        payload?: unknown;
        causationId?: string;
        correlationId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.negotiationId !== "string" || args.negotiationId.length === 0) {
    return { error: "h2a_escalate: missing 'negotiationId'" };
  }
  if (typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_escalate: missing 'instance'" };
  }
  if (typeof args.channel !== "string" || !ESCALATION_CHANNELS.has(args.channel)) {
    return { error: "h2a_escalate: channel must be advise|decide|alert" };
  }
  const record = store.readNegotiation(args.negotiationId);
  if (!record) {
    return { error: `h2a_escalate: negotiation ${args.negotiationId} not found` };
  }
  const channel = args.channel as "advise" | "decide" | "alert";
  const chain = resolveChain(store, args.negotiationId, {
    causationId: args.causationId,
    correlationId: args.correlationId
  });
  const payload: H2AJournalPayload<{
    kind: "escalation";
    channel: "advise" | "decide" | "alert";
    payload: unknown;
  }> = {
    id: `evt-escalate-${Date.now().toString(36)}`,
    type: "escalate",
    actor: { instance: args.instance, role: "MANDATAIRE", scope: record.scope },
    body: { kind: "escalation", channel, payload: args.payload ?? null },
    createdAt: nowIso(),
    ...chain
  };
  try {
    const entry = store.appendNegotiationEvent(args.negotiationId, payload);
    return { entry };
  } catch (err) {
    return safeError(err);
  }
}

export function handleSessionOpen(
  sessions: SessionRegistry,
  args:
    | {
        instance?: string;
        host?: string;
        workspace?: H2AWorkspaceRef;
        name?: string;
        pid?: number;
        interests?: Partial<H2ASessionInterests>;
        subscribedTopics?: readonly string[];
        sessionId?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_session_open: missing 'instance'" };
  }
  if (
    args.subscribedTopics !== undefined &&
    (!Array.isArray(args.subscribedTopics) ||
      args.subscribedTopics.some(
        (topic) =>
          typeof topic !== "string" ||
          !(H2A_SESSION_NOTIFICATION_TOPICS as readonly string[]).includes(topic)
      ))
  ) {
    return {
      error:
        "h2a_session_open: 'subscribedTopics' must be a subset of the canonical topic list"
    };
  }
  try {
    const session = sessions.open({
      instance: args.instance,
      ...(args.host !== undefined ? { host: args.host } : {}),
      ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
      ...(args.name !== undefined ? { name: args.name } : {}),
      version: agentVersion(typeof args.host === "string" ? args.host : undefined),
      ...(args.pid !== undefined ? { pid: args.pid } : {}),
      ...(args.interests !== undefined ? { interests: args.interests } : {}),
      ...(args.subscribedTopics !== undefined
        ? {
            subscribedTopics: args.subscribedTopics as readonly H2ASessionNotificationTopic[]
          }
        : {}),
      ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {})
    });
    const peers = sessions
      .scanFresh()
      .filter((peer) => peer.sessionId !== session.sessionId);
    return { session, peers };
  } catch (err) {
    return safeError(err);
  }
}

export function handleSessionClose(
  sessions: SessionRegistry,
  args: { sessionId?: string; state?: H2ASessionState } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.sessionId !== "string" || args.sessionId.length === 0) {
    return { error: "h2a_session_close: missing 'sessionId'" };
  }
  if (
    args.state !== undefined &&
    !H2A_SESSION_STATES.includes(args.state)
  ) {
    return {
      error: `h2a_session_close: unknown state '${String(args.state)}'`
    };
  }
  try {
    const closed = sessions.close(args.sessionId, args.state ?? "closed");
    return { ok: true, sessionId: args.sessionId, session: closed };
  } catch (err) {
    return safeError(err);
  }
}

export function handleDiscoverSessions(
  sessions: SessionRegistry,
  args: { scope?: string; instance?: string; name?: string } | undefined
): McpToolResult | McpErrorResult {
  try {
    let fresh = sessions.scanFresh();
    if (args?.scope) {
      const wanted = args.scope;
      fresh = fresh.filter((session) =>
        session.interests.scopes.includes(wanted)
      );
    }
    if (args?.instance) {
      const wanted = args.instance;
      fresh = fresh.filter((session) => session.instance === wanted);
    }
    if (args?.name && typeof args.name === "string" && args.name.length > 0) {
      const needle = args.name.toLowerCase();
      fresh = fresh.filter(
        (session) =>
          typeof session.name === "string" &&
          session.name.toLowerCase().includes(needle)
      );
    }
    // WP-F: surface connection-confidence per session (advisory). "active" =
    // the MCP channel carried traffic within the window; "idle-uncertain" =
    // process alive but channel silent (idle OR silently disconnected);
    // "unknown" = legacy/mirrored record with no activity stamp.
    const now = Date.now();
    const enriched = fresh.map((session) => ({
      ...session,
      connectionConfidence: confidenceOf(session, now)
    }));
    return { sessions: enriched };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-087: NHI posture over the registry. Mirrors `h2a nhi report` — same
// snapshot gatherer + core `auditNhiPosture`, so CLI and MCP agree.
export function handleNhiReport(
  store: LocalStore,
  args: { longLivedKeyMaxDays?: number } | undefined
): McpToolResult | McpErrorResult {
  try {
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({
      instances,
      subagents,
      keyEvents,
      ...(typeof args?.longLivedKeyMaxDays === "number"
        ? { longLivedKeyMaxDays: args.longLivedKeyMaxDays }
        : {})
    });
    return { report };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-090 (P2): per-identity inventory of the estate. Same snapshot gatherer.
export function handleNhiInventory(
  store: LocalStore,
  args: { longLivedKeyMaxDays?: number } | undefined
): McpToolResult | McpErrorResult {
  try {
    const { instances, subagents, keyEvents, offboards } = gatherNhiSnapshot(store);
    const inventory = nhiInventory({
      instances,
      subagents,
      keyEvents,
      offboards,
      ...(typeof args?.longLivedKeyMaxDays === "number"
        ? { longLivedKeyMaxDays: args.longLivedKeyMaxDays }
        : {})
    });
    return { inventory };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-087 (P1b): sign the current posture into an attestation envelope. Same
// snapshot + classifier + envelope builder as `h2a nhi attest`.
export function handleNhiAttest(
  store: LocalStore,
  args:
    | {
        instance?: string;
        privateKeyPem?: string;
        role?: string;
        scope?: string;
        longLivedKeyMaxDays?: number;
      }
    | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_nhi_attest: missing 'instance'" };
  }
  if (typeof args.privateKeyPem !== "string" || args.privateKeyPem.length === 0) {
    return { error: "h2a_nhi_attest: missing 'privateKeyPem'" };
  }
  try {
    const registration = store.findInstance(args.instance);
    const role = args.role ?? registration?.roles?.[0];
    const scope = args.scope ?? registration?.scopes?.[0];
    if (!role || !scope) {
      return {
        error: `h2a_nhi_attest: cannot resolve actor for "${args.instance}" — register it first, or pass role and scope`
      };
    }
    if (!(H2A_ROLES as readonly string[]).includes(role)) {
      return { error: `h2a_nhi_attest: invalid role "${role}"` };
    }
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({
      instances,
      subagents,
      keyEvents,
      ...(typeof args.longLivedKeyMaxDays === "number"
        ? { longLivedKeyMaxDays: args.longLivedKeyMaxDays }
        : {})
    });
    const envelope = nhiAttestationEnvelope({
      report,
      actor: { instance: args.instance, role: role as H2ARole, scope }
    });
    const attestation = signEnvelope(envelope, {
      by: args.instance,
      privateKeyPem: args.privateKeyPem
    });
    return { attestation };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-089 (P1c): coordinated decommission — revoke keys + subagents + tombstone.
export function handleNhiOffboard(
  store: LocalStore,
  args: { instance?: string; reason?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_nhi_offboard: missing 'instance'" };
  }
  try {
    const tombstone = store.offboardInstance(args.instance, args.reason);
    return { tombstone };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-094 (NHI P3): SPIFFE-trust-bundle export of an instance's active keys.
export function handleNhiExport(
  store: LocalStore,
  args: { instance?: string; trustDomain?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_nhi_export: missing 'instance'" };
  }
  if (typeof args.trustDomain !== "string" || args.trustDomain.length === 0) {
    return { error: "h2a_nhi_export: missing 'trustDomain'" };
  }
  try {
    const bundle = nhiTrustBundle({
      instance: args.instance,
      trustDomain: args.trustDomain,
      activeKeys: store.listInstanceKeys(args.instance)
    });
    return { bundle };
  } catch (err) {
    return safeError(err);
  }
}

// DEC-092 (EVO-3): blockage feedback loop. The dispatcher turns the registry
// changes these write into peer.blocked/peer.unblocked pushes.
export function handleBlockageRaise(
  store: LocalStore,
  args: { instance?: string; reason?: string; scope?: string; needs?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_blockage_raise: missing 'instance'" };
  }
  if (typeof args.reason !== "string" || args.reason.length === 0) {
    return { error: "h2a_blockage_raise: missing 'reason'" };
  }
  try {
    const blockage = raiseBlockage(store.paths.root, {
      instance: args.instance,
      scope: typeof args.scope === "string" ? args.scope : "",
      reason: args.reason,
      ...(typeof args.needs === "string" ? { needs: args.needs } : {})
    });
    return { blockage };
  } catch (err) {
    return safeError(err);
  }
}

export function handleBlockageList(
  store: LocalStore,
  args: { scope?: string; active?: boolean } | undefined
): McpToolResult | McpErrorResult {
  try {
    let blockages = listBlockages(store.paths.root);
    if (typeof args?.scope === "string") blockages = blockages.filter((b) => b.scope === args.scope);
    if (args?.active === true) blockages = blockages.filter((b) => b.resolvedAt === undefined);
    return { blockages };
  } catch (err) {
    return safeError(err);
  }
}

export function handleBlockageResolve(
  store: LocalStore,
  args: { instance?: string; by?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_blockage_resolve: missing 'instance'" };
  }
  try {
    const resolved = resolveBlockage(
      store.paths.root,
      args.instance,
      typeof args.by === "string" ? { by: args.by } : {}
    );
    if (!resolved) {
      return { error: `h2a_blockage_resolve: no blockage recorded for "${args.instance}"` };
    }
    return { blockage: resolved };
  } catch (err) {
    return safeError(err);
  }
}

/**
 * h2a_conductor — resolve the live conductor/owner of a workspace (WP-G1).
 * Mirrors `h2a conductor` CLI. Read-only.
 */
export function handleConductor(
  root: string,
  args: { workspaceId?: string; workspacePath?: string } | undefined
): McpToolResult | McpErrorResult {
  let workspaceId: string | undefined;

  if (typeof args?.workspaceId === "string" && args.workspaceId.length > 0) {
    workspaceId = args.workspaceId;
  } else if (typeof args?.workspacePath === "string" && args.workspacePath.length > 0) {
    let realPath = args.workspacePath;
    try { realPath = realpathSync(realPath); } catch { /* use as-is */ }
    workspaceId = deriveWorkspaceId({ machineId: mcpReadMachineId(), path: realPath });
  }

  if (!workspaceId) {
    return { error: "h2a_conductor: provide workspaceId or workspacePath" };
  }

  try {
    const result = conductorFor({ root, workspaceId });
    return result as unknown as McpToolResult;
  } catch (err) {
    return safeError(err);
  }
}

/**
 * h2a_conductor_claim — append a conductor claim for (workspaceId, instance)
 * and return the post-claim conductorFor resolution (WP-G1b).
 */
export function handleConductorClaim(
  root: string,
  args: { instance?: string; workspaceId?: string; workspacePath?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_conductor_claim: missing 'instance'" };
  }

  let workspaceId: string | undefined;
  if (typeof args.workspaceId === "string" && args.workspaceId.length > 0) {
    workspaceId = args.workspaceId;
  } else if (typeof args.workspacePath === "string" && args.workspacePath.length > 0) {
    let realPath = args.workspacePath;
    try { realPath = realpathSync(realPath); } catch { /* use as-is */ }
    workspaceId = deriveWorkspaceId({ machineId: mcpReadMachineId(), path: realPath });
  }

  if (!workspaceId) {
    return { error: "h2a_conductor_claim: provide workspaceId or workspacePath" };
  }

  try {
    appendConductorClaim(root, {
      type: "claim",
      workspaceId,
      instance: args.instance,
      at: new Date().toISOString()
    });
    const result = conductorFor({ root, workspaceId });
    return result as unknown as McpToolResult;
  } catch (err) {
    return safeError(err);
  }
}

/**
 * h2a_conductor_release — append a conductor release for (workspaceId, instance)
 * and return the post-release conductorFor resolution (WP-G1b).
 */
export function handleConductorRelease(
  root: string,
  args: { instance?: string; workspaceId?: string; workspacePath?: string } | undefined
): McpToolResult | McpErrorResult {
  if (!args || typeof args.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_conductor_release: missing 'instance'" };
  }

  let workspaceId: string | undefined;
  if (typeof args.workspaceId === "string" && args.workspaceId.length > 0) {
    workspaceId = args.workspaceId;
  } else if (typeof args.workspacePath === "string" && args.workspacePath.length > 0) {
    let realPath = args.workspacePath;
    try { realPath = realpathSync(realPath); } catch { /* use as-is */ }
    workspaceId = deriveWorkspaceId({ machineId: mcpReadMachineId(), path: realPath });
  }

  if (!workspaceId) {
    return { error: "h2a_conductor_release: provide workspaceId or workspacePath" };
  }

  try {
    appendConductorClaim(root, {
      type: "release",
      workspaceId,
      instance: args.instance,
      at: new Date().toISOString()
    });
    const result = conductorFor({ root, workspaceId });
    return result as unknown as McpToolResult;
  } catch (err) {
    return safeError(err);
  }
}

/**
 * h2a_conductor_launch_check — DRY-RUN conductor launch recommendation (D3).
 *
 * Polls `track workspace-activity` and returns a recommendation to launch a
 * conductor if work is durably stalled and no conductor is live.
 * h2a does NOT spawn anything. This is advisory only; the launch is parked
 * pending a spawn policy and remote-trigger support.
 */
export function handleConductorLaunchCheck(
  root: string,
  args: { workspaceId?: string; workspacePath?: string; idleMs?: number } | undefined
): McpToolResult | McpErrorResult {
  let workspaceId: string | undefined;

  if (typeof args?.workspaceId === "string" && args.workspaceId.length > 0) {
    workspaceId = args.workspaceId;
  } else if (typeof args?.workspacePath === "string" && args.workspacePath.length > 0) {
    let realPath = args.workspacePath;
    try { realPath = realpathSync(realPath); } catch { /* use as-is */ }
    workspaceId = deriveWorkspaceId({ machineId: mcpReadMachineId(), path: realPath });
  }

  if (!workspaceId) {
    return { error: "h2a_conductor_launch_check: provide workspaceId or workspacePath" };
  }

  let idleMs: number | undefined;
  if (args?.idleMs !== undefined) {
    const parsed = Number(args.idleMs);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: `h2a_conductor_launch_check: idleMs must be a positive number (got ${args.idleMs})` };
    }
    idleMs = parsed;
  }

  try {
    const result = conductorLaunchCheck({ root, workspaceId, ...(idleMs !== undefined ? { idleMs } : {}) });
    return result as unknown as McpToolResult;
  } catch (err) {
    return safeError(err);
  }
}

/**
 * h2a_conductor_launch — D3 EMISSION: emit a conductor-launch-request envelope
 * to a live remote agent when work is stalled and no conductor is live.
 *
 * Gated by --confirm (boolean) and a 1/30min/workspace cap.
 * h2a NEVER spawns a process — it only puts a request envelope to remote.
 */
export function handleConductorLaunch(
  root: string,
  args:
    | {
        workspaceId?: string;
        workspacePath?: string;
        idleMs?: number;
        confirm?: boolean;
        remote?: string;
        instance?: string;
      }
    | undefined
): McpToolResult | McpErrorResult {
  // Resolve workspace id (mirrors handleConductorLaunchCheck)
  let workspaceId: string | undefined;
  if (typeof args?.workspaceId === "string" && args.workspaceId.length > 0) {
    workspaceId = args.workspaceId;
  } else if (typeof args?.workspacePath === "string" && args.workspacePath.length > 0) {
    let realPath = args.workspacePath;
    try { realPath = realpathSync(realPath); } catch { /* use as-is */ }
    workspaceId = deriveWorkspaceId({ machineId: mcpReadMachineId(), path: realPath });
  }

  if (!workspaceId) {
    return { error: "h2a_conductor_launch: provide workspaceId or workspacePath" };
  }

  let idleMs: number | undefined;
  if (args?.idleMs !== undefined) {
    const parsed = Number(args.idleMs);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: `h2a_conductor_launch: idleMs must be a positive number (got ${args.idleMs})` };
    }
    idleMs = parsed;
  }

  // 1. Compute the launch recommendation.
  const check = conductorLaunchCheck({
    root,
    workspaceId,
    ...(idleMs !== undefined ? { idleMs } : {})
  });

  if (check.recommendation !== "launch") {
    return { action: "none", ...check } as McpToolResult;
  }

  // 2. Cooldown gate.
  const last = lastSpawnRequestAt(root, workspaceId);
  if (!spawnAllowed({ lastSpawnAt: last, now: Date.now() })) {
    return {
      action: "cooldown",
      reason: "a launch request was emitted < 30min ago for this workspace",
      lastSpawnAt: last
    };
  }

  // 3. Build request object.
  const request = {
    kind: "conductor-launch-request" as const,
    workspaceId,
    hostPref: ["claude", "codex", "agy"],
    stalled: check.stalled,
    reason: check.reason
  };

  // 4. Without confirm → preview only.
  if (!args?.confirm) {
    return {
      action: "would-emit",
      request,
      note: "DRY-RUN — pass confirm:true to emit this launch request to remote (h2a never spawns; remote does)"
    };
  }

  // 5. confirm=true: instance required.
  if (typeof args?.instance !== "string" || args.instance.length === 0) {
    return { error: "h2a_conductor_launch: 'instance' (self/sender) is required when confirm=true" };
  }
  const selfInstance = args.instance;

  // 6. Resolve remote instance.
  let remoteInstance: string;
  if (typeof args.remote === "string" && args.remote.length > 0) {
    remoteInstance = args.remote;
  } else {
    const sessions = listPresence(root);
    const remoteSessions = sessions.filter(
      (s) => s.host === "remote" || (s.instance && s.instance.startsWith("remote:"))
    );
    if (remoteSessions.length === 0) {
      return {
        action: "no-remote",
        reason: "no live remote agent to receive the launch request"
      };
    }
    const withPane = remoteSessions.filter((s) => s.launchContext?.tmux?.pane);
    const chosen = withPane.length > 0 ? withPane[0] : remoteSessions[0];
    remoteInstance = chosen.instance;
  }

  // 7. Compose envelope and deliver.
  const store = createLocalStore({ root });
  const envelope = createEnvelope({
    id: `env-conductor-launch-${Date.now().toString(36)}`,
    type: "event" as const,
    actor: { instance: selfInstance, role: "CONDUCTOR" as const, scope: "scope:default" },
    target: { instance: remoteInstance },
    body: {
      kind: "message" as const,
      topic: "conductor-launch-request",
      text: `Conductor-launch request for workspace ${workspaceId}: ${check.reason}`,
      request
    },
    createdAt: nowIso()
  });

  try {
    store.putInboxMessage(remoteInstance, envelope);
  } catch (err) {
    return safeError(err);
  }

  // 8. Record spawn marker.
  recordSpawnRequest(root, {
    workspaceId,
    at: nowIso(),
    to: remoteInstance
  });

  return { action: "emitted", to: remoteInstance, request };
}

export function notImplemented(toolName: string): McpErrorResult {
  return { error: `${toolName}: not implemented in this slice` };
}

export function handleLoopCreate(
  root: string,
  args: {
    id?: string;
    name?: string;
    goal?: string;
    instance?: string;
    agentId?: string;
    role?: string;
    required?: boolean;
    allowEmpty?: boolean;
    launch?: unknown;
  } | undefined
): McpToolResult | McpErrorResult {
  if (typeof args?.goal !== "string" || args.goal.length === 0) return { error: "h2a_loop_create: goal is required" };
  if ((typeof args.instance !== "string" || args.instance.length === 0) && args.allowEmpty !== true) {
    return { error: "h2a_loop_create: explicit instance is required; use allowEmpty:true only for intentional staged orchestration" };
  }
  try {
    const launch: H2ALoopLaunchSpec | undefined = args.launch === undefined
      ? undefined
      : validateLoopLaunchSpec(args.launch);
    if (launch !== undefined && (typeof args.instance !== "string" || args.instance.length === 0)) {
      return { error: "h2a_loop_create: launch requires an explicit initial instance" };
    }
    let loop = createObjectiveLoop(root, { ...(args.id ? { id: args.id } : {}), ...(args.name ? { name: args.name } : {}), goal: args.goal });
    if (typeof args.instance === "string" && args.instance.length > 0) {
      loop = joinObjectiveLoop(root, loop.id, {
        instance: args.instance,
        ...(args.agentId ? { agentId: args.agentId } : {}),
        role: args.role ?? "conductor",
        required: args.required ?? true,
        ...(launch !== undefined ? { launch } : {})
      });
    }
    return { kind: "loop-created", version: 1, loop };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function handleLoopJoin(
  root: string,
  args: { loopId?: string; instance?: string; agentId?: string; role?: string; required?: boolean; launch?: unknown } | undefined
): McpToolResult | McpErrorResult {
  if (typeof args?.loopId !== "string" || args.loopId.length === 0) return { error: "h2a_loop_join: loopId is required" };
  if (typeof args.instance !== "string" || args.instance.length === 0) return { error: "h2a_loop_join: instance is required" };
  try {
    const launch = args.launch === undefined ? undefined : validateLoopLaunchSpec(args.launch);
    const loop = joinObjectiveLoop(root, args.loopId, {
      instance: args.instance,
      ...(args.agentId ? { agentId: args.agentId } : {}),
      ...(args.role ? { role: args.role } : {}),
      ...(typeof args.required === "boolean" ? { required: args.required } : {}),
      ...(launch !== undefined ? { launch } : {})
    });
    return { kind: "loop-joined", version: 1, loop };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function handleLoopReport(
  root: string,
  args: { loopId?: string; instance?: string; agentId?: string; note?: string; autoJoin?: boolean } | undefined
): McpToolResult | McpErrorResult {
  if (typeof args?.loopId !== "string" || args.loopId.length === 0) return { error: "h2a_loop_report: loopId is required" };
  if (typeof args.note !== "string" || args.note.length === 0) return { error: "h2a_loop_report: note is required" };
  try {
    const loop = reportObjectiveLoop(root, args.loopId, {
      ...(args.instance ? { instance: args.instance } : {}),
      ...(args.agentId ? { agentId: args.agentId } : {}),
      ...(args.autoJoin === true ? { autoJoin: true } : {}),
      note: args.note
    });
    return { kind: "loop-reported", version: 1, loop };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function handleLoopDone(
  root: string,
  args: { loopId?: string; instance?: string; agentId?: string; note?: string; overrideRefs?: boolean } | undefined
): McpToolResult | McpErrorResult {
  if (typeof args?.loopId !== "string" || args.loopId.length === 0) return { error: "h2a_loop_done: loopId is required" };
  if (args.overrideRefs === true) return { error: "h2a_loop_done: overrideRefs is CLI-only and requires human confirmation" };
  try {
    const loop = declareObjectiveLoopDone(root, args.loopId, { ...(args.instance ? { instance: args.instance } : {}), ...(args.agentId ? { agentId: args.agentId } : {}), ...(args.note ? { note: args.note } : {}) });
    return { kind: "loop-done-declared", version: 1, loop };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function handleLoopStop(
  root: string,
  args: { loopId?: string; reason?: string } | undefined
): McpToolResult | McpErrorResult {
  if (typeof args?.loopId !== "string" || args.loopId.length === 0) return { error: "h2a_loop_stop: loopId is required" };
  try {
    const loop = stopObjectiveLoop(root, args.loopId, { ...(args.reason ? { reason: args.reason } : {}) });
    return { kind: "loop-stopped", version: 1, loop };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * h2a_loop_list — read-only projection of the objective loops in the local store.
 */
export function handleLoopList(root: string): McpToolResult {
  const loops = listObjectiveLoops(root).map((l) => ({
    id: l.id,
    name: l.name,
    goal: l.goal,
    status: l.status,
    refs: l.refs.length,
    agents: l.agents.length,
    updatedAt: l.updatedAt
  }));
  return { kind: "loop-list", version: 1, loops };
}

/**
 * h2a_loop_status — one loop's full state + its LAST recorded tick observation
 * (from the journal) + recent events. Read-only; a fresh live plan needs the
 * async `h2a loop tick` CLI (agents/refs/inbox gathering).
 */
export function handleLoopStatus(
  root: string,
  args: { loopId?: string } | undefined
): McpToolResult | McpErrorResult {
  if (typeof args?.loopId !== "string" || args.loopId.length === 0) {
    return { error: "h2a_loop_status: loopId is required" };
  }
  let loop;
  try {
    loop = readObjectiveLoop(root, args.loopId);
  } catch (err) {
    return { error: (err as Error).message };
  }
  const events = listLoopEvents(root, args.loopId);
  const lastTick = [...events].reverse().find((e) => e.type === "loop.tick");
  return {
    kind: "loop-status",
    version: 1,
    loop,
    ...(lastTick ? { lastTick: lastTick.payload } : {}),
    recentEvents: events.slice(-10)
  };
}
