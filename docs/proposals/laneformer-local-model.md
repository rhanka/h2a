# Proposal: expose a local OpenAI-compatible model (kog / Laneformer-2B) in the LLM mesh

**Status:** DRAFT — routed for architect + h2a review (provider/gateway change, not to be merged solo).
**Branch:** `feat/laneformer-local-model`. **Requested by:** kog owner. **Backend:** GPU sidecar.

## Goal
Let the mesh route a named model `laneformer-2b` to a **local** OpenAI-compatible upstream (kog's GPU sidecar,
`http://localhost:8089`, verified `POST /v1/chat/completions`) **without** hijacking the global codex/OpenAI
upstream (`OPENAI_UPSTREAM_URL` is process-global today, so an env-only override would send *all* openai-pool
traffic to kog).

## Why a code change (env-only is insufficient)
- `model-catalog.ts` already supports env-added entries via `OPENAI_MODEL_MAP`, and `proxy-openai.ts` resolves
  its upstream from `OPENAI_UPSTREAM_URL ?? "https://api.openai.com"`. But that upstream is **single/global** →
  cannot route only `laneformer-2b` to kog while codex models still go to Codex.
- `AccountDescriptor` already has `modelIds?` (accounts scoped to model ids) — so per-model routing exists; only
  the **per-account upstream URL** is missing.

## Proposed minimal change (3 edits, low-risk, fallback-preserving)
1. **`accounts.ts`** — add an optional field to `AccountDescriptor`:
   ```ts
   baseUrl?: string; // OpenAI-compatible upstream for this account; defaults to OPENAI_UPSTREAM_URL
   ```
2. **`proxy-openai.ts`** — at the OpenAI upstream fetch, use the selected account's base if present:
   ```ts
   const base = account.baseUrl ?? OPENAI_BASE;      // OPENAI_BASE unchanged as the default
   return fetch(`${base}/v1/chat/completions`, { ... });
   ```
   (Pure fallback: existing codex/openai accounts with no `baseUrl` keep hitting `OPENAI_BASE` exactly as today.)
3. **`model-catalog.ts`** — add a catalog entry:
   ```ts
   { id: "laneformer-2b", provider: "codex", upstreamModel: "kogai/laneformer-2b-it",
     accountPool: "codex", inputProtocol: "anthropic.messages", outputProtocol: "anthropic.messages",
     capabilities: ["streaming"], defaultPolicy: "round-robin", aliases: ["laneformer","kog"] }
   ```
4. **Account config** (mesh enrollment, not code): a local account scoped to the model:
   ```json
   { "id": "kog-local", "provider": "openai", "label": "kog Laneformer (local GPU)",
     "token": "not-needed", "baseUrl": "http://localhost:8089", "modelIds": ["laneformer-2b"] }
   ```

## Review questions for architect
- Is per-account `baseUrl` the right seam, or should this be a first-class `provider: "local"` + `AccountPool:
  "local"` (cleaner separation, larger diff touching the pool unions/`accountPoolForProvider`/`routeForProvider`)?
- Does account selection reliably pick the `modelIds`-scoped local account for `laneformer-2b` before falling
  back to the general codex pool? (needs a `sticky.ts` / selection test.)
- Auth: kog ignores the bearer token; confirm the proxy still sends a (dummy) `Authorization` header without
  side effects.

## kog side (ready, verified)
Sidecar is OpenAI-compatible (`/v1/chat/completions`, `/v1/models`), GPU backend, lossless speculative
(`PROMPT_LOOKUP_N`). See `kog/GATEWAY.md` and `kog/PERF.md`. Measured: ~22 tok/s (23–148 with speculative).
