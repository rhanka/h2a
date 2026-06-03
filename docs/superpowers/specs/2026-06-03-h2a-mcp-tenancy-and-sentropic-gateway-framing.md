# Framing — h2a-mcp tenancy & the sentropic MCP gateway (cross-repo intention)

Status: **intention / framing only** — no spec, no code, no branch. Captured to
decide calmly later. Spans 3 repos: **h2a** (this), **sentropic** (the platform /
API), **39-auth** (the OIDC IdP, BR-39). The home of the decision is sentropic
**BR-39l** ("MCP + claude.ai connector") / BR-39h ("NHI+agents incl. h2a
connector"); this note is the h2a-side capture + pointer.

## Trigger

Does the hosted `h2a-mcp` service (EVO-12/13: self-AS OAuth, single-tenant,
read-only surface over one `H2A_ROOT`) make sense **without multi-tenant**?
Conclusion: **no, not as an end state** — standalone it is a demo. Its self-AS
authenticates "whoever holds the consent secret", not a *sentropic user*, and it
serves a *single* root. Real value needs: an **authenticated user** (39-auth) +
a **per-user root** (multi-tenant) + **platform-managed enrollment**.

## Grounded facts (recon 2026-06-02)

- **39-auth (BR-39c) is a real, deployed OIDC provider** at
  `sentropic.sent-tech.ca`: `authorization_code + PKCE + DPoP + id/access token
  Ed25519 + JWKS + introspection + revoke`. **Gaps:** no Dynamic Client
  Registration (`/register`), no refresh tokens, no `client_credentials` (BR-39d
  not started), `tenant_id` in schema but **not emitted as a claim** (BR-39e).
- **No MCP catalog / gateway exists in sentropic today** — it is planned
  (BR-39l, BR-39h, BR-42b). So this direction is on the roadmap, unbuilt.
- **The trust seam is already drawn** (sentropic
  `SPEC_EVOL_AUTH_IDP_STANDALONE.md`): *IdP owns identity+credential+scope;
  VALEUR/ATTENTION/CONFIANCE/MANDATE stay in h2a (seam #1).*
- **Hard constraint:** claude.ai remote MCP connectors **require DCR** (the
  client self-registers) — 39-auth has none. So 39-auth **cannot be the direct
  claude.ai AS today**; an MCP-side self-AS shim that *federates login to
  39-auth* is required (this is exactly what EVO-12's self-AS already is).

## Target architecture (recommended): a sentropic MCP gateway, one connector

One claude.ai connector → one sentropic MCP endpoint that:
1. does **DCR + OAuth** for claude.ai (the self-AS shim — reuse EVO-12);
2. **delegates user login to 39-auth** (OIDC `authorization_code`) — the gateway
   is *AS to claude.ai* and *RP to 39-auth* (broker pattern);
3. maps the 39-auth `sub` → **that user's h2a root** (multi-tenant);
4. exposes **namespaced tools** (`h2a_*`, later `wave_*`, …) → h2a is the first
   **catalog** entry; adding an MCP appears as new tools, no re-enrollment.

**One gateway connector vs one-connector-per-MCP:** gateway wins on user clicks
(1 vs N), central enrollment, central per-user scoping, catalog growth, and
**h2h2a** (see below). Per-MCP is only an ultra-simple interim.

## Why this unlocks h2h2a

Human↔human↔agent coordination needs **authenticated, distinct users** whose h2a
buses can be federated/mediated. Multi-tenant + platform identity is the
**prerequisite**: the EVO-11 remote bridge then generalizes to cross-tenant
coordination mediated by sentropic identity. h2h2a is a *consequence* of going
multi-tenant under the platform, not a separate build.

## What EVO-12/13 becomes (not wasted)

Reused as-is: the **self-AS DCR** (claude.ai needs it; 39-auth lacks it), the
**read-only surface**, the **mirror P1/P2/P3** ingester. Three deltas to reach
the target: (1) replace the consent-secret gate with a **39-auth OIDC login**;
(2) **per-user root** (`sub`→root); (3) optionally fold under a multi-MCP gateway.

## Accumulated decisions (for later — none blocking today)

1. **Gateway vs per-MCP connector** (recommend gateway).
2. **Where the gateway lives** — sentropic API (Hono, BR-39l) vs a dedicated
   service. Likely sentropic-owned (it holds the user→workspace mapping).
3. **Per-user h2a root model** — one root per user/workspace; how the gateway
   provisions/locates it (ties to the EVO-13 mirror: each user's agents mirror
   into *their* root).
4. **Sequencing vs 39-auth gaps** — DCR stays in the shim (39-auth needn't add
   it); but client scoping / `tenant_id` claim (BR-39e) matters for per-user.
5. **Enrollment UX** — sentropic shows the user a "connect to claude.ai" action
   that drives the DCR+OIDC flow for *their* session.

Until decided, `h2a-mcp` stays as-is: P1+P2 live, **remote enrollment OFF by
default**. No code changes implied by this note.
