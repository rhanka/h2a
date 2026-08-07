# Spec finale — Native CLI Enrollment `@sentropic/llm-mesh`, Version 0.6-final
**Decisions**: Q1A · Q2B · Q3A (voir §0)  
**Repos**: `sentropic` (owner principal) · `h2a` (intégration seule)

---

## 0. Décisions de design (arrêtées)

| | Décision |
|---|---|
| **Q1A** | Sentropic est owner du callback/poll. H2a ouvre le browser ou affiche le `userCode`, puis appelle `facade.waitForCallback(enrollmentId)` (Cloud Code) ou `facade.pollForCompletion(enrollmentId)` (Codex). Le `code` PKCE ne transite jamais par h2a. |
| **Q2B** | `abort` = `facade.release(acquisition)` — libère la réservation sans outcome et sans affecter la santé du compte. Pas de nouveau statut `cancelled`. Tous les autres cas (200, 401/403, 429, erreur SSE) génèrent exactement un outcome via `execute()`. |
| **Q3A** | `SessionEntry` h2a porte seulement `transportConstraints` (non-secret). À chaque requête : `service.acquire(constraints)` → sentropic fournit le token live. Aucun token ne persiste dans `SessionEntry`, `GATEWAY_ACCOUNTS`, `llm-mesh.json` ou env durable h2a. |

Applicable aux 3 providers (Cloud Code, Codex, Claude Code portail).

---

## 1. RACI — implémentable

| Composant | **R** (code) | **A** (décision) |
|---|---|---|
| `enrollment/contracts.ts` — tous les types §3 | sentropic | sentropic |
| `LocalAccountTransportService` — keyring, hydratation, refresh atomique | sentropic | sentropic |
| `LlmMeshFacade` — façade complète §5, export `/facade` | sentropic | sentropic |
| `CloudCodeEnrollmentProvider` — adapter depuis `antigravity-provider-auth.ts` | sentropic | sentropic |
| `CodexEnrollmentProvider` — device flow + poll interne | sentropic | sentropic |
| `ClaudeCodeEnrollmentProvider` — portail uniquement | sentropic | sentropic |
| `cloud-code-transport.ts` — builder daily-cloudcode + SSE + outcomes | sentropic | sentropic |
| `auth.ts` — ajout `cloud-code`, `CloudCodeRuntimeMetadata` | sentropic | sentropic |
| Export maps `/facade`, `/enrollment`, `/node`, `/transport/cloud-code` | sentropic | sentropic |
| Broker portail `llm-account-transports.ts` Cloud Code | sentropic | sentropic |
| `KeyringAdapter` + implémentations (Linux/macOS/env) | sentropic | sentropic |
| **Callback loopback / device poll** | **sentropic** | sentropic |
| **`recordOutcome()` dans `execute()`** | **sentropic** | sentropic |
| **`release(acquisition)`** | **sentropic** | sentropic |
| CLI `h2a llm-mesh enroll cloud-code\|codex` → `facade.enroll()` + `waitForCallback\|pollForCompletion()` | h2a | h2a |
| `SessionEntry` → `transportConstraints` uniquement (0 token) | h2a | h2a |
| Requête runtime → `service.acquire()` → `facade.getAdapter().execute()` | h2a | h2a |
| `proxy-cloud-code.ts` thin wrapper + `accounts.ts` `cloud-code` dans `GatewayUpstreamTransport` | h2a | h2a |
| Bridge session non-secret : `model-catalog.ts`, `sticky.ts`, router, rebind/fallback fermé | h2a | h2a |
| Migration : suppression `GATEWAY_ACCOUNTS` / `llm-mesh.json` / env token Cloud Code | h2a | h2a |
| `package.json` h2a-runtime : `@sentropic/llm-mesh` en dépendance | h2a | h2a |

---

## 2. Architecture

```
@sentropic/llm-mesh
  src/
    enrollment/
      contracts.ts         — types complets §3
      cloud-code.ts        — CloudCodeEnrollmentProvider
      codex.ts             — CodexEnrollmentProvider
      claude-code.ts       — ClaudeCodeEnrollmentProvider (portail only)
      pkce.ts              — helpers PKCE + loopback server (sentropic-owned)
      device-poll.ts       — polling device flow Codex (sentropic-owned)
    service/
      local-account-transport-service.ts
      facade.ts            — LlmMeshFacade §5
    transport/
      cloud-code-transport.ts     — daily-cloudcode builder + SSE §6
    auth.ts                — + 'cloud-code', CloudCodeRuntimeMetadata §7
    account-transports.ts  — port existant
  package.json
    exports:
      "."           → index
      "./facade"    → service/facade
      "./enrollment"→ enrollment/contracts
      "./node"      → node entrypoint
      "./transport/cloud-code" → transport/cloud-code-transport

@sentropic/api
  services/cloud-code-provider-auth.ts     — adapter antigravity-provider-auth.ts
  services/llm-account-transports.ts — broker DB Cloud Code (pattern codex/claude)

h2a-runtime
  src/llm-mesh.ts                   — CLI enroll → façade; runtime → acquire
  src/llm-gateway-runtime/
    accounts.ts                     — + 'cloud-code' dans GatewayUpstreamTransport
    proxy-cloud-code.ts             — thin wrapper → facade.getAdapter('cloud-code').execute()
    session-entry.ts                — transportConstraints seulement (0 token)
    model-catalog.ts                — + modèles Cloud Code
    sticky.ts                       — + contraintes Cloud Code
```

---

## 3. Types complets — state machine enrollment

```typescript
// @sentropic/llm-mesh/enrollment/contracts.ts

// Session retournée à h2a — h2a ouvre browser ou affiche userCode
export type EnrollmentSession =
  | { kind: 'authorization-url'; enrollmentId: string; url: string; expiresAt: string }
  | { kind: 'device-code'; enrollmentId: string; verificationUrl: string;
      userCode: string; pollIntervalMs: number; expiresAt: string };

// État persisté côté sentropic — jamais exposé à h2a
interface EnrollmentState {
  enrollmentId: string;       // ULID
  providerId: 'cloud-code' | 'codex' | 'claude-code';
  ownerScope: string;         // 'cli:hostname' ou userId portail
  pkceVerifier: string;       // S256 — secret serveur sentropic
  pkceState: string;          // nonce CSRF
  redirectUri: string;        // validé à la création
  configVersion: string;      // version config au moment du start()
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;        // consommation unique — idempotent après
  cancelledAt?: string;
}

export interface StartEnrollmentInput {
  configRef: string;          // ref vault — jamais le secret
  mode: 'cli' | 'portal';
  redirectUri: string;
  ownerScope: string;
}

// CompleteEnrollmentInput : usage interne sentropic uniquement
// h2a n'appelle JAMAIS complete() directement
interface CompleteEnrollmentInput {
  enrollmentId: string;
  code: string;              // reçu par le loopback sentropic-owned
}

export interface PreparedCredential {
  accountId: string;         // ULID généré
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  authClientConfigVersion: string;  // version liée à l'enrollment
  accountEmail?: string;
}

// RefreshInput : usage interne LocalAccountTransportService
interface RefreshInput {
  accountId: string;
  credentialVersion: string; // résout config HISTORIQUE — pas hot-reload
}

export interface ResolvedProviderMetadata {
  cloudaicompanionProject?: string; // Cloud Code
  cloudCodeUserAgentVersion?: string;     // Cloud Code
  [key: string]: unknown;
}

// Transaction atomique après complete() réussi :
// 1. resolve() → ResolvedProviderMetadata (si échec → reauth_required, throw)
// 2. persist AccountPublic + CredentialEnvelope atomiquement
// 3. status → 'active'
// Aucune des étapes n'est exposée individuellement à h2a
```

---

## 4. `LocalAccountTransportService`

```typescript
// @sentropic/llm-mesh/service/local-account-transport-service.ts

export class LocalAccountTransportService {
  constructor(
    private readonly keyring: KeyringAdapter,           // Linux/macOS/env
    private readonly providers: Map<string, EnrollmentProvider>,
    private readonly configResolver: ConfigResolver,    // ref vault → secrets
  ) {}

  // ── Enrollment (appelé via façade par h2a CLI) ──────────────────────────
  async enroll(providerId: string, input: StartEnrollmentInput): Promise<EnrollmentSession>
  // Cloud Code: démarre serveur loopback, retourne authorization-url
  // Codex: appelle deviceauth/usercode, retourne device-code

  async waitForCallback(enrollmentId: string): Promise<{ accountId: string; label: string }>
  // Cloud Code uniquement: attend le callback loopback, échange le code,
  // appelle resolve(), persiste atomiquement, retourne accountId

  async pollForCompletion(enrollmentId: string): Promise<{ accountId: string; label: string }>
  // Codex uniquement: poll /deviceauth/token jusqu'à succès/expiry,
  // échange code, persiste atomiquement, retourne accountId

  async cancel(enrollmentId: string): Promise<void>
  // Idempotent — libère le loopback/poll, marque cancelledAt

  // ── Runtime (appelé via façade par h2a gateway) ─────────────────────────
  async acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition>
  // Si token expiré → refresh atomique avant retour
  // Refresh échoue → status reauth_required + throw AccountTransportAcquireError
  // Rotation refresh token persistée atomiquement avant retour

  async release(acquisition: AccountTransportAcquisition): Promise<void>
  // Q2B: abort → release(), libère réservation, 0 impact santé compte

  // ── Interne — jamais exposé à h2a ───────────────────────────────────────
  private async completeEnrollment(input: CompleteEnrollmentInput): Promise<void>
  private async refreshToken(input: RefreshInput): Promise<PreparedCredential>
  private async persistCredential(pub: AccountPublic, env: CredentialEnvelope): Promise<void>
  private async markReauthRequired(accountId: string): Promise<void>
}
```

---

## 5. Façade opaque — export `@sentropic/llm-mesh/facade`

```typescript
// Seule interface importée par h2a
export interface LlmMeshFacade {
  // CLI enrollment
  enroll(providerId: 'cloud-code' | 'codex' | 'claude-code', input: StartEnrollmentInput): Promise<EnrollmentSession>
  waitForCallback(enrollmentId: string): Promise<{ accountId: string; label: string }>  // Cloud Code
  pollForCompletion(enrollmentId: string): Promise<{ accountId: string; label: string }> // Codex
  cancel(enrollmentId: string): Promise<void>

  // Runtime gateway (Q3A)
  acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition>
  release(acquisition: AccountTransportAcquisition): Promise<void>  // Q2B abort

  // Adapter par provider
  getAdapter(providerId: 'cloud-code' | 'codex' | 'claude-code'): ProviderAdapter
}

export interface ProviderAdapter {
  // execute() appelle recordOutcome() automatiquement (sentropic-owned)
  // h2a ne touche JAMAIS recordOutcome()
  execute(
    acquisition: AccountTransportAcquisition,
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>
}

export interface FacadeOptions {
  configResolver: ConfigResolver;  // résout refs vault → ProviderSecrets
  keyring?: KeyringAdapter;        // injecté par h2a-runtime/node
  mode: 'cli' | 'portal';
}

export interface ProviderRequest {
  modelId: string;
  contents: unknown[];
  generationConfig?: unknown;
}

export type ProviderEvent =
  | { kind: 'content'; delta: string }
  | { kind: 'done'; usage: unknown }
  | { kind: 'error'; code: string; message: string };

export function createLlmMeshFacade(options: FacadeOptions): LlmMeshFacade;
```

---

## 6. Intégration h2a — contrat minimal

```typescript
// h2a-runtime/src/llm-mesh.ts — extension minimale

import { createLlmMeshFacade, LlmMeshFacade } from '@sentropic/llm-mesh/facade';

// CLI: h2a llm-mesh enroll cloud-code
const session = await facade.enroll('cloud-code', { configRef, mode: 'cli', redirectUri, ownerScope });
openBrowser(session.url);
const { accountId } = await facade.waitForCallback(session.enrollmentId);
// → accountId persisté dans config locale (non-secret)

// CLI: h2a llm-mesh enroll codex
const session = await facade.enroll('codex', { configRef, mode: 'cli', redirectUri, ownerScope });
displayUserCode(session.userCode, session.verificationUrl);
const { accountId } = await facade.pollForCompletion(session.enrollmentId);

// Runtime: chaque requête (Q3A — 0 token dans SessionEntry)
// SessionEntry contient seulement: { transportId: 'cloud-code', accountConstraints }
const acquisition = await facade.acquire({ transportProviderId: 'cloud-code', targetProviderId: 'gemini', ... });
try {
  for await (const event of facade.getAdapter('cloud-code').execute(acquisition, request, signal)) {
    // streamer vers le client
  }
  // recordOutcome(success) appelé automatiquement par execute() — sentropic-owned
} catch (err) {
  if (isAbort(err)) {
    await facade.release(acquisition); // Q2B — pas d'outcome
  }
  // autres erreurs: recordOutcome() appelé par execute() avant throw
}
```

**Fichiers h2a à modifier (Lot 3) :**
- `session-entry.ts` : supprimer `token`, ajouter `transportConstraints`
- `accounts.ts` : `cloud-code` dans `GatewayUpstreamTransport`; `SessionEntry` non-secret
- `model-catalog.ts` : modèles Cloud Code
- `sticky.ts` : contraintes session Cloud Code
- `proxy-cloud-code.ts` : thin wrapper `execute()` → SSE h2a
- `llm-mesh.ts` : supprimer sérialisation `GATEWAY_ACCOUNTS` / token dans JSON

---

## 7. `auth.ts` — changements sentropic

```typescript
export const accountTransportProviderIds = ['codex', 'cloud-code', 'claude-code'] as const;
export const executableAccountTransportProviderIds = ['codex', 'cloud-code', 'claude-code'] as const;

export interface CloudCodeRuntimeMetadata {
  cloudaicompanionProject: string;   // non vide
  cloudCodeUserAgentVersion: string;       // non vide
  authClientConfigVersion: string;   // non vide
}
export const isCloudCodeRuntimeMetadata = (m: unknown): m is CloudCodeRuntimeMetadata =>
  typeof m === 'object' && m !== null &&
  typeof (m as any).cloudaicompanionProject === 'string' && (m as any).cloudaicompanionProject.length > 0 &&
  typeof (m as any).cloudCodeUserAgentVersion === 'string' && (m as any).cloudCodeUserAgentVersion.length > 0 &&
  typeof (m as any).authClientConfigVersion === 'string' && (m as any).authClientConfigVersion.length > 0;
```

---

## 8. Wire facts Cloud Code (validés mitmproxy)

**resolve()** (OBLIGATOIRE avant activation — sinon `reauth_required`)
```
POST daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
Authorization: Bearer {access_token}
User-Agent: antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)
{"metadata": {"ideType": "ANTIGRAVITY"}}
→ { cloudaicompanionProject }   — jamais de fallback 'default-cli-project'
```

**execute()** — format requête
```json
POST daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
{ "project": "...", "requestId": "{uuid}", "model": "{modelId}",
  "userAgent": "antigravity", "request": { "contents": [...], "generationConfig": {...} } }
```

**Outcomes (Q2B — exécutés par execute(), jamais par h2a)**
```
200 OK          → success (après consommation complète SSE)
401 / 403       → auth_failed → reauth_required ce compte uniquement
429 + Retry-After → rate_limited + retryAfterMs → cooldown
erreur SSE      → failed
abort           → facade.release(acquisition) — 0 outcome
```

---

## 9. Plan de réalisation — 4 lots

### Lot 1 — Contrats sentropic (bloque tout) · **Owner: sentropic**
1. `enrollment/contracts.ts` — tous les types §3
2. `service/facade.ts` — `LlmMeshFacade` complet avec `FacadeOptions`, `ProviderRequest`, `ProviderEvent`
3. `service/local-account-transport-service.ts` — interface + signatures
4. `auth.ts` — `cloud-code` + `CloudCodeRuntimeMetadata`
5. Export maps `package.json`

**Gate de sortie**: `@sentropic/llm-mesh/facade` compile; consumer h2a peut importer avec un mock.  
**Sync**: sentropic notifie h2a → Lot 3 peut démarrer.

### Lot 2 — Providers + transport sentropic (parallèle Lot 3 après Gate Lot 1) · **Owner: sentropic**
1. `enrollment/cloud-code.ts` — PKCE loopback, waitForCallback, cancel
2. `enrollment/codex.ts` — device flow, pollForCompletion
3. `enrollment/claude-code.ts` — portail uniquement
4. `transport/cloud-code-transport.ts` — builder daily-cloudcode + SSE + outcomes
5. `service/local-account-transport-service.ts` — implémentation complète
6. `node/keyring/` — Linux/macOS/env (keytar ou @kwlad/keystore)

### Lot 3 — Bridge session h2a (après Gate Lot 1) · **Owner: h2a**
1. `package.json` h2a-runtime : `@sentropic/llm-mesh`
2. `session-entry.ts` : `transportConstraints` (supprimer token)
3. `accounts.ts` : `cloud-code` dans `GatewayUpstreamTransport`
4. `model-catalog.ts` + `sticky.ts` : entrées Cloud Code
5. `proxy-cloud-code.ts` : thin wrapper execute() → SSE
6. `llm-mesh.ts` : CLI enroll cloud-code/codex via façade; supprimer GATEWAY_ACCOUNTS token
7. Migration : aucun token Cloud Code dans JSON/env durable

**Gate de sortie**: `h2a llm-mesh enroll cloud-code` fonctionne avec mocks sentropic.  
**Exécutable seulement après Lot 2** complet.

### Lot 4 — Tests + portail · **Owner: sentropic** (portail) + **h2a** (acceptance)

| Test | Owner |
|---|---|
| Fixtures Cloud Code (refresh, UA, envelope, outcomes, abort=release) | sentropic |
| OAuth (PKCE, state/nonce, replay, rotation, config historique retiré) | sentropic |
| Multi-tenant (isolation userId, ULID, project non-PK, SQL/RLS) | sentropic |
| Concurrence refresh multi-instance (CAS/DB, pas seulement Map locale) | sentropic |
| h2a acceptance (enrollment sans CLI, 0 token dans SessionEntry) | h2a |
| Acquisition/outcomes (401, 429+Retry-After, erreur SSE, abort=release) | h2a |
| Routage (Cloud Code seul, 0 dégradation) | h2a |

---

## 10. Critères d'acceptation (13 — sans contradiction)

1. **Fixtures Cloud Code** : refresh form-urlencoded, UA exact, 0 fallback projet, envelope racine correct, requestId UUID unique, abort=release, SSE/error/outcome
2. **OAuth** : PKCE S256, state/nonce mismatch, replay/expiry/cancel, provider denial, rotation, config historique **retiré** → erreur explicite, 0 secret dans logs ni payload
3. **Multi-tenant** : deux users ne peuvent jamais acquérir le compte l'un de l'autre (SQL/RLS, pas filtre mémoire)
4. **Concurrence** : un seul refresh par account — single-flight multi-instance (CAS/DB portail)
5. **h2a acceptance** : enrollment + refresh Cloud Code sans CLI provider présent; `waitForCallback` reçoit accountId, jamais de code
6. **Claude local** : erreur explicite, pas de fallback silencieux
7. **Compilation** : consumer h2a compile contre `/facade` exporté; 0 import deep/non-exporté
8. **Frontière h2a** : `SessionEntry` sans token; 0 token sentropic dans JSON/env/GATEWAY_ACCOUNTS; `acquire → execute → release/outcome` sans fallback GCP
9. **Refresh/persistence** : rotation atomique avant retour de `acquire()`; reprise après redémarrage; config historique retiré → `reauth_required` seulement ce compte; 0 autre compte impacté
10. **State machine** : `waitForCallback`/`pollForCompletion` ne reçoivent jamais le code; `cancel` idempotent; state/nonce validés; replay/timeout/annulation couverts
11. **Outcomes Q2B** : abort → `release()` (0 outcome, 0 impact santé); 200/401/403/429/erreur SSE → exactement un outcome via `execute()`; 0 réservation abandonnée silencieusement
12. **Données** : ULID immuable, project non-PK, `revoked` persistant non-acquérable, disconnect/revoke sans toucher keyring natif
13. **Routage** : contrainte Cloud Code → daily-cloudcode uniquement; 0 dégradation vers Vertex ou autre pool
