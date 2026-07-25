/**
 * Default (real-filesystem) `ProviderSessionReaders` for the identity resolver
 * (DEC-116). Every reader is **best-effort + total**: any missing file, format
 * drift, or parse error yields `undefined`, so the resolver degrades to
 * `{ source: "none" }` and the caller mints a keypair-anchored id (never throws,
 * never blocks connect). The transcript layouts were live-verified 2026-05-30
 * (gemini's path layout drifts across versions — we match on `.project_root`).
 */

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync
} from "node:fs";
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
 * How much of the tail of a Claude transcript to scan for the current title.
 * A transcript is append-only and stamps `customTitle` on nearly every record,
 * so the newest records are at the END; 64 KiB is many records deep while
 * staying cheap enough to re-read on every heartbeat (live transcripts reach
 * tens of MB — the `auth` transcript that motivated this fix was 46 MB).
 */
export const CLAUDE_TITLE_TAIL_BYTES = 64 * 1024;

/**
 * Injectable FS readers for `readHostSessionName` (test-friendly).
 * Only reading is required; real-FS defaults are `defaultHostNameReaders`.
 */
export interface HostNameReaders {
  /**
   * Read the LAST `maxBytes` of a file as newline-delimited lines, dropping a
   * leading partial record when the file was truncated. Returns [] on any error.
   *
   * Deliberately not `readLines(path, maxLines)` (the pre-fix head reader): a
   * head read of an append-only transcript returns the title as of session
   * START and can never observe a later rename. An external implementor of this
   * interface gets a compile error rather than silently-stale names.
   */
  readTailLines(path: string, maxBytes: number): string[];
  /** List newline-delimited JSONL entries from `~/.codex/session_index.jsonl`. */
  readCodexSessionIndex(): string[];
  /** Whether the home dir root is known (for path construction). */
  homedir(): string;
}

export const defaultHostNameReaders: HostNameReaders = {
  readTailLines(path: string, maxBytes: number): string[] {
    let fd: number | undefined;
    try {
      const size = statSync(path).size;
      const length = Math.min(size, Math.max(0, maxBytes));
      const start = size - length;
      const buf = Buffer.allocUnsafe(length);
      fd = openSync(path, "r");
      let read = 0;
      while (read < length) {
        const n = readSync(fd, buf, read, length - read, start + read);
        if (n <= 0) break;
        read += n;
      }
      const lines = buf.subarray(0, read).toString("utf8").split("\n");
      // When we started mid-file the first element is a partial record; drop it
      // rather than letting JSON.parse fail on a truncated object.
      if (start > 0) lines.shift();
      return lines;
    } catch {
      return [];
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // best-effort
        }
      }
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
 *   resolver); scans the TAIL for the LAST `customTitle` (the current user
 *   rename — the transcript is append-only), then falls back to the first
 *   `agentName` seen. Never returns `aiTitle`.
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

/** Read one non-empty string field out of a JSONL record. Total (undefined on junk). */
function jsonField(line: string | undefined, key: string): string | undefined {
  const trimmed = line?.trim();
  if (!trimmed) return undefined;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const value = obj[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined; // skip malformed lines
  }
}

/**
 * Extract the CURRENT display title from a Claude transcript.
 *
 * A transcript is **append-only** and stamps `customTitle` on nearly every
 * record, so a `/rename` appends records carrying the NEW title at the END.
 * We therefore scan **backwards** and take the LAST `customTitle`.
 *
 * The pre-fix reader took the FIRST `customTitle` out of the first 40 lines,
 * which is the title as of session start — it could never observe a rename, so
 * `presence.name` stayed pinned to a stale title for the life of the session
 * (measured live: 1022 records saying `39etc` then 65 saying `auth`; the reader
 * returned `39etc` while the human saw `auth`). Codex already did last-wins;
 * Claude was the outlier.
 *
 * `agentName` keeps first-seen-wins — it is not user-mutable, so recency is
 * meaningless for it. `aiTitle` is never read, hence never returned.
 */
function titleFromClaudeTranscript(
  transcriptPath: string,
  readers: HostNameReaders
): string | undefined {
  const lines = readers.readTailLines(transcriptPath, CLAUDE_TITLE_TAIL_BYTES);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const customTitle = jsonField(lines[i], "customTitle");
    if (customTitle) return customTitle;
  }
  for (const line of lines) {
    const agentName = jsonField(line, "agentName");
    if (agentName) return agentName;
  }
  return undefined;
}

function readClaudeSessionName(
  cwd: string,
  sessionId: string | undefined,
  readers: HostNameReaders
): string | undefined {
  if (!sessionId) return undefined;
  const transcriptPath = findClaudeTranscript(cwd, sessionId, readers.homedir());
  if (!transcriptPath) return undefined;
  return titleFromClaudeTranscript(transcriptPath, readers);
}

/**
 * Build a re-callable resolver for this session's host-native display name, for
 * the heartbeat refresh path (spec 2026-07-25-h2a-lane-addressing §D1b).
 *
 * `readHostSessionName` is a one-shot: it re-scans every project directory to
 * locate the transcript. This factory memoizes the transcript path (the session
 * id is fixed for the life of the server process) so a heartbeat costs one
 * bounded tail read. A path that has not appeared yet is retried on the next
 * call, so a transcript created after boot is still picked up.
 *
 * Returns `undefined` whenever the title cannot be read — the caller must treat
 * that as "keep the name you have", never as "fall back to the cwd basename".
 */
export function createHostSessionNameRefresher(opts: {
  host: string;
  cwd: string;
  sessionId?: string;
  readers?: HostNameReaders;
}): () => string | undefined {
  const readers = opts.readers ?? defaultHostNameReaders;
  let cachedTranscript: string | undefined;
  return () => {
    try {
      if (opts.host === "codex") {
        return readCodexSessionName(opts.sessionId, readers);
      }
      if (opts.host !== "claude" || !opts.sessionId) return undefined;
      cachedTranscript ??= findClaudeTranscript(
        opts.cwd,
        opts.sessionId,
        readers.homedir()
      );
      if (!cachedTranscript) return undefined;
      return titleFromClaudeTranscript(cachedTranscript, readers);
    } catch {
      return undefined; // a naming bug must never break the heartbeat
    }
  };
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
