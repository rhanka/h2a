# EVO-12 — Hosted h2a MCP on Scaleway k8s, local-first + controlled remote enrollment — framing

**Date**: 2026-05-31 · **Status**: framing (intention + ratified model) — NOT a full spec/DEC yet · **Refers**: DEC-058 (k8s-sidecar), DEC-067 (k8s-tenant RWX PVC), DEC-073/075/076/077 (signed remote transport / `remote serve`), DEC-116 (identity/NHI), EVO-11 (bridge NHI). **References**: `~/src/mcp-wave` (MCP-on-Kapsule + OAuth patron) ; `~/src/sentropic/packages/auth-hono` + `auth-ui` (= **39-auth**, WebAuthn + OAuth providers ; specs `sentropic/spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`, `WORKFLOW_AUTH.md`).

## Intention (PRINCIPAL, verbatim)
> « lancer le chantier pour host[er] sur k8s scw le mcp et pouvoir l'enrôler aussi sur claude.ai (à la fois pour piloter des claude, mais **surtout pour que claude.ai puisse avoir des infos**). première étape mono tenant, deuxième étape multi tenant, comme mcp wave (concerte-toi sur le modèle pour que le contrat soit au clair avec 39-auth). »

## Ratified model (PRINCIPAL, 2026-05-31)
- **Hosting = Scaleway Kapsule**, the same pattern as `mcp-wave` (`docs/superpowers/specs/2026-05-20-wp-ops-01-oauth-kapsule-design.md`). Reuse h2a's existing **k8s-tenant + sidecar renderers** (DEC-067/058) and the **remote transport** (`runtime/remote/serve`). The MCP is served over HTTP (not just stdio).
- **Auth = 39-auth as the OIDC IdP** *(ratified)*. claude.ai's remote-MCP connector runs the **OAuth/OIDC flow against 39-auth** (auth-hono); the **hosted h2a-MCP validates the 39-auth token** (issuer + JWKS); the token claims (**human subject + tenant/org + scopes**) **map to an h2a identity/workspace**. Two distinct planes, kept clean:
  - **human → MCP** = 39-auth (SSO / WebAuthn / OAuth) — the new layer.
  - **agent ↔ agent** = the ed25519 **keyring** (DEC-116) — unchanged anchor.
- **Phase 1 = mono-tenant + READ-first** *(ratified)*. Expose to claude.ai the **read tools** (`discover_sessions`/`discover_instances`, `inbox` read, `nhi_inventory`/`nhi_report`, presence) so **claude.ai *has* the info** (the primary goal). **Driving** claudes (`drive`/`send`/negotiate) = **Phase 1bis behind a MANDATE authority gate** (reuse `H2A_AUTHORITY_MATRIX`; ties to EVO-1).
- **Phase 2 = multi-tenant**, patterned on mcp-wave: a **tenant = an h2a workspace/org**, isolated by the **tenant claim** in the 39-auth token (one hosted MCP, per-tenant `.h2a` root / scope). 

## The "contract with 39-auth" (the crux to pin before building)
A short, explicit contract — to confirm against `sentropic/spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md` + `WORKFLOW_AUTH.md`:
- **Issuer + JWKS**: the 39-auth OIDC issuer URL + JWKS endpoint the MCP validates against.
- **Required claims**: `sub` (human), a **tenant/org** claim (Phase 2 isolation key), and **scopes** (read vs drive — maps to the MANDATE gate).
- **Mapping**: `(sub, tenant)` → an h2a workspace + a human PRINCIPAL/EXECUTIF identity in that scope; the agents in the workspace stay keyring-anchored NHIs (the human token never signs engagements — preserves the invariant).
- **Token lifecycle**: refresh / expiry handled by claude.ai's OAuth client; the MCP is stateless-validate (no custody of human creds — analogous to the bridge sidecar holding only its own key).

## 2-package constraint
The HTTP-MCP + OIDC-validation + OAuth-metadata endpoints live in **`@sentropic/h2a-cli`** (extend `remote serve` + add the `/.well-known/oauth-*` + token-validation middleware). **No new package.** Core `@sentropic/h2a` stays pure (the token→identity *mapping* is a pure helper; the IO/HTTP stays in the CLI).

## Proposed slices
- **H1** — h2a-MCP over HTTP with **OIDC token validation** (39-auth issuer/JWKS) + pure **claim→h2a-identity mapping** + the read-tool surface (mono-tenant). The core deliverable.
- **H2** — **Kapsule deploy** manifests (extend the k8s-tenant renderer for SCW; image build/publish like mcp-wave).
- **H3** — **controlled claude.ai enrollment**: the OAuth connector metadata (`/.well-known/oauth-protected-resource` + dynamic client registration) claude.ai's remote-MCP expects; enrollment must be explicitly enabled by an operator and stays disabled by default until the multi-tenant policy exists.
- **H1bis** — drive/send tools behind the **MANDATE** authority gate (after EVO-1 self-drive lands).
- **H4** (Phase 2) — **multi-tenant** isolation by the tenant claim (per-tenant root/scope), mcp-wave-style.

## Build prerequisites (consult, before spec)
1. **Pin the 39-auth contract**: read `sentropic/spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md` + `WORKFLOW_AUTH.md`; confirm issuer/JWKS/claims with 39-auth's owner (no 39-auth agent on the h2a bus yet → consult via PRINCIPAL or enroll a `*:39-auth` peer).
2. **Study mcp-wave's oauth-kapsule** design + implementation (the proven SCW-OAuth path) — adapt, don't reinvent.
3. Confirm claude.ai's current **remote-MCP OAuth requirements** (the well-known endpoints + DCR it expects).

## REVISION 2026-05-31 (post Opus 4.8 review + 39-auth BR-39c)

The Opus review returned **revise** — and the load-bearing correction is now being resolved by the 39-auth side.

**39-auth IdP — was a false premise, now being BUILT (BR-39c).** At framing time `auth-hono` was WebAuthn/magic-link/session-cookie (an SSO *consumer*, no `/authorize` `/token` JWKS DCR). PRINCIPAL decision = **build the IdP first** — and 39-auth is doing exactly that (BR-39c: OAuth2/OIDC IdP block — DB schemas, endpoints, `<OAuthConsent/>`, mock-RP integration tests). So the EVO-12 "39-auth = IdP" model becomes real; EVO-12 H1 proceeds **in parallel** and federates to 39-auth once BR-39c lands.

**MUTUALISATION (capitalize — the big win): 39-auth signs its JWTs with Ed25519** — the **same curve as h2a's entire NHI/keyring** (ed25519 SPKI PEM + `signCanonical`/`verifyCanonical`). So:
- h2a **confirms Ed25519 is the right call** for 39-auth (we already run it in prod; recommend their Ed25519 + RS256-fallback exactly).
- **Shared crypto plane**: h2a can validate a 39-auth Ed25519 JWT with the *same* primitives it uses for keyring verification (one verification path, one key model). The JWKS = an ed25519 public key set, identical shape to the h2a registry's `publicKeys`.
- **Reuse, don't reinvent**: the token→identity mapping + JWT validation reuse h2a's existing ed25519 verify; no new crypto lib.
- Their **PostgreSQL** token/code store is fine (no premature Redis) — h2a doesn't depend on it; it only validates tokens against the JWKS.

**Opus corrections folded into the model:**
1. **HTTP-MCP is NET-NEW**, not "extend `remote serve`" (that's the envelope receiver). Add an HTTP-MCP entrypoint via the **MCP SDK + `@hono/mcp` Streamable HTTP**, mirroring mcp-wave. The proven base = **mcp-wave's `OAuthServerProvider`** (the MCP can be its own AS *and/or* validate 39-auth tokens once BR-39c lands).
2. **Read-only = a STRUCTURAL deployment invariant**, not a phase: no tool taking `privateKeyPem` (`sign`/`attest_comprehension`/`counteroffer`/`offer`) is ever routable on the hosted surface — the ed25519 private key must never travel on the wire (defends DEC-116/EVO-11 key custody). Hosted = a read-only tool allowlist; signing stays keyring-side.
3. **Auth context**: thread an authenticated `RequestContext` (from the OAuth middleware) into `callTool` + a pure `claim→workspace/role` resolver — this is core-CLI surgery in H1 (not a thin add).
4. **Multi-tenant (phase 2) = per-tenant store ROOT** (`<root>/<tenant>/.h2a`), NOT one MCP over a shared registry (the flat registry/inbox would cross-leak). Own DEC.
5. `renderK8sTenant` is a shared-RWX single-workspace renderer (wrong shape for tenant isolation) — H2 needs SCW Service/Ingress/TLS manifests adapted from mcp-wave's `deploy/scw/`, not that renderer as-is.

**Net**: model stands with 39-auth as IdP (now under construction, Ed25519 → mutualized with h2a), the hosted MCP is a new MCP-SDK HTTP entrypoint (read-only allowlist), and phase-2 isolation is root-per-tenant. EVO-12 H1 is now greenlit to start in parallel with BR-39c.

## REVISION 2026-06-01 (local-first remote enrollment gate)

Default user posture is **local h2a**. A hosted `sent-tech.ca` MCP can exist for
read-only remote access tests, but new connector enrollment is **off by
default** (`H2A_HOSTED_ENROLLMENT_ENABLED=false`). Enabling enrollment requires
an explicit operator action plus `OAUTH_CONSENT_SECRET`; without that opt-in,
Dynamic Client Registration and `/authorize` return `403 enrollment_disabled`.
This prevents accidental single-tenant enrollment before the multi-tenant
authorization/isolation layer is implemented.

## Note (related)
The identity migration (DEC-116) is now LIVE and minted one perennial NHI **per launch** (no stable agent-token) → id proliferation. A **stable-agent-token** follow-up (a logical agent keeps one id across relaunches) is recommended as a small priority WP — it also cleans up which tenant/agent a 39-auth-authenticated human maps onto here.
