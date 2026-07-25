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
 *
 * A transcript is append-only, and `customTitle` is carried by dedicated
 * **rename-event records** (`type: "custom-title"`) — NOT by ordinary records.
 * Measured 2026-07-25 over all 8078 local transcripts: title-bearing records are
 * 0.06% of tail records (5.1% within the one heavily-renamed transcript that
 * motivated this fix). The newest such record is therefore near the END, and a
 * 64 KiB window reaches it: of the 45 transcripts that carry a title at all,
 * **all 45** are resolved from this window — 0 missed, 0 wrong values.
 *
 * Bounded rather than whole-file because this now runs on the heartbeat and live
 * transcripts reach hundreds of MB (largest local: 233 MB; cost 0.30 ms/call).
 */
export const CLAUDE_TITLE_TAIL_BYTES = 64 * 1024;

/**
 * How much of the TAIL of `~/.codex/session_index.jsonl` to read. Codex resolves
 * last-match-wins, so the tail is what matters; the file grows monotonically and
 * this also runs on the heartbeat (48 KiB today, so today's whole file fits).
 * A session whose entry has aged out of the window simply yields `undefined`,
 * which the caller treats as "keep the name you have".
 */
export const CODEX_INDEX_TAIL_BYTES = 256 * 1024;

/**
 * Upper bound on a display name written into presence. A host title is
 * user-controlled and unbounded; `isH2ASession` only checks `typeof`, so an
 * absurd title would otherwise land in every peer's presence read. Truncated
 * rather than rejected so the name stays findable by the substring match that
 * `discover_sessions(name:)` performs.
 */
export const MAX_DISPLAY_NAME_CHARS = 200;

/** Initial re-scan delay after a transcript lookup MISSES (negative cache). */
export const TRANSCRIPT_MISS_BACKOFF_MS = 60_000;
/** Ceiling for the negative-cache backoff. */
export const TRANSCRIPT_MISS_BACKOFF_MAX_MS = 300_000;

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
  /**
   * List newline-delimited JSONL entries from the TAIL of
   * `~/.codex/session_index.jsonl` (see `CODEX_INDEX_TAIL_BYTES`).
   */
  readCodexSessionIndex(): string[];
  /** Whether the home dir root is known (for path construction). */
  homedir(): string;
  /**
   * Locate the transcript file for a Claude session id. Optional: defaults to
   * scanning `~/.claude/projects`. Injectable so a test can COUNT the scans and
   * pin the negative-cache behaviour — that walk is 87 directories / 14345 files
   * and it sits on a 5-second timer, so a repeated miss must not re-walk.
   */
  findClaudeTranscript?(
    cwd: string,
    sessionId: string,
    home: string
  ): string | undefined;
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
    // Tail-bounded: this runs on the heartbeat and the index grows monotonically.
    return defaultHostNameReaders.readTailLines(
      join(homedir(), ".codex", "session_index.jsonl"),
      CODEX_INDEX_TAIL_BYTES
    );
  },
  homedir(): string {
    return homedir();
  },
  findClaudeTranscript(
    cwd: string,
    sessionId: string,
    home: string
  ): string | undefined {
    return findClaudeTranscript(cwd, sessionId, home);
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

/**
 * C0/C1 control characters and Unicode bidi overrides/isolates.
 *
 * A display name is host-controlled free text that D3's list-and-ask presents to
 * a HUMAN choosing a message recipient. A bidi override (U+202E) can make
 * `auth<U+202E>gnitnuocca` render as `authaccounting`, so two candidates in a
 * disambiguation list can be made to look alike; a C0 control can truncate or
 * corrupt a terminal line. Neither is ever legitimate in a display name, so both
 * are removed at INGEST rather than left to every consumer to re-discover.
 *
 * This is defence in depth, not a substitute for escaping: a renderer must still
 * escape what it prints (spec §10.6), and candidate choice must never rest on
 * title text alone.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_DISPLAY_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Normalize a candidate display name: strip unsafe characters, trim, reject
 * whitespace-only, and cap the length. Without the trim a title of `"   "` is
 * truthy and would be written to presence verbatim; without the cap an unbounded
 * user-controlled string lands in every peer's presence read (`isH2ASession` only
 * checks `typeof`).
 *
 * EVERY host reader must route its title through this function. Claude reaches it
 * via `jsonField`; Codex calls it directly (`readCodexSessionName`). A reader that
 * bypasses it writes untrimmed, unbounded, control-bearing text into presence.
 */
function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(UNSAFE_DISPLAY_CHARS, "").trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > MAX_DISPLAY_NAME_CHARS
    ? trimmed.slice(0, MAX_DISPLAY_NAME_CHARS)
    : trimmed;
}

/**
 * Read one display-name field out of a JSONL record. Total (undefined on junk).
 *
 * `requireCustomTitleType` applies the same policy as
 * `h2a-runtime/src/restore.ts` — only a dedicated rename-event record
 * (`type: "custom-title"`) carries an authoritative title. See
 * `titleFromClaudeTranscript` for the measurement behind that choice.
 */
function jsonField(
  line: string | undefined,
  key: string,
  requireCustomTitleType = false
): string | undefined {
  const trimmed = line?.trim();
  if (!trimmed) return undefined;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (requireCustomTitleType && obj.type !== "custom-title") return undefined;
    return normalizeTitle(obj[key]);
  } catch {
    return undefined; // skip malformed lines
  }
}

/**
 * Extract the CURRENT display title from a Claude transcript.
 *
 * A transcript is **append-only**, and a title lives on a dedicated rename-event
 * record (`type: "custom-title"`), so a rename appends the NEW title at the END.
 * We therefore scan **backwards** and take the LAST one.
 *
 * The pre-fix reader took the FIRST `customTitle` out of the first 40 lines,
 * which is the title as of session start — it could never observe a rename, so
 * `presence.name` stayed pinned to a stale title for the life of the session
 * (measured live: 1022 records saying `39etc` then 65 saying `auth`; the reader
 * returned `39etc` while the human saw `auth`).
 *
 * **Policy note (single source of truth).** `h2a-runtime/src/restore.ts:187-200`
 * reads the same field and requires `type === "custom-title"`. This reader now
 * applies the identical predicate, so the two agree by construction. That is not
 * a guess: measured 2026-07-25 across all 8078 local transcripts, comparing both
 * policies on the same window, there were **0 divergences**, and **0** of the 89
 * title-bearing records carried the field on any other record type. The stricter
 * predicate is chosen because a misread produces a WRONG name (bad routing) while
 * a missed read produces NO name (the caller keeps the name it has).
 *
 * `agentName` keeps first-seen-wins — it is not user-mutable, so recency is
 * meaningless for it, and it is not a rename event so the type check must not
 * apply to it. `aiTitle` is never read, hence never returned.
 */
function titleFromClaudeTranscript(
  transcriptPath: string,
  readers: HostNameReaders
): string | undefined {
  const lines = readers.readTailLines(transcriptPath, CLAUDE_TITLE_TAIL_BYTES);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    // Cheap pre-filter before JSON.parse, mirroring restore.ts.
    if (!lines[i]?.includes('"custom-title"')) continue;
    const customTitle = jsonField(lines[i], "customTitle", true);
    if (customTitle) return customTitle;
  }
  for (const line of lines) {
    const agentName = jsonField(line, "agentName");
    if (agentName) return agentName;
  }
  return undefined;
}

/** Locate a transcript, preferring an injected finder (see `HostNameReaders`). */
function locateClaudeTranscript(
  cwd: string,
  sessionId: string,
  readers: HostNameReaders
): string | undefined {
  return readers.findClaudeTranscript
    ? readers.findClaudeTranscript(cwd, sessionId, readers.homedir())
    : findClaudeTranscript(cwd, sessionId, readers.homedir());
}

function readClaudeSessionName(
  cwd: string,
  sessionId: string | undefined,
  readers: HostNameReaders
): string | undefined {
  if (!sessionId) return undefined;
  const transcriptPath = locateClaudeTranscript(cwd, sessionId, readers);
  if (!transcriptPath) return undefined;
  return titleFromClaudeTranscript(transcriptPath, readers);
}

/**
 * Build a re-callable resolver for this session's host-native display name, for
 * the heartbeat refresh path (spec 2026-07-25-h2a-lane-addressing §D1b).
 *
 * `readHostSessionName` is a one-shot: it re-scans every project directory to
 * locate the transcript. This factory memoizes the transcript path (the session
 * id is fixed for the life of the server process) so a steady-state heartbeat
 * costs one bounded tail read.
 *
 * **Negative caching (required, not an optimization).** A session whose
 * transcript never appears is a real, observed state — it is the RC-3 case in the
 * spec, where `CLAUDE_CODE_SESSION_ID` names a session with no transcript at all.
 * Memoizing only on success meant that session re-walked
 * `~/.claude/projects` — 87 directories, 14345 files, 8.73 ms — on EVERY
 * heartbeat, i.e. every 5 seconds, forever. So a miss is cached too, with
 * exponential backoff from `TRANSCRIPT_MISS_BACKOFF_MS` to
 * `TRANSCRIPT_MISS_BACKOFF_MAX_MS`. A transcript that appears later is still
 * picked up, just not instantly — bounded by the current backoff.
 *
 * Returns `undefined` whenever the title cannot be read — the caller must treat
 * that as "keep the name you have", never as "fall back to the cwd basename".
 */
export function createHostSessionNameRefresher(opts: {
  host: string;
  cwd: string;
  sessionId?: string;
  readers?: HostNameReaders;
  /** Injectable clock, for testing the negative cache without real waiting. */
  now?: () => number;
}): () => string | undefined {
  const readers = opts.readers ?? defaultHostNameReaders;
  const now = opts.now ?? Date.now;
  let cachedTranscript: string | undefined;
  let nextScanAllowedAt = 0;
  let missBackoffMs = TRANSCRIPT_MISS_BACKOFF_MS;
  return () => {
    try {
      if (opts.host === "codex") {
        return readCodexSessionName(opts.sessionId, readers);
      }
      const sessionId = opts.sessionId;
      if (opts.host !== "claude" || !sessionId) return undefined;
      if (cachedTranscript === undefined) {
        const at = now();
        // Negative-cache hit: do NOT walk the filesystem.
        if (at < nextScanAllowedAt) return undefined;
        cachedTranscript = locateClaudeTranscript(opts.cwd, sessionId, readers);
        if (cachedTranscript === undefined) {
          nextScanAllowedAt = at + missBackoffMs;
          missBackoffMs = Math.min(
            missBackoffMs * 2,
            TRANSCRIPT_MISS_BACKOFF_MAX_MS
          );
          return undefined;
        }
      }
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
      if (obj.id === sessionId) {
        // Route through the SAME normalization as Claude. Previously this branch
        // assigned `obj.thread_name` raw, so a Codex thread name was written to
        // presence untrimmed, whitespace-only-accepted and UNBOUNDED — the one
        // host-controlled presence input the length cap did not actually cover.
        const normalized = normalizeTitle(obj.thread_name);
        if (normalized !== undefined) lastMatch = normalized;
      }
    } catch {
      // skip
    }
  }
  return lastMatch;
}
