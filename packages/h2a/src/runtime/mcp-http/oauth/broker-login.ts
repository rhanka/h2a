/**
 * EVO-12 P2 (mode 3) — broker-login state machine. The stateful heart of the
 * gateway: on claude.ai's /authorize, `start()` stores the claude.ai request +
 * a fresh upstream PKCE/state and returns the 39-auth /authorize URL to redirect
 * to; on the /oidc/callback, `complete()` looks the pending entry up by state,
 * exchanges the code at 39-auth for the user's `sub`, and resolves that user's
 * per-tenant root. The hono routes are thin wrappers over this.
 *
 * Deps injected (exchange / pkce / randomState / clock) → unit-testable against
 * a mock IdP, no network. Pending entries are single-use + time-boxed.
 */
import { buildUpstreamAuthorizeUrl, type H2AUpstreamOidcConfig, type UpstreamLogin } from "./oidc-rp.js";
import { rootForSub } from "./tenancy.js";

export interface BrokerLoginDeps {
  readonly config: H2AUpstreamOidcConfig;
  /** Bound `exchangeUpstreamCode(config, {code, codeVerifier}, fetch)`. */
  readonly exchange: (code: string, codeVerifier: string) => Promise<UpstreamLogin>;
  /** Base h2a root; the per-user root is `rootForSub(baseRoot, sub)`. */
  readonly baseRoot: string;
  /** Fresh opaque state per login (e.g. `randomToken()`). */
  readonly randomState: () => string;
  /** Fresh PKCE pair for the upstream leg. */
  readonly pkce: () => { verifier: string; challenge: string };
  readonly now?: () => number;
  /** Pending-login TTL (ms). Default 10 min. */
  readonly maxAgeMs?: number;
}

export interface BrokerStart {
  /** 39-auth /authorize URL to redirect the user to. */
  readonly redirectUrl: string;
  /** The upstream state (also the pending-entry key). */
  readonly state: string;
}

export interface BrokerComplete {
  /** The original claude.ai /authorize request, opaque to the broker — to resume issuing the claude.ai code. */
  readonly claudeai: unknown;
  /** The authenticated 39-auth user. */
  readonly sub: string;
  /** That user's per-tenant h2a root. */
  readonly root: string;
}

export interface BrokerLogin {
  start(claudeaiParams: unknown): BrokerStart;
  complete(state: string, code: string): Promise<BrokerComplete>;
  pendingCount(): number;
}

export function createBrokerLogin(deps: BrokerLoginDeps): BrokerLogin {
  const now = deps.now ?? Date.now;
  const maxAgeMs = deps.maxAgeMs ?? 600_000;
  const pending = new Map<string, { verifier: string; claudeai: unknown; at: number }>();
  return {
    start(claudeaiParams) {
      const { verifier, challenge } = deps.pkce();
      const state = deps.randomState();
      pending.set(state, { verifier, claudeai: claudeaiParams, at: now() });
      return {
        redirectUrl: buildUpstreamAuthorizeUrl(deps.config, { state, codeChallenge: challenge }),
        state
      };
    },
    async complete(state, code) {
      const entry = pending.get(state);
      if (!entry) throw new Error("broker: unknown state");
      pending.delete(state); // single-use
      if (now() - entry.at > maxAgeMs) throw new Error("broker: state expired");
      const login = await deps.exchange(code, entry.verifier);
      return { claudeai: entry.claudeai, sub: login.sub, root: rootForSub(deps.baseRoot, login.sub) };
    },
    pendingCount: () => pending.size
  };
}
