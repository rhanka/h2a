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
