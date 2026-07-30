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

// ─── WP-2: Resolve-before-send ──────────────────────────────────────────────

/**
 * The outcome of resolving a send target BEFORE depositing (WP-2).
 *
 * - `deliver`        — full id / subagent / an upstream-rejected bare label.
 * - `deliver-dormant` — bare alias, 0 live but ≥1 registered instance exists.
 * - `deliver-hint`   — bare alias with exactly 1 live full-id match; deposit to bare
 *                      dir (UNCHANGED destination), surface the uuid to the caller.
 * - `deliver-resolved` — a unique live display name, addressed as its instance.
 * - `list`           — a read found several live candidates.
 * - `refuse`         — phantom (0 live, 0 registered) | ambiguous write | malformed.
 *
 * SAFETY: only a unique display name is translated to its recorded instance.
 * Existing instance aliases retain their original destination.
 */
export type RecipientResolution =
  | { kind: "deliver"; reason?: string }
  | { kind: "deliver-dormant"; reason: string }
  | { kind: "deliver-hint"; liveCandidate: string; reason: string }
  | { kind: "deliver-resolved"; recipient: string; reason: string }
  | { kind: "list"; candidates: string[]; reason: string }
  | { kind: "refuse"; reason: string; candidates?: string[] };

/** A live presence can contribute both its stable instance and display name. */
export type LiveRecipient =
  | string
  | { readonly instance: string; readonly name?: string };

/** Pattern for a valid 12-hex UUID segment (case-insensitive). */
const UUID12_PATTERN = /^[0-9a-f]{12}$/i;

/**
 * Compute the canonical `host:label` key for an instance address by taking
 * only the first two colon-segments of the canonicalized form.
 */
function hostLabelKey(addr: string): string {
  const canonical = canonicalAddress(addr);
  const parts = canonical.split(":");
  return `${parts[0]}:${parts[1]}`;
}

function liveInstance(candidate: LiveRecipient): string {
  return typeof candidate === "string" ? candidate : candidate.instance;
}

function liveName(candidate: LiveRecipient): string | undefined {
  return typeof candidate === "string" ? undefined : candidate.name;
}

/** Target-side display-name key; strip the legacy `h2a:` marker only here. */
function targetDisplayNameKey(value: string): string {
  return value.trim().replace(/^h2a:/i, "").trim().toLowerCase();
}

/** Presence-side display-name key; preserve any prefix owned by the presence. */
function presenceDisplayNameKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve how a SEND to `target` should be handled.
 *
 * Does NOT deliver — the caller delivers. A unique display name resolves to
 * the recorded full instance; existing instance aliases keep their destination.
 * The `liveInstances` list comes from `listPresence(root)` so display names are
 * available alongside their immutable instance ids. Strings remain accepted for
 * callers that only need instance-id resolution.
 * The `registeredInstances` list comes from `store.listInstances().map(i => i.instance ?? i.id)`.
 */
export function resolveRecipient(opts: {
  target: string;
  liveInstances: readonly LiveRecipient[];
  registeredInstances: readonly string[];
  operation?: "read" | "write";
}): RecipientResolution {
  const { target, liveInstances, registeredInstances, operation = "write" } = opts;

  // 1. Subagent (contains `~`) — pass through unchanged.
  if (target.includes("~")) {
    return { kind: "deliver" };
  }

  // 2. Split on `:`.
  const parts = target.split(":");

  // 3. Full id: exactly 3 segments where seg3 is 12-hex.
  if (parts.length === 3 && UUID12_PATTERN.test(parts[2])) {
    return { kind: "deliver" };
  }

  // 4. Malformed 3-segment: seg3 is NOT 12-hex.
  if (parts.length >= 3) {
    const host = parts[0];
    const label = parts[1];
    return {
      kind: "refuse",
      reason:
        `'${target}' has a 3rd segment that is not a uuid — address the channel as ${host}:${label} or a live peer as ${host}:${label}:<uuid> (resolve via discover).`
    };
  }

  // 5. Resolve instance aliases and presence names together. A matching name
  // always yields its recorded instance; it never becomes an inbox key itself.
  const targetNameKey = targetDisplayNameKey(target);
  if (targetNameKey.length === 0) {
    return {
      kind: "refuse",
      reason: `'${target}' has an empty display-name key — provide a non-empty display name or an exact instance address.`
    };
  }

  const hostQualifiedAlias =
    parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  const aliasKey = hostQualifiedAlias ? hostLabelKey(target) : undefined;
  const nameKey = targetNameKey.includes(":") ? undefined : targetNameKey;
  const liveMatches: Array<{
    instance: string;
    matchedAlias: boolean;
    matchedName: boolean;
  }> = [];

  for (const candidate of liveInstances) {
    const instance = liveInstance(candidate);
    const matchedAlias = aliasKey !== undefined && hostLabelKey(instance) === aliasKey;
    const name = liveName(candidate);
    const presenceNameKey = name === undefined ? undefined : presenceDisplayNameKey(name);
    const matchedName =
      nameKey !== undefined &&
      presenceNameKey !== undefined &&
      presenceNameKey.length > 0 &&
      presenceNameKey === nameKey;
    if (matchedAlias || matchedName) {
      liveMatches.push({ instance, matchedAlias, matchedName });
    }
  }

  const aliasMatches = liveMatches.filter((match) => match.matchedAlias);
  const resolvedLiveMatches = aliasMatches.length > 0 ? aliasMatches : liveMatches;

  const registeredMatches = hostQualifiedAlias
    ? registeredInstances.filter((inst) => hostLabelKey(inst) === aliasKey)
    : [];

  if (resolvedLiveMatches.length > 1) {
    const candidates = resolvedLiveMatches.map((match) => match.instance);
    const reason =
      `'${target}' is ambiguous — ${resolvedLiveMatches.length} live agents share it; address the exact one (resolve via discover).`;
    if (operation === "read") {
      return { kind: "list", reason, candidates };
    }
    return {
      kind: "refuse",
      reason,
      candidates
    };
  }

  if (resolvedLiveMatches.length === 1) {
    const liveMatch = resolvedLiveMatches[0];
    if (liveMatch.matchedName && !liveMatch.matchedAlias) {
      return {
        kind: "deliver-resolved",
        recipient: liveMatch.instance,
        reason: `display name resolved to ${liveMatch.instance}.`
      };
    }
    const liveCandidate = liveMatch.instance;
    return {
      kind: "deliver-hint",
      liveCandidate,
      reason:
        `bare alias resolved to 1 live agent; deposited to the channel — prefer re-sending to ${liveCandidate} for direct delivery.`
    };
  }

  // A bare or malformed host-less token had no display-name match. The write
  // caller applies the host-qualified-address guard; the read caller does not
  // apply an equivalent guard and keeps the pass-through behavior.
  if (!hostQualifiedAlias) return { kind: "deliver" };

  // 0 live
  if (registeredMatches.length > 0) {
    return {
      kind: "deliver-dormant",
      reason:
        `no live session for '${target}'; deposited for wake (a registered agent exists).`
    };
  }

  if (operation === "read") return { kind: "deliver" };

  return {
    kind: "refuse",
    reason:
      `'${target}' matches no live or registered agent — likely a phantom/invented id or sub-label. Resolve via discover; do not invent labels.`
  };
}

// ─── WP-7: Reach Guard ──────────────────────────────────────────────────────

/**
 * Gate for REACHING paths (drumbeat relance / wake-another / remote drive).
 *
 * Unlike the inbox-put path, liveness is NOT a blocker for reaching: we
 * intentionally wake dormant agents.  Only a `refuse` outcome (phantom,
 * ambiguous, malformed) should block.  Wraps `resolveRecipient` so all
 * addressing discipline lives in ONE place.
 *
 * This is the REACH-GUARD CHOKEPOINT — the future governance/conductor gate
 * (clearance, conductor-liveness) hooks HERE via the `DrumbeatTickOptions`
 * integration in `watch.ts`, so every reach path inherits it.
 */
export function reachGuard(opts: {
  target: string;
  liveInstances: readonly LiveRecipient[];
  registeredInstances: readonly string[];
}): { ok: true } | { ok: false; reason: string; kind: string } {
  const r = resolveRecipient({ ...opts, operation: "write" });
  if (r.kind === "refuse") {
    return { ok: false, reason: r.reason, kind: r.kind };
  }
  return { ok: true };
}
