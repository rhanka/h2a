import { join } from "node:path";

/**
 * Map an arbitrary id into a filesystem-safe path segment (DEC-062).
 *
 * V1 ids use `:` as a separator (e.g. `nego:codex`, `claude:proj-1`,
 * `sess:abc123`). On Windows, `:` is the drive-letter separator and is
 * forbidden inside path components — any `mkdir <root>/negotiations/nego:codex`
 * ENOENTs. The same applies to `/`, `\`, `<`, `>`, `"`, `|`, `?`, `*`
 * which are reserved by Windows.
 *
 * The mapping is `[:\\/<>"|?*]+` → `__`. It is deterministic and lossy
 * (we never need to recover the original id from the path segment;
 * lookups go id → path, never path → id; on-disk artefacts always
 * carry the original id in their JSON body).
 *
 * Empty input is mapped to `_` so we never produce an empty path
 * segment.
 */
export function safePathSegment(id: string): string {
  if (typeof id !== "string" || id.length === 0) return "_";
  const cleaned = id.replace(/[:/\\<>"|?*]+/g, "__");
  return cleaned.length === 0 ? "_" : cleaned;
}

export interface LocalStorePaths {
  root: string;
  registry: string;
  instances: string;
  keys: string;
  subagents: string;
  subagentAudit: string;
  offboard: string;
  contracts: string;
  policies: string;
  engagements: string;
  artifacts: string;
  negotiations: string;
  inbox: string;
  outbox: string;
  presence: string;
  drumbeat: string;
  blockage: string;
  escalation: string;
}

export function localStorePaths(root: string): LocalStorePaths {
  return {
    root,
    registry: join(root, "registry"),
    instances: join(root, "registry", "instances.jsonl"),
    keys: join(root, "registry", "keys.jsonl"),
    subagents: join(root, "registry", "subagents.jsonl"),
    subagentAudit: join(root, "registry", "subagent-audit.jsonl"),
    offboard: join(root, "registry", "offboard.jsonl"),
    contracts: join(root, "contracts"),
    policies: join(root, "policies"),
    engagements: join(root, "engagements"),
    artifacts: join(root, "artifacts"),
    negotiations: join(root, "negotiations"),
    inbox: join(root, "inbox"),
    outbox: join(root, "outbox"),
    presence: join(root, "presence"),
    drumbeat: join(root, "drumbeat"),
    blockage: join(root, "blockage"),
    escalation: join(root, "escalation")
  };
}

export function presenceFile(paths: LocalStorePaths, sessionId: string): string {
  return join(paths.presence, `${safePathSegment(sessionId)}.json`);
}

export function negotiationDir(paths: LocalStorePaths, negotiationId: string): string {
  return join(paths.negotiations, safePathSegment(negotiationId));
}

export function negotiationJournalFile(
  paths: LocalStorePaths,
  negotiationId: string
): string {
  return join(negotiationDir(paths, negotiationId), "journal.jsonl");
}

export function inboxDir(paths: LocalStorePaths, actor: string): string {
  return join(paths.inbox, safePathSegment(actor));
}

export function outboxDir(paths: LocalStorePaths, actor: string): string {
  return join(paths.outbox, safePathSegment(actor));
}
