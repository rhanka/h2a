/**
 * EVO-12 P2 (mode 3) — hono routes for the broker login. Thin wrapper over
 * `createBrokerLogin`: `/authorize` starts a login (302 → 39-auth) instead of
 * the single-tenant consent form; `/oidc/callback` completes it (exchange →
 * sub → per-user root) and hands off to the provider to issue the claude.ai
 * authorization code, then 302s back to claude.ai.
 *
 * `issueClaudeaiCode` is injected (the SingleTenantOAuthProvider's code issuance,
 * bound to the resolved user/root) → routes are testable via `app.request` with
 * a mock IdP, no provider/network.
 */
import { Hono } from "hono";

import type { BrokerLogin } from "./broker-login.js";

export interface BrokerRoutesDeps {
  readonly brokerLogin: BrokerLogin;
  /**
   * Issue the claude.ai authorization code for the original request, bound to
   * the authenticated user/root, and return the claude.ai redirect URL
   * (`<redirect_uri>?code=…&state=…`).
   */
  readonly issueClaudeaiCode: (
    claudeai: Record<string, string>,
    ctx: { sub: string; root: string }
  ) => string | Promise<string>;
  /** Callback path registered at 39-auth. Default `/oidc/callback`. */
  readonly callbackPath?: string;
}

export function buildBrokerRoutes(deps: BrokerRoutesDeps): Hono {
  const router = new Hono();
  const callbackPath = deps.callbackPath ?? "/oidc/callback";

  // claude.ai lands here (DCR+PKCE already done against our self-AS); we redirect
  // the human to 39-auth to actually log in.
  router.get("/authorize", (c) => {
    c.header("Cache-Control", "no-store");
    const claudeai = c.req.query() as Record<string, string>;
    const { redirectUrl } = deps.brokerLogin.start(claudeai);
    return c.redirect(redirectUrl, 302);
  });

  // 39-auth redirects back here with code+state; we exchange, resolve the user's
  // root, issue the claude.ai code, and bounce back to claude.ai.
  router.get(callbackPath, async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.json({ error: "invalid_request", error_description: "missing code/state" }, 400);
    }
    try {
      const done = await deps.brokerLogin.complete(state, code);
      const redirectUrl = await deps.issueClaudeaiCode(done.claudeai as Record<string, string>, {
        sub: done.sub,
        root: done.root
      });
      return c.redirect(redirectUrl, 302);
    } catch (err) {
      return c.json({ error: "access_denied", error_description: (err as Error).message }, 400);
    }
  });

  return router;
}
