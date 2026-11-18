# Review Dossier — Agy `1.5.9` (`xcli` R37)

- **Date**: 2026-11-15
- **Supersedes**: `docs/reviews/xcli-r32-agy-1_5_3.md` (`1.5.3`)
- **Executable path**: `/home/antoinefa/.local/bin/agy`
- **Reported version**: `1.5.9` (`agy --version`)
- **Executable size**: `265700040` bytes
- **Executable SHA-256**: `39816d49d5ab92229952987225c23ea3fed7580699dcb4a444e0388e0ac1ce43`

## 1. Embedded `jetbox_state_pb` Descriptor Evidence

Carved directly from the read-only ELF image `/home/antoinefa/.local/bin/agy` (`1.5.9`):

| Descriptor blob | Byte offset | Length | SHA-256 | Delta vs `1.5.2` / `1.5.3` |
|---|---:|---:|---|---|
| `PostOnboardingState` | `108754531` | `103` | `e479351811fe1686621bad52f28a1277fadefbb28b8a0a8f3f0c9ba74ea6bf64` | Byte-identical (`0` delta) |
| `State.post_onboarding` | `108764464` | `77` | `ea25e8d8dd2d0234d4523f6e3f1b342c560ddec907250e8d3c12452e139488b1` | Byte-identical (`0` delta) |
| `PostOnboardingStepType` | `108765811` | `252` | `b3a87909f9ae41e884179f5e3126a8b027a1a54dc6648a968130bfb3220406c9` | Byte-identical (`0` delta) |

Required completed steps (`1..4`, unchanged):
1. `POST_ONBOARDING_STEP_TYPE_MANAGER_WELCOME`
2. `POST_ONBOARDING_STEP_TYPE_USAGE_MODE`
3. `POST_ONBOARDING_STEP_TYPE_AGENT_CONFIGURATION`
4. `POST_ONBOARDING_STEP_TYPE_ADD_WORKSPACE`

## 2. `StoredToken` File Fallback & `llm-mesh` `cloud-code` Projection

On the workstation, `agy` `1.5.9` uses `compositeTokenStorage` (`0x95d5100`), which stores OAuth credentials in the OS keyring when D-Bus Secret Service is reachable and falls back to `cliFileTokenStorage` (`0xa204240`) reading `.gemini/antigravity-cli/antigravity-oauth-token`.

Inside an isolated qualification cell (where `XDG_RUNTIME_DIR` points to the private cell `run` directory with no D-Bus socket), the OS keyring is unreachable by design, so `agy` reads `.gemini/antigravity-cli/antigravity-oauth-token` (`StoredToken` Go struct at `0xc990450`: `{ token: { access_token, token_type, refresh_token, expiry }, auth_method: "consumer", project_id, user_tier }`) and `ValidateStoredToken` (`0xa204e80`) resolves the consumer OAuth client (`0xa200880`) and refreshes the token inside the writable cell `HOME` using `token.refresh_token`.

When `.gemini/antigravity-cli/antigravity-oauth-token` is absent in the owner `HOME` and the `agy` (`cloud-code`) seat is enrolled in `llm-mesh`, `acquireAgyOauthToken` (`scripts/xcli-llm-mesh-seats.mjs`) acquires the `cloud-code` grant read-only (`now: 0`) and projects the `StoredToken` JSON into the isolated `0600` seat envelope.
