import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

import {
  appendJournalEntry,
  assertValidNegotiationState,
  createJournalEntry,
  isH2AEnvelope,
  verifyJournalChain,
  type H2AActorRegistration,
  type H2AEnvelope,
  type H2AJournalEntry,
  type H2AJournalPayload,
  type H2ANegotiationRecord
} from "@sentropic/h2a";

import {
  inboxDir,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
  type LocalStorePaths
} from "./paths.js";

export interface CreateLocalStoreOptions {
  root: string;
}

export interface LocalStore {
  paths: LocalStorePaths;
  registerInstance(reg: H2AActorRegistration): void;
  listInstances(): H2AActorRegistration[];
  findInstance(id: string): H2AActorRegistration | undefined;
  openNegotiation(record: H2ANegotiationRecord): H2ANegotiationRecord;
  readNegotiation(id: string): H2ANegotiationRecord | undefined;
  updateNegotiationStatus(
    id: string,
    status: H2ANegotiationRecord["status"]
  ): H2ANegotiationRecord;
  appendNegotiationEvent<TBody = unknown>(
    negotiationId: string,
    payload: H2AJournalPayload<TBody>
  ): H2AJournalEntry<TBody>;
  readNegotiationJournal(negotiationId: string): H2AJournalEntry<unknown>[];
  putInboxMessage(actor: string, envelope: H2AEnvelope): void;
  readInbox(actor: string): H2AEnvelope[];
  popInboxMessage(actor: string, envelopeId: string): H2AEnvelope | undefined;
  putOutboxMessage(actor: string, envelope: H2AEnvelope): void;
  readOutbox(actor: string): H2AEnvelope[];
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function ensureLayout(paths: LocalStorePaths): void {
  ensureDir(paths.root);
  ensureDir(paths.registry);
  ensureDir(paths.contracts);
  ensureDir(paths.policies);
  ensureDir(paths.engagements);
  ensureDir(paths.negotiations);
  ensureDir(paths.inbox);
  ensureDir(paths.outbox);
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, "utf8");
  if (content.length === 0) return [];
  const lines = content.split("\n");
  const out: T[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

function appendJsonl(file: string, value: unknown): void {
  appendFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8" });
}

export function createLocalStore(options: CreateLocalStoreOptions): LocalStore {
  const paths = localStorePaths(options.root);
  ensureLayout(paths);

  if (!existsSync(paths.instances)) {
    writeFileSync(paths.instances, "", { encoding: "utf8" });
  }

  function listInstances(): H2AActorRegistration[] {
    return readJsonl<H2AActorRegistration>(paths.instances);
  }

  function findInstance(id: string): H2AActorRegistration | undefined {
    return listInstances().find((entry) => entry.id === id);
  }

  function registerInstance(reg: H2AActorRegistration): void {
    if (findInstance(reg.id)) {
      throw new Error(`Instance already registered: ${reg.id}`);
    }
    appendJsonl(paths.instances, reg);
  }

  function negotiationStateFile(id: string): string {
    return `${negotiationDir(paths, id)}/state.json`;
  }

  function openNegotiation(record: H2ANegotiationRecord): H2ANegotiationRecord {
    assertValidNegotiationState(record.status);
    ensureDir(negotiationDir(paths, record.id));
    const file = negotiationStateFile(record.id);
    if (existsSync(file)) {
      throw new Error(`Negotiation already open: ${record.id}`);
    }
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  }

  function readNegotiation(id: string): H2ANegotiationRecord | undefined {
    const file = negotiationStateFile(id);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as H2ANegotiationRecord;
  }

  function updateNegotiationStatus(
    id: string,
    status: H2ANegotiationRecord["status"]
  ): H2ANegotiationRecord {
    const current = readNegotiation(id);
    if (!current) {
      throw new Error(`Negotiation not found: ${id}`);
    }
    assertValidNegotiationState(status);
    const updated: H2ANegotiationRecord = { ...current, status };
    writeFileSync(
      negotiationStateFile(id),
      `${JSON.stringify(updated, null, 2)}\n`,
      "utf8"
    );
    return updated;
  }

  function readNegotiationJournal(
    negotiationId: string
  ): H2AJournalEntry<unknown>[] {
    const file = negotiationJournalFile(paths, negotiationId);
    if (!existsSync(file)) return [];
    const entries = readJsonl<H2AJournalEntry<unknown>>(file);
    const check = verifyJournalChain(entries);
    if (!check.ok) {
      throw new Error(
        `Negotiation ${negotiationId}: corrupt journal chain at index ${check.index}: ${check.reason}`
      );
    }
    return entries;
  }

  function appendNegotiationEvent<TBody>(
    negotiationId: string,
    payload: H2AJournalPayload<TBody>
  ): H2AJournalEntry<TBody> {
    ensureDir(negotiationDir(paths, negotiationId));
    const file = negotiationJournalFile(paths, negotiationId);
    const existing = readNegotiationJournal(negotiationId);
    const previous = existing[existing.length - 1];
    const entry = previous
      ? appendJournalEntry(previous, payload)
      : createJournalEntry(payload);
    appendJsonl(file, entry);
    return entry;
  }

  function envelopeFile(dir: string, envelopeId: string): string {
    return join(dir, `${envelopeId}.json`);
  }

  function readEnvelopesFrom(dir: string): H2AEnvelope[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const out: H2AEnvelope[] = [];
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (isH2AEnvelope(parsed)) {
        out.push(parsed as H2AEnvelope);
      }
    }
    return out;
  }

  function putInboxMessage(actor: string, envelope: H2AEnvelope): void {
    if (!isH2AEnvelope(envelope)) {
      throw new Error("putInboxMessage: payload is not a valid H2A envelope");
    }
    const dir = inboxDir(paths, actor);
    ensureDir(dir);
    writeFileSync(envelopeFile(dir, envelope.id), JSON.stringify(envelope, null, 2), "utf8");
  }

  function readInbox(actor: string): H2AEnvelope[] {
    return readEnvelopesFrom(inboxDir(paths, actor));
  }

  function popInboxMessage(actor: string, envelopeId: string): H2AEnvelope | undefined {
    const file = envelopeFile(inboxDir(paths, actor), envelopeId);
    if (!existsSync(file)) return undefined;
    const envelope = JSON.parse(readFileSync(file, "utf8")) as H2AEnvelope;
    unlinkSync(file);
    return envelope;
  }

  function putOutboxMessage(actor: string, envelope: H2AEnvelope): void {
    if (!isH2AEnvelope(envelope)) {
      throw new Error("putOutboxMessage: payload is not a valid H2A envelope");
    }
    const dir = outboxDir(paths, actor);
    ensureDir(dir);
    writeFileSync(envelopeFile(dir, envelope.id), JSON.stringify(envelope, null, 2), "utf8");
  }

  function readOutbox(actor: string): H2AEnvelope[] {
    return readEnvelopesFrom(outboxDir(paths, actor));
  }

  return {
    paths,
    registerInstance,
    listInstances,
    findInstance,
    openNegotiation,
    readNegotiation,
    updateNegotiationStatus,
    appendNegotiationEvent,
    readNegotiationJournal,
    putInboxMessage,
    readInbox,
    popInboxMessage,
    putOutboxMessage,
    readOutbox
  };
}
