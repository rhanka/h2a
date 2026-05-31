/**
 * Agent-identity fix (DEC-116) — provider session resolver.
 *
 * The reconnect de-collision binds `(host, providerSessionId, workspaceId)` →
 * agentUuid. This module produces the **providerSessionId hint** for the host
 * the agent runs under. It is only a *routing hint*; the authority anchor is the
 * ed25519 key (proof-of-possession), not this string (see the spec, F1).
 *
 * Per-provider source (live-verified, 2026-05-30):
 *  - claude  → `env.CLAUDE_CODE_SESSION_ID` (inherited by the spawned MCP server).
 *  - remote  → the `@sentropic/remote` bridge injects `env.SESSION_ID` +
 *              `env.SESSION_WORKSPACE_ID` (authoritative, Pod-scoped).
 *  - codex / gemini / agy → NOT in the env; read the provider's on-disk
 *    transcript/cache, matched by cwd (codex rollout `payload.cwd`, gemini
 *    `.project_root`, agy `last_conversations.json`).
 *  - none found → `{ source: "none" }`; the caller mints a UUID keyed by the
 *    agent's keypair fingerprint (so reconnect-same-key reclaims, new-key mints).
 *
 * The per-host *dispatch* is pure and tested with injected `readers`; the real
 * filesystem scans live in `defaultProviderSessionReaders`.
 */

export type ProviderSessionSource = "env" | "bridge" | "transcript" | "none";

export interface ProviderSession {
  readonly providerSessionId?: string;
  readonly source: ProviderSessionSource;
  /** A workspace hint the host supplies authoritatively (only the bridge today). */
  readonly workspaceHint?: string;
}

/** I/O the resolver needs — injected so the dispatch is testable without a real FS. */
export interface ProviderSessionReaders {
  env(name: string): string | undefined;
  /** codex: newest `~/.codex/sessions/**` rollout whose `payload.cwd === cwd` → `payload.id`. */
  codexThreadForCwd(cwd: string): string | undefined;
  /** gemini: `~/.gemini/tmp/<dir>/.project_root === cwd` → that session's `sessionId`. */
  geminiSessionForCwd(cwd: string): string | undefined;
  /** agy: `~/.gemini/antigravity-cli/cache/last_conversations.json` map `cwd → uuid`. */
  agyConversationForCwd(cwd: string): string | undefined;
}

export interface ResolveProviderSessionInput {
  readonly host: string;
  readonly cwd: string;
  readonly readers: ProviderSessionReaders;
}

/**
 * Resolve the provider's native session id for `host` (a routing hint for
 * de-collision). Total — never throws; an unknown host or an absent source
 * yields `{ source: "none" }`.
 */
export function resolveProviderSession(input: ResolveProviderSessionInput): ProviderSession {
  const { host, cwd, readers } = input;
  switch (host) {
    case "claude": {
      const id = readers.env("CLAUDE_CODE_SESSION_ID");
      return id ? { providerSessionId: id, source: "env" } : { source: "none" };
    }
    case "remote": {
      const id = readers.env("SESSION_ID");
      const ws = readers.env("SESSION_WORKSPACE_ID");
      if (!id) return { source: "none" };
      return {
        providerSessionId: id,
        source: "bridge",
        ...(ws ? { workspaceHint: ws } : {})
      };
    }
    case "codex": {
      const id = readers.codexThreadForCwd(cwd);
      return id ? { providerSessionId: id, source: "transcript" } : { source: "none" };
    }
    case "gemini": {
      const id = readers.geminiSessionForCwd(cwd);
      return id ? { providerSessionId: id, source: "transcript" } : { source: "none" };
    }
    case "agy": {
      const id = readers.agyConversationForCwd(cwd);
      return id ? { providerSessionId: id, source: "transcript" } : { source: "none" };
    }
    default:
      return { source: "none" };
  }
}
