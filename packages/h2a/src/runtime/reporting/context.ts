import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  isH2AEnvelope,
  isH2ASession,
  type H2AEnvelope,
  type H2ASession
} from "@sentropic/h2a";

import { listBlockages } from "../blockage/index.js";
import { listObjectiveLoops, type H2AObjectiveLoop } from "../loop/index.js";
import {
  inboxDir,
  inboxDirRaw,
  localStorePaths
} from "../local-files/paths.js";

export const H2A_REPORT_CONTEXT_SCHEMA = "h2a.report-context/v1" as const;
export const H2A_REPORT_CONTEXT_MAX_ENTRIES = 100;
export const H2A_REPORT_CONTEXT_MAX_BYTES = 128 * 1024;

export type H2AReportContextEntryKind =
  | "loop"
  | "session"
  | "blockage"
  | "inbox-metadata";

export interface H2AReportContextEntry {
  readonly ref: string;
  readonly kind: H2AReportContextEntryKind;
  readonly workspace: string;
  readonly text: string;
}

export interface H2AReportContextV1 {
  readonly schema: typeof H2A_REPORT_CONTEXT_SCHEMA;
  readonly storeRoot: string;
  readonly workspaceRoot: string;
  readonly entries: readonly H2AReportContextEntry[];
  readonly omitted: number;
}

export interface ReadH2AReportContextOptions {
  readonly storeRoot: string;
  readonly workspaceRoot: string;
}

function cleanText(value: unknown, maxScalars = 2_048): string {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized).slice(0, maxScalars).join("");
}

function canonicalExistingDirectory(input: string, label: string): string {
  if (!isAbsolute(input)) throw new Error(`${label} must be an absolute path`);
  const path = realpathSync(input);
  if (!statSync(path).isDirectory()) throw new Error(`${label} must be a directory`);
  return path;
}

function scopedRealpath(root: string, candidate: unknown): string | undefined {
  if (typeof candidate !== "string" || candidate.length === 0 || !isAbsolute(candidate)) return undefined;
  try {
    const path = realpathSync(resolve(candidate));
    const rel = relative(root, path);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return path;
  } catch {
    // Missing, unreadable and dangling-symlink paths are not report context.
  }
  return undefined;
}

function readSessionsReadOnly(storeRoot: string): H2ASession[] {
  const dir = localStorePaths(storeRoot).presence;
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const sessions: H2ASession[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (isH2ASession(parsed)) sessions.push(parsed);
    } catch {
      // A reporting read never repairs or removes malformed presence records.
    }
  }
  return sessions;
}

interface ScopedLoopWorkspace {
  readonly workspace: string;
  readonly agentWorkspaces: ReadonlyMap<string, string>;
}

function loopWorkspace(
  loop: H2AObjectiveLoop,
  root: string
): ScopedLoopWorkspace | undefined {
  const declared: Array<{ instance?: string; path: unknown }> = [];
  for (const repo of Array.isArray(loop.repos) ? loop.repos : []) {
    declared.push({ path: repo?.path });
  }
  for (const agent of Array.isArray(loop.agents) ? loop.agents : []) {
    if (agent?.launch?.workspace !== undefined) {
      declared.push({
        ...(typeof agent.h2aInstance === "string"
          ? { instance: agent.h2aInstance }
          : {}),
        path: agent.launch.workspace
      });
    }
  }
  if (declared.length === 0) return undefined;

  const resolved = declared.map((item) => ({
    ...item,
    workspace: scopedRealpath(root, item.path)
  }));
  if (resolved.some((item) => item.workspace === undefined)) return undefined;
  const workspaces = new Set(resolved.map((item) => item.workspace as string));
  // A projected entry has one workspace field. Never relabel a multi-workspace
  // loop as whichever in-scope path happened to be encountered first.
  if (workspaces.size !== 1) return undefined;
  const workspace = [...workspaces][0]!;
  return {
    workspace,
    agentWorkspaces: new Map(
      resolved.flatMap((item) =>
        item.instance && item.workspace
          ? [[item.instance, item.workspace] as const]
          : []
      )
    )
  };
}

function sessionWorkspace(session: H2ASession, root: string): string | undefined {
  return scopedRealpath(root, session.workspace?.path ?? session.launchContext?.cwd);
}

function readInboxMetadata(
  storeRoot: string,
  session: H2ASession,
  workspace: string
): H2AReportContextEntry[] {
  const paths = localStorePaths(storeRoot);
  const dirs = new Set([
    inboxDir(paths, session.instance),
    inboxDirRaw(paths, session.instance)
  ]);
  const seen = new Set<string>();
  const out: H2AReportContextEntry[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
        if (!isH2AEnvelope(parsed)) continue;
        const envelope = parsed as H2AEnvelope;
        if (seen.has(envelope.id)) continue;
        seen.add(envelope.id);
        out.push({
          ref: `h2a:inbox:${cleanText(envelope.id, 256)}`,
          kind: "inbox-metadata",
          workspace,
          text: cleanText(
            `inbox=${session.instance} id=${envelope.id} type=${envelope.type} ` +
              `actor=${envelope.actor.instance} createdAt=${envelope.createdAt}`
          )
        });
      } catch {
        // Never mutate malformed inbox files and never expose their raw bytes.
      }
    }
  }
  return out;
}

function cappedEnvelope(
  storeRoot: string,
  workspaceRoot: string,
  candidates: readonly H2AReportContextEntry[]
): H2AReportContextV1 {
  const unique = new Map<string, H2AReportContextEntry>();
  for (const entry of candidates) {
    if (!unique.has(entry.ref)) unique.set(entry.ref, entry);
  }
  const entries: H2AReportContextEntry[] = [];
  const ordered = [...unique.values()].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  for (const candidate of ordered) {
    if (entries.length >= H2A_REPORT_CONTEXT_MAX_ENTRIES) break;
    const next = [...entries, candidate];
    const envelope = {
      schema: H2A_REPORT_CONTEXT_SCHEMA,
      storeRoot,
      workspaceRoot,
      entries: next,
      omitted: ordered.length - next.length
    };
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > H2A_REPORT_CONTEXT_MAX_BYTES) break;
    entries.push(candidate);
  }
  return {
    schema: H2A_REPORT_CONTEXT_SCHEMA,
    storeRoot,
    workspaceRoot,
    entries,
    omitted: ordered.length - entries.length
  };
}

/**
 * Build Track's optional h2a context projection without touching Track and
 * without acquiring, repairing, sweeping, or writing the h2a store.
 */
export function readH2AReportContext(
  options: ReadH2AReportContextOptions
): H2AReportContextV1 {
  const workspaceRoot = canonicalExistingDirectory(options.workspaceRoot, "workspace root");
  const storeRoot = canonicalExistingDirectory(resolve(options.storeRoot), "store root");
  const entries: H2AReportContextEntry[] = [];

  const instanceScopes = new Map<
    string,
    { workspaces: Set<string>; unsafe: boolean }
  >();
  const instanceScope = (instance: string) => {
    const existing = instanceScopes.get(instance);
    if (existing) return existing;
    const created = { workspaces: new Set<string>(), unsafe: false };
    instanceScopes.set(instance, created);
    return created;
  };
  const markUnsafe = (instance: unknown) => {
    if (typeof instance === "string") instanceScope(instance).unsafe = true;
  };
  const recordWorkspace = (instance: unknown, workspace: string) => {
    if (typeof instance === "string") {
      instanceScope(instance).workspaces.add(workspace);
    }
  };

  const sessions: Array<{ session: H2ASession; workspace: string }> = [];
  for (const session of readSessionsReadOnly(storeRoot)) {
    const workspace = sessionWorkspace(session, workspaceRoot);
    if (!workspace) {
      markUnsafe(session.instance);
      continue;
    }
    recordWorkspace(session.instance, workspace);
    sessions.push({ session, workspace });
  }

  for (const { session, workspace } of sessions) {
    entries.push({
      ref: `h2a:session:${cleanText(session.sessionId, 256)}`,
      kind: "session",
      workspace,
      text: cleanText(
        `instance=${session.instance} host=${session.host ?? "unknown"} state=${session.state} ` +
          `workStatus=${session.workStatus ?? "unknown"} heartbeatAt=${session.heartbeatAt}`
      )
    });
    entries.push(...readInboxMetadata(storeRoot, session, workspace));
  }

  for (const loop of listObjectiveLoops(storeRoot)) {
    if (!loop || typeof loop.id !== "string") continue;
    const scoped = loopWorkspace(loop, workspaceRoot);
    if (!scoped) {
      for (const agent of Array.isArray(loop.agents) ? loop.agents : []) {
        markUnsafe(agent?.h2aInstance);
      }
      continue;
    }
    for (const [instance, workspace] of scoped.agentWorkspaces) {
      recordWorkspace(instance, workspace);
    }
    entries.push({
      ref: `h2a:loop:${cleanText(loop.id, 256)}`,
      kind: "loop",
      workspace: scoped.workspace,
      text: cleanText(
        `name=${loop.name} status=${loop.status} goal=${loop.goal} ` +
          `agents=${Array.isArray(loop.agents) ? loop.agents.length : 0} ` +
          `refs=${Array.isArray(loop.refs) ? loop.refs.length : 0}`
      )
    });
  }

  for (const blockage of listBlockages(storeRoot)) {
    if (!blockage) continue;
    const scope = instanceScopes.get(blockage.instance);
    if (!scope || scope.unsafe || scope.workspaces.size !== 1) continue;
    const workspace = [...scope.workspaces][0]!;
    entries.push({
      ref: `h2a:blockage:${cleanText(blockage.instance, 256)}`,
      kind: "blockage",
      workspace,
      text: cleanText(
        `instance=${blockage.instance} scope=${blockage.scope} status=${blockage.resolvedAt ? "resolved" : "active"} ` +
          `reason=${blockage.reason}${blockage.needs ? ` needs=${blockage.needs}` : ""}`
      )
    });
  }

  return cappedEnvelope(storeRoot, workspaceRoot, entries);
}
