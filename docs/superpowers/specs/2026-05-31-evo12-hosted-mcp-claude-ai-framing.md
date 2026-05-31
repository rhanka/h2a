# EVO-12 — Hosted h2a MCP on Scaleway k8s, enrollable from claude.ai — framing

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
- **H3** — **claude.ai enrollment**: the OAuth connector metadata (`/.well-known/oauth-protected-resource` + dynamic client registration) claude.ai's remote-MCP expects; documented enroll steps.
- **H1bis** — drive/send tools behind the **MANDATE** authority gate (after EVO-1 self-drive lands).
- **H4** (Phase 2) — **multi-tenant** isolation by the tenant claim (per-tenant root/scope), mcp-wave-style.

## Build prerequisites (consult, before spec)
1. **Pin the 39-auth contract**: read `sentropic/spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md` + `WORKFLOW_AUTH.md`; confirm issuer/JWKS/claims with 39-auth's owner (no 39-auth agent on the h2a bus yet → consult via PRINCIPAL or enroll a `*:39-auth` peer).
2. **Study mcp-wave's oauth-kapsule** design + implementation (the proven SCW-OAuth path) — adapt, don't reinvent.
3. Confirm claude.ai's current **remote-MCP OAuth requirements** (the well-known endpoints + DCR it expects).

## Note (related)
The identity migration (DEC-116) is now LIVE and minted one perennial NHI **per launch** (no stable agent-token) → id proliferation. A **stable-agent-token** follow-up (a logical agent keeps one id across relaunches) is recommended as a small priority WP — it also cleans up which tenant/agent a 39-auth-authenticated human maps onto here.
