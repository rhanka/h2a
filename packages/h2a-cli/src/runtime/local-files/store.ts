import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";

import {
  appendJournalEntry,
  createJournalEntry,
  verifyJournalChain,
  type H2AActorRegistration,
  type H2AJournalEntry,
  type H2AJournalPayload
} from "@sentropic/h2a";

import {
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
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
  appendNegotiationEvent<TBody = unknown>(
    negotiationId: string,
    payload: H2AJournalPayload<TBody>
  ): H2AJournalEntry<TBody>;
  readNegotiationJournal(negotiationId: string): H2AJournalEntry<unknown>[];
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

  return {
    paths,
    registerInstance,
    listInstances,
    findInstance,
    appendNegotiationEvent,
    readNegotiationJournal
  };
}
