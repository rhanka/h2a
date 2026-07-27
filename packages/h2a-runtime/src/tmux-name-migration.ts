import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  withRegistryLock,
  resolveRegistryPath,
  type RegistryEntry,
} from "./registry.js";
import {
  LEGACY_LOCAL_PREFIX,
  LOCAL_PREFIX,
  listLocalSessionsWithDiagnostics,
  parseManagedSessionName,
  type LocalSession,
} from "./tmux.js";

export type TmuxNameMigrationMode = "dry-run" | "apply" | "rollback";

export interface TmuxNameMigrationPlanEntry {
  readonly tmuxSessionId: string;
  readonly tmuxSessionCreatedAt: string;
  readonly tmuxServerPid: string;
  readonly tmuxSocketPath: string;
  readonly oldName: string;
  readonly newName: string;
  readonly collision: boolean;
}

export interface TmuxNameMigrationJournalEntry {
  tmuxSessionId: string;
  tmuxSessionCreatedAt: string;
  tmuxServerPid: string;
  tmuxSocketPath: string;
  readonly oldName: string;
  readonly newName: string;
  state: "planned" | "renamed" | "applied" | "rolled-back";
  registryEntriesUpdated: number;
  appliedAt?: string;
  rolledBackAt?: string;
}

export interface TmuxNameMigrationJournalV1 {
  readonly version: 1;
  readonly createdAt: string;
  updatedAt: string;
  entries: TmuxNameMigrationJournalEntry[];
}

export interface TmuxNameMigrationResult {
  readonly mode: TmuxNameMigrationMode;
  readonly changed: number;
  readonly entries: readonly TmuxNameMigrationJournalEntry[];
  readonly collisions: readonly TmuxNameMigrationPlanEntry[];
  readonly warnings: readonly string[];
}

interface MigrationDependencies {
  readonly listSessions: () => LocalSession[];
  readonly renameSession: (oldName: string, newName: string) => boolean;
  readonly updateRegistry: (oldName: string, newName: string) => number;
  readonly readJournal: () => TmuxNameMigrationJournalV1 | undefined;
  readonly writeJournal: (journal: TmuxNameMigrationJournalV1) => void;
  readonly now: () => string;
}

export function tmuxNameMigrationJournalPath(): string {
  return join(dirname(resolveRegistryPath()), "tmux-name-migration-v1.json");
}

export function planTmuxNameMigration(
  sessions: readonly LocalSession[],
): TmuxNameMigrationPlanEntry[] {
  const names = new Set(sessions.map((session) => session.name));
  return sessions
    .flatMap((session) => {
      const managed = parseManagedSessionName(session.name);
      if (!managed || managed.prefix !== LEGACY_LOCAL_PREFIX) return [];
      const newName = `${LOCAL_PREFIX}${managed.slug}`;
      return [{
        tmuxSessionId: session.tmuxId,
        tmuxSessionCreatedAt: session.tmuxCreatedAt,
        tmuxServerPid: session.tmuxServerPid,
        tmuxSocketPath: session.tmuxSocketPath,
        oldName: session.name,
        newName,
        collision: names.has(newName),
      }];
    })
    .sort((a, b) => a.oldName.localeCompare(b.oldName));
}

function defaultRenameSession(oldName: string, newName: string): boolean {
  const result = spawnSync(
    "tmux",
    ["rename-session", "-t", `=${oldName}`, newName],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

function defaultUpdateRegistry(oldName: string, newName: string): number {
  const path = resolveRegistryPath();
  return withRegistryLock(path, (entries: RegistryEntry[]) => {
    let changed = 0;
    for (const entry of entries) {
      if (entry.tmuxSession !== oldName) continue;
      entry.tmuxSession = newName;
      changed += 1;
    }
    return changed === 0
      ? { entries, result: 0, save: false }
      : { entries, result: changed };
  });
}

function defaultReadJournal(): TmuxNameMigrationJournalV1 | undefined {
  let text: string;
  try {
    text = readFileSync(tmuxNameMigrationJournalPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("tmux name migration journal could not be read");
  }
  let value: TmuxNameMigrationJournalV1;
  try {
    value = JSON.parse(text) as TmuxNameMigrationJournalV1;
  } catch {
    throw new Error("tmux name migration journal is malformed");
  }
  if (
    value.version !== 1 ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.entries) ||
    !value.entries.every(validJournalEntry)
  ) {
    throw new Error("tmux name migration journal is invalid");
  }
  return value;
}

function validJournalEntry(
  value: unknown,
): value is TmuxNameMigrationJournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<TmuxNameMigrationJournalEntry>;
  if (
    typeof entry.tmuxSessionId !== "string" ||
    !/^\$\d+$/.test(entry.tmuxSessionId) ||
    typeof entry.tmuxSessionCreatedAt !== "string" ||
    !/^\d+$/.test(entry.tmuxSessionCreatedAt) ||
    typeof entry.tmuxServerPid !== "string" ||
    !/^\d+$/.test(entry.tmuxServerPid) ||
    typeof entry.tmuxSocketPath !== "string" ||
    entry.tmuxSocketPath.length === 0 ||
    typeof entry.oldName !== "string" ||
    typeof entry.newName !== "string" ||
    !["planned", "renamed", "applied", "rolled-back"].includes(entry.state ?? "") ||
    !Number.isInteger(entry.registryEntriesUpdated) ||
    (entry.appliedAt !== undefined && typeof entry.appliedAt !== "string") ||
    (entry.rolledBackAt !== undefined && typeof entry.rolledBackAt !== "string")
  ) {
    return false;
  }
  const managed = parseManagedSessionName(entry.oldName);
  return (
    managed?.prefix === LEGACY_LOCAL_PREFIX &&
    entry.newName === `${LOCAL_PREFIX}${managed.slug}`
  );
}

function sameTmuxIdentity(
  session: LocalSession | undefined,
  entry: Pick<
    TmuxNameMigrationJournalEntry,
    | "tmuxSessionId"
    | "tmuxSessionCreatedAt"
    | "tmuxServerPid"
    | "tmuxSocketPath"
  >,
): boolean {
  return !!session &&
    session.tmuxId === entry.tmuxSessionId &&
    session.tmuxCreatedAt === entry.tmuxSessionCreatedAt &&
    session.tmuxServerPid === entry.tmuxServerPid &&
    session.tmuxSocketPath === entry.tmuxSocketPath;
}

/** Resolve an old client id only when the live tmux identity proves a journalled rename. */
export function legacyClientSessionIdFromJournal(
  session: LocalSession,
  journal: TmuxNameMigrationJournalV1 | undefined,
): string | undefined {
  return journal?.entries.find(
    (entry) =>
      (entry.state === "renamed" || entry.state === "applied") &&
      entry.newName === session.name &&
      sameTmuxIdentity(session, entry),
  )?.oldName;
}

export function legacyClientSessionIdForMigratedSession(
  session: LocalSession,
): string | undefined {
  let journal: TmuxNameMigrationJournalV1 | undefined;
  try {
    journal = defaultReadJournal();
  } catch {
    return undefined;
  }
  return legacyClientSessionIdFromJournal(session, journal);
}

function defaultWriteJournal(journal: TmuxNameMigrationJournalV1): void {
  const path = tmuxNameMigrationJournalPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function dependencies(
  overrides: Partial<MigrationDependencies>,
): MigrationDependencies {
  return {
    listSessions: () => {
      const inventory = listLocalSessionsWithDiagnostics();
      if (!inventory.known) {
        throw new Error(inventory.reason ?? "tmux inventory is unavailable");
      }
      return inventory.sessions;
    },
    renameSession: defaultRenameSession,
    updateRegistry: defaultUpdateRegistry,
    readJournal: defaultReadJournal,
    writeJournal: defaultWriteJournal,
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

export function migrateTmuxNames(
  mode: TmuxNameMigrationMode,
  overrides: Partial<MigrationDependencies> = {},
): TmuxNameMigrationResult {
  const deps = dependencies(overrides);
  const warnings: string[] = [];
  let sessions: LocalSession[];
  try {
    sessions = deps.listSessions();
  } catch (error) {
    return {
      mode,
      changed: 0,
      entries: [],
      collisions: [],
      warnings: [
        `tmux sessions could not be enumerated: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  if (mode === "dry-run") {
    const plan = planTmuxNameMigration(sessions);
    return {
      mode,
      changed: 0,
      entries: plan.map((entry) => ({
        tmuxSessionId: entry.tmuxSessionId,
        tmuxSessionCreatedAt: entry.tmuxSessionCreatedAt,
        tmuxServerPid: entry.tmuxServerPid,
        tmuxSocketPath: entry.tmuxSocketPath,
        oldName: entry.oldName,
        newName: entry.newName,
        state: "planned",
        registryEntriesUpdated: 0,
      })),
      collisions: plan.filter((entry) => entry.collision),
      warnings,
    };
  }

  if (mode === "apply") {
    const plan = planTmuxNameMigration(sessions);
    let previous: TmuxNameMigrationJournalV1 | undefined;
    try {
      previous = deps.readJournal();
    } catch (error) {
      return {
        mode,
        changed: 0,
        entries: [],
        collisions: [],
        warnings: [
          error instanceof Error
            ? error.message
            : "tmux name migration journal could not be read",
        ],
      };
    }
    const sessionsByName = new Map(
      sessions.map((session) => [session.name, session]),
    );
    const priorEntries = previous?.entries.map((entry) => ({ ...entry })) ?? [];
    const byOldName = new Map(priorEntries.map((entry) => [entry.oldName, entry]));
    let journalChanged = false;
    for (const item of plan) {
      const existing = byOldName.get(item.oldName);
      if (!existing) {
        const entry: TmuxNameMigrationJournalEntry = {
          tmuxSessionId: item.tmuxSessionId,
          tmuxSessionCreatedAt: item.tmuxSessionCreatedAt,
          tmuxServerPid: item.tmuxServerPid,
          tmuxSocketPath: item.tmuxSocketPath,
          oldName: item.oldName,
          newName: item.newName,
          state: "planned",
          registryEntriesUpdated: 0,
        };
        priorEntries.push(entry);
        byOldName.set(entry.oldName, entry);
        journalChanged = true;
      } else if (!sessionsByName.has(existing.newName)) {
        existing.tmuxSessionId = item.tmuxSessionId;
        existing.tmuxSessionCreatedAt = item.tmuxSessionCreatedAt;
        existing.tmuxServerPid = item.tmuxServerPid;
        existing.tmuxSocketPath = item.tmuxSocketPath;
        existing.state = "planned";
        existing.registryEntriesUpdated = 0;
        delete existing.appliedAt;
        delete existing.rolledBackAt;
        journalChanged = true;
      }
    }
    const collisionByOldName = new Map<string, TmuxNameMigrationPlanEntry>();
    for (const item of plan.filter((entry) => entry.collision)) {
      collisionByOldName.set(item.oldName, item);
    }
    for (const entry of priorEntries) {
      if (
        entry.state !== "rolled-back" &&
        sessionsByName.has(entry.oldName) &&
        sessionsByName.has(entry.newName)
      ) {
        collisionByOldName.set(entry.oldName, {
          tmuxSessionId: entry.tmuxSessionId,
          tmuxSessionCreatedAt: entry.tmuxSessionCreatedAt,
          tmuxServerPid: entry.tmuxServerPid,
          tmuxSocketPath: entry.tmuxSocketPath,
          oldName: entry.oldName,
          newName: entry.newName,
          collision: true,
        });
      }
    }
    const collisions = [...collisionByOldName.values()];
    if (collisions.length > 0) {
      return { mode, changed: 0, entries: priorEntries, collisions, warnings };
    }
    const now = deps.now();
    const journal: TmuxNameMigrationJournalV1 = {
      version: 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      entries: priorEntries,
    };
    if (journal.entries.length > 0 && (journalChanged || !previous)) {
      deps.writeJournal(journal);
    }
    let changed = 0;
    for (const entry of journal.entries) {
      if (entry.state === "rolled-back") continue;
      const oldSession = sessionsByName.get(entry.oldName);
      const newSession = sessionsByName.get(entry.newName);
      const oldExists = oldSession !== undefined;
      const newExists = newSession !== undefined;
      if (
        (oldExists && !sameTmuxIdentity(oldSession, entry)) ||
        (newExists && !sameTmuxIdentity(newSession, entry))
      ) {
        warnings.push(
          `tmux identity changed for ${entry.oldName}; refusing journal replay`,
        );
        continue;
      }
      if (entry.state === "applied" && newExists && !oldExists) continue;
      if (!oldExists && !newExists) {
        warnings.push(
          `migration source and target are both missing: ${entry.oldName} -> ${entry.newName}`,
        );
        continue;
      }
      if (oldExists && !newExists) {
        if (!deps.renameSession(entry.oldName, entry.newName)) {
          warnings.push(`tmux refused ${entry.oldName} -> ${entry.newName}`);
          continue;
        }
        sessionsByName.delete(entry.oldName);
        sessionsByName.set(entry.newName, {
          ...oldSession!,
          name: entry.newName,
          slug: parseManagedSessionName(entry.newName)!.slug,
        });
        changed += 1;
        entry.state = "renamed";
        journal.updatedAt = deps.now();
        deps.writeJournal(journal);
      } else if (!oldExists && newExists && entry.state === "planned") {
        // The process may have stopped after tmux renamed but before journalling.
        entry.state = "renamed";
        journal.updatedAt = deps.now();
        deps.writeJournal(journal);
      }
      if (entry.state !== "renamed") continue;
      try {
        entry.registryEntriesUpdated = deps.updateRegistry(
          entry.oldName,
          entry.newName,
        );
      } catch {
        warnings.push(
          `registry update failed after renaming ${entry.oldName}; rerun --apply to recover`,
        );
        continue;
      }
      entry.state = "applied";
      entry.appliedAt = deps.now();
      journal.updatedAt = entry.appliedAt;
      deps.writeJournal(journal);
    }
    return { mode, changed, entries: journal.entries, collisions, warnings };
  }

  let journal: TmuxNameMigrationJournalV1 | undefined;
  try {
    journal = deps.readJournal();
  } catch (error) {
    return {
      mode,
      changed: 0,
      entries: [],
      collisions: [],
      warnings: [
        error instanceof Error
          ? error.message
          : "tmux name migration journal could not be read",
      ],
    };
  }
  if (!journal) {
    return {
      mode,
      changed: 0,
      entries: [],
      collisions: [],
      warnings: ["no tmux name migration journal exists"],
    };
  }
  const sessionsByName = new Map(
    sessions.map((session) => [session.name, session]),
  );
  let changed = 0;
  for (const entry of [...journal.entries].reverse()) {
    if (entry.state === "rolled-back") continue;
    const oldSession = sessionsByName.get(entry.oldName);
    const newSession = sessionsByName.get(entry.newName);
    const oldExists = oldSession !== undefined;
    const newExists = newSession !== undefined;
    if (
      (oldExists && !sameTmuxIdentity(oldSession, entry)) ||
      (newExists && !sameTmuxIdentity(newSession, entry))
    ) {
      warnings.push(
        `tmux identity changed for ${entry.oldName}; refusing rollback`,
      );
      continue;
    }
    if (oldExists && newExists) {
      warnings.push(`rollback collision: ${entry.oldName} already exists`);
      continue;
    }
    if (!oldExists && !newExists) {
      warnings.push(`rollback source missing: ${entry.newName}`);
      continue;
    }
    if (!oldExists && newExists) {
      if (!deps.renameSession(entry.newName, entry.oldName)) {
        warnings.push(`tmux refused ${entry.newName} -> ${entry.oldName}`);
        continue;
      }
      sessionsByName.delete(entry.newName);
      sessionsByName.set(entry.oldName, {
        ...newSession!,
        name: entry.oldName,
        slug: parseManagedSessionName(entry.oldName)!.slug,
      });
      changed += 1;
    }
    try {
      entry.registryEntriesUpdated = deps.updateRegistry(
        entry.newName,
        entry.oldName,
      );
    } catch {
      warnings.push(
        `registry rollback failed for ${entry.oldName}; rerun --rollback to recover`,
      );
      continue;
    }
    entry.state = "rolled-back";
    entry.rolledBackAt = deps.now();
    journal.updatedAt = entry.rolledBackAt;
    deps.writeJournal(journal);
  }
  return {
    mode,
    changed,
    entries: journal.entries,
    collisions: [],
    warnings,
  };
}
