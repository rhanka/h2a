/**
 * Default (real-filesystem) `ProviderSessionReaders` for the identity resolver
 * (DEC-116). Every reader is **best-effort + total**: any missing file, format
 * drift, or parse error yields `undefined`, so the resolver degrades to
 * `{ source: "none" }` and the caller mints a keypair-anchored id (never throws,
 * never blocks connect). The transcript layouts were live-verified 2026-05-30
 * (gemini's path layout drifts across versions — we match on `.project_root`).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ProviderSessionReaders } from "./resolver.js";

/** First newline-delimited line of a (possibly large) file, decoded best-effort. */
function firstLine(path: string): string {
  return readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
}

function newestFirst(paths: string[]): string[] {
  return paths
    .map((p) => {
      try {
        return { p, m: statSync(p).mtimeMs };
      } catch {
        return { p, m: 0 };
      }
    })
    .sort((a, b) => b.m - a.m)
    .map((x) => x.p);
}

function codexThreadForCwd(cwd: string): string | undefined {
  try {
    const base = join(homedir(), ".codex", "sessions");
    if (!existsSync(base)) return undefined;
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".jsonl")) files.push(p);
      }
    };
    walk(base);
    for (const f of newestFirst(files).slice(0, 100)) {
      try {
        const rec = JSON.parse(firstLine(f)) as {
          payload?: { id?: unknown; cwd?: unknown };
          session_meta?: { payload?: { id?: unknown; cwd?: unknown } };
        };
        const payload = rec.session_meta?.payload ?? rec.payload;
        if (payload && payload.cwd === cwd && typeof payload.id === "string") return payload.id;
      } catch {
        // skip malformed rollout
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function geminiSessionForCwd(cwd: string): string | undefined {
  try {
    const base = join(homedir(), ".gemini", "tmp");
    if (!existsSync(base)) return undefined;
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = join(base, e.name);
      try {
        if (readFileSync(join(dir, ".project_root"), "utf8").trim() !== cwd) continue;
        const chats = join(dir, "chats");
        if (!existsSync(chats)) continue;
        const sessions = readdirSync(chats).filter(
          (n) => n.startsWith("session-") && n.endsWith(".jsonl")
        );
        if (sessions.length === 0) continue;
        const newest = newestFirst(sessions.map((n) => join(chats, n)))[0];
        const rec = JSON.parse(firstLine(newest)) as { sessionId?: unknown };
        if (typeof rec.sessionId === "string") return rec.sessionId;
      } catch {
        // try the next tmp dir
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function agyConversationForCwd(cwd: string): string | undefined {
  try {
    const f = join(homedir(), ".gemini", "antigravity-cli", "cache", "last_conversations.json");
    if (!existsSync(f)) return undefined;
    const map = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
    const v = map && typeof map === "object" ? map[cwd] : undefined;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

export const defaultProviderSessionReaders: ProviderSessionReaders = {
  env: (name) => process.env[name],
  codexThreadForCwd,
  geminiSessionForCwd,
  agyConversationForCwd
};

// ── WP-6: host-native session name reading ────────────────────────────────

/**
 * Injectable FS readers for `readHostSessionName` (test-friendly).
 * Only reading is required; real-FS defaults are `defaultHostNameReaders`.
 */
export interface HostNameReaders {
  /** Read up to `maxLines` newline-delimited lines from a file. Returns [] on any error. */
  readLines(path: string, maxLines: number): string[];
  /** List newline-delimited JSONL entries from `~/.codex/session_index.jsonl`. */
  readCodexSessionIndex(): string[];
  /** Whether the home dir root is known (for path construction). */
  homedir(): string;
}

export const defaultHostNameReaders: HostNameReaders = {
  readLines(path: string, maxLines: number): string[] {
    try {
      const raw = readFileSync(path, "utf8");
      return raw.split("\n").slice(0, maxLines);
    } catch {
      return [];
    }
  },
  readCodexSessionIndex(): string[] {
    try {
      const f = join(homedir(), ".codex", "session_index.jsonl");
      const raw = readFileSync(f, "utf8");
      return raw.split("\n");
    } catch {
      return [];
    }
  },
  homedir(): string {
    return homedir();
  }
};

/**
 * Read the host-native session name for the given session.
 *
 * - **claude**: reads the transcript JSONL (located via the CLAUDE_CODE_SESSION_ID
 *   resolver); scans the first 40 lines for `customTitle` (user rename) first,
 *   then falls back to `agentName`. Never returns `aiTitle`.
 * - **codex**: reads `~/.codex/session_index.jsonl`; returns `thread_name` for
 *   the entry whose `id === sessionId` (last-match wins).
 * - Other hosts: returns undefined.
 *
 * Always best-effort (returns undefined on any parse/IO error).
 */
export function readHostSessionName(opts: {
  host: string;
  cwd: string;
  sessionId?: string;
  readers?: HostNameReaders;
}): string | undefined {
  const { host, cwd, sessionId } = opts;
  const readers = opts.readers ?? defaultHostNameReaders;
  try {
    if (host === "claude") {
      return readClaudeSessionName(cwd, sessionId, readers);
    }
    if (host === "codex") {
      return readCodexSessionName(sessionId, readers);
    }
  } catch {
    // best-effort
  }
  return undefined;
}

function findClaudeTranscript(
  cwd: string,
  sessionId: string | undefined,
  home: string = homedir()
): string | undefined {
  // Claude Code transcript: ~/.claude/projects/<hash>/<session-id>.jsonl
  // The resolver already locates it via CLAUDE_CODE_SESSION_ID → env reader.
  // Here we use the same scan: look under ~/.claude/projects/ for a file named <sessionId>.jsonl
  try {
    const projectsBase = join(home, ".claude", "projects");
    if (!existsSync(projectsBase)) return undefined;
    const projectDirs = readdirSync(projectsBase);
    for (const proj of projectDirs) {
      const projDir = join(projectsBase, proj);
      // Filter to directories to avoid stat issues
      try {
        const entries = readdirSync(projDir);
        for (const entry of entries) {
          if (sessionId && entry === `${sessionId}.jsonl`) {
            return join(projDir, entry);
          }
          // Fallback: if no sessionId, look for the newest .jsonl in the project matching cwd
          // We skip the fallback to keep things simple and correct.
        }
      } catch {
        // skip
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readClaudeSessionName(
  cwd: string,
  sessionId: string | undefined,
  readers: HostNameReaders
): string | undefined {
  if (!sessionId) return undefined;
  const transcriptPath = findClaudeTranscript(cwd, sessionId, readers.homedir());
  if (!transcriptPath) return undefined;
  const lines = readers.readLines(transcriptPath, 40);
  let customTitle: string | undefined;
  let agentName: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.customTitle === "string" && obj.customTitle.length > 0) {
        customTitle = obj.customTitle;
        break; // prefer first customTitle found
      }
      if (!agentName && typeof obj.agentName === "string" && obj.agentName.length > 0) {
        agentName = obj.agentName;
      }
    } catch {
      // skip malformed lines
    }
  }
  return customTitle ?? agentName;
}

function readCodexSessionName(
  sessionId: string | undefined,
  readers: HostNameReaders
): string | undefined {
  if (!sessionId) return undefined;
  const lines = readers.readCodexSessionIndex();
  let lastMatch: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.id === sessionId && typeof obj.thread_name === "string" && obj.thread_name.length > 0) {
        lastMatch = obj.thread_name;
      }
    } catch {
      // skip
    }
  }
  return lastMatch;
}
