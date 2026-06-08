import { join } from "node:path";

import { slugify } from "@sentropic/h2a";

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
  // A pure-dot segment (".", "..", …) is a path-traversal vector: `join(base,
  // "tenants", "..")` escapes to `base`. Neutralize it so no id (e.g. a broker
  // `sub=".."` → rootForSub) can climb out of its directory.
  if (cleaned.length === 0 || /^\.+$/.test(cleaned)) return "_";
  return cleaned;
}

export interface LocalStorePaths {
  root: string;
  registry: string;
  instances: string;
  keys: string;
  subagents: string;
  subagentAudit: string;
  offboard: string;
  orgMembership: string;
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
    orgMembership: join(root, "registry", "org-membership.jsonl"),
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

/**
 * Canonicalize an addressable instance/channel handle so addressing is
 * **case-insensitive** and **label-slug-stable**.
 *
 * The footgun this closes: `deriveInstanceId` builds `host:slugify(label):uuid`
 * (the label is lowercased + slugified), but inbox dirs were keyed on the RAW
 * handle via `safePathSegment`. So a sender addressing `claude:matchID` wrote to
 * `inbox/claude__matchID` while the agent (registered as `claude:matchid:…`)
 * read `inbox/claude__matchid` — the message was silently lost. Routing handles
 * through this first makes both forms resolve to the one canonical inbox.
 *
 * `host:label[:uuid…]` → `lower(host):slugify(label)[:lower(uuid…)]`. A bare
 * token with no `:` (not an instance handle) is returned unchanged.
 */
export function canonicalAddress(addr: string): string {
  if (typeof addr !== "string" || addr.length === 0) return addr;
  // Subagent handle `<instance>~<name>` (DEC subagents): the `~name` is
  // case-sensitive and charset-unrestricted — canonicalize ONLY the instance
  // part and keep `~name` verbatim, else two siblings differing by case
  // (…~Researcher vs …~researcher) collapse into one inbox (isolation break).
  const tilde = addr.indexOf("~");
  if (tilde >= 0) {
    return canonicalAddress(addr.slice(0, tilde)) + addr.slice(tilde);
  }
  const parts = addr.split(":");
  if (parts.length < 2) return addr;
  const [host, label, ...rest] = parts;
  const canonLabel = label.length === 0 ? label : slugify(label);
  return [host.toLowerCase(), canonLabel, ...rest.map((segment) => segment.toLowerCase())].join(":");
}

/**
 * True iff `addr` is host-qualified (`host:label[:uuid…]`, optionally a
 * subagent `…~name`): a non-empty host segment AND a non-empty label segment.
 * A bare token with no ":" (e.g. "radar-immobilier"), ":label" (empty host) or
 * "host:" (empty label) is NOT addressable — it mis-routes to an orphan inbox.
 */
export function isHostQualifiedAddress(addr: string): boolean {
  if (typeof addr !== "string" || addr.length === 0) return false;
  // Subagent handle `<instance>~<name>`: validate ONLY the instance part before "~".
  const tilde = addr.indexOf("~");
  const instancePart = tilde >= 0 ? addr.slice(0, tilde) : addr;
  const parts = instancePart.split(":");
  return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0;
}

/**
 * Throws a user-facing Error if `addr` is not host-qualified. Message names
 * the fix. Used to reject bare-label sends (e.g. "radar-immobilier" → must be
 * "claude:radar-immobilier"): the same label can exist on several hosts.
 */
export function assertHostQualifiedAddress(addr: string, role = "recipient"): void {
  if (!isHostQualifiedAddress(addr)) {
    throw new Error(
      `h2a: ${role} "${addr}" is not host-qualified — address it as <host>:<label> (e.g. claude:${String(addr).replace(/^:+/, "") || "agent"}). A bare label is ambiguous (the same label can exist on several hosts) and routes to an orphan inbox nobody reads. Resolve the exact peer via discover.`
    );
  }
}

/** Inbox dir for an actor, keyed on its **canonical** handle (case-folded). */
export function inboxDir(paths: LocalStorePaths, actor: string): string {
  return join(paths.inbox, safePathSegment(canonicalAddress(actor)));
}

/**
 * Inbox dir keyed on the RAW (pre-canonicalization) handle — read-only fallback
 * so envelopes deposited before the case-fold fix are still recovered. Writes
 * always go to the canonical dir; these raw dirs drain as messages are popped.
 */
export function inboxDirRaw(paths: LocalStorePaths, actor: string): string {
  return join(paths.inbox, safePathSegment(actor));
}

export function outboxDir(paths: LocalStorePaths, actor: string): string {
  return join(paths.outbox, safePathSegment(canonicalAddress(actor)));
}

/** Outbox dir keyed on the RAW handle — read-only fallback for pre-case-fold copies. */
export function outboxDirRaw(paths: LocalStorePaths, actor: string): string {
  return join(paths.outbox, safePathSegment(actor));
}
