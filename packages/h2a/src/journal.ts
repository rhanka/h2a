import { canonicalize, computeHash } from "./canonical.js";
import {
  H2A_PROTOCOL,
  H2A_VERSION,
  type H2AActorRef,
  type H2AEnvelopeType,
  type H2ASignature
} from "./types.js";

export interface H2AJournalPayload<TBody = unknown> {
  id: string;
  type: H2AEnvelopeType;
  actor: H2AActorRef;
  body: TBody;
  createdAt: string;
  target?: Partial<H2AActorRef>;
  artifactKind?: string;
  contractId?: string;
  engagementId?: string;
  negotiationId?: string;
  policyIds?: string[];
  baseArtifactHash?: string;
  causationId?: string;
  correlationId?: string;
  signatures?: H2ASignature[];
}

export interface H2AJournalEntry<TBody = unknown> extends H2AJournalPayload<TBody> {
  protocol: typeof H2A_PROTOCOL;
  version: typeof H2A_VERSION;
  sequence: number;
  prevHash?: string;
  contentHash: string;
}

function stripFrame<TBody>(entry: H2AJournalEntry<TBody>): H2AJournalPayload<TBody> {
  const {
    protocol,
    version,
    sequence,
    prevHash,
    contentHash,
    ...payload
  } = entry;
  void protocol;
  void version;
  void sequence;
  void prevHash;
  void contentHash;
  return payload as H2AJournalPayload<TBody>;
}

export function createJournalEntry<TBody>(
  payload: H2AJournalPayload<TBody>
): H2AJournalEntry<TBody> {
  const contentHash = computeHash(payload);
  return {
    protocol: H2A_PROTOCOL,
    version: H2A_VERSION,
    sequence: 0,
    contentHash,
    ...payload
  };
}

export function appendJournalEntry<TBody>(
  previous: H2AJournalEntry<unknown>,
  payload: H2AJournalPayload<TBody>
): H2AJournalEntry<TBody> {
  return {
    protocol: H2A_PROTOCOL,
    version: H2A_VERSION,
    sequence: previous.sequence + 1,
    prevHash: previous.contentHash,
    contentHash: computeHash(payload),
    ...payload
  };
}

export type H2AJournalVerification =
  | { ok: true }
  | { ok: false; index: number; reason: string };

export function verifyJournalChain(
  entries: ReadonlyArray<H2AJournalEntry<unknown>>
): H2AJournalVerification {
  let prev: H2AJournalEntry<unknown> | undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.protocol !== H2A_PROTOCOL) {
      return { ok: false, index: i, reason: `bad protocol: ${entry.protocol}` };
    }
    if (entry.version !== H2A_VERSION) {
      return { ok: false, index: i, reason: `bad version: ${entry.version}` };
    }

    const expectedSequence = prev ? prev.sequence + 1 : 0;
    if (entry.sequence !== expectedSequence) {
      return {
        ok: false,
        index: i,
        reason: `bad sequence: expected ${expectedSequence}, got ${entry.sequence}`
      };
    }

    const expectedPrev = prev ? prev.contentHash : undefined;
    if (entry.prevHash !== expectedPrev) {
      return {
        ok: false,
        index: i,
        reason: `bad prevHash: expected ${expectedPrev ?? "<none>"}, got ${entry.prevHash ?? "<none>"}`
      };
    }

    const expectedHash = computeHash(stripFrame(entry));
    if (entry.contentHash !== expectedHash) {
      return {
        ok: false,
        index: i,
        reason: `bad contentHash: expected ${expectedHash}, got ${entry.contentHash}`
      };
    }

    prev = entry;
  }

  return { ok: true };
}

export function journalEntryAsCanonicalString(
  entry: H2AJournalEntry<unknown>
): string {
  return canonicalize(entry);
}
