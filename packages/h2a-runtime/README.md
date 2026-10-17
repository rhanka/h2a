# h2a runtime

The heavy runtime is loaded by h2a. Session content v2 on this feature branch is
**preparatory and default off**. It is not a published or production-qualified F2
candidate. Importing its API starts no service and activates no collection.

## Session content composition

Use the explicit `@sentropic/h2a-runtime/session-content` entry. A trusted native
bootstrap supplies the independently pinned issuer, source and confirmation
clients, HTTPS resource origin, measured clock error, current native identities
and exact runtime/build hashes. It performs PKCE login and obtains an opaque
source handle through `SessionContentAuth`. A source handle grants no keyboard
or remote-action permission.

Create one `ContentFence` in an explicit private native-owned directory, one
`ConfirmationBudget`, one `ContentQueueBudget`, one `ArchiveBudget` and one
`NativeContentPolicies` per host. Never partition these budgets by a remotely
claimed binding or user ID. For each native session, construct
`SessionContentConsent` with its exact id/incarnation/project and source handle;
the native host's `contentFactory` verifies generation and attaches it before
raw admission. Use `nodePtyRawSpawner` for a new qualified Linux host: it admits
bytes before its independent local UTF-8 decoder and preserves terminal IUTF8
before launching the CLI. The historical spawner is unchanged and is refused
as an F2 byte source. There is no F2 content subscription until the committed
activation ACK. Attach these instances to one `SessionContentSource`, then start
its metadata-only control stream. Close its returned handle during shutdown.
There is no implicit lookup of owner state, deployed credentials or live hosts.

Native transport remains version 1. The separate `h2a.session-content/2`
capability is required; a legacy or unequipped host returns `unsupported_source`.
The F2 path never falls back to capture, replay, controller leases or input.

Every new policy digest requires a native challenge and a verified IdP-signed
nonce. Activation waits for the exact committed ACK. A committed policy may
cover its selected native incarnations and, only when explicitly selected,
future sessions born after activation. Clearing a local denial returns to off;
an older acceptance cannot clear that denial. Disconnect drops unsent content,
and policy reapplication creates an empty boundary without backfill.
Policy revision/digest floors advance at staging, so an older broader policy
cannot revive during or after narrowing. Existing future-session coverage is
preserved across confirmed amendments while its source/future selection remains
continuous. For a fresh source connection after expiry, trusted bootstrap can
use `NativeTerminalHost.rebindContent` with a new verified source handle; this
pauses sharing and installs a fresh boundary without replacing the live PTY.

## Preparatory receiving paths

These paths are implemented by the native HTTPS client and exercised against
temporary synthetic HTTPS services. They still require the Sentropic adapter,
deployed IdP policy, login-session introspection and shared fixture lock. The
prefix below is `/api/v1/auth/session/content/{bindingId}`.

| Method/path | Request or response |
|---|---|
| POST `/source/sessions` | Access token header, `source-open` → `source-session` |
| POST `/source/sessions/{id}/renew` | Original login/access-token binding, fresh nonce → same session/connection |
| GET `/source/sessions/{id}/grants/{requestId}` | Source token and native nonce header → exact activate/refresh proposal |
| GET `/source/sessions/{id}/policies/{id}/{revision}` | Exact original `project-policy` |
| POST `/source/sessions/{id}/acks` | Native `source-ack` → exact `control-result` |
| GET `/source/sessions/{id}/control` | Bounded SSE metadata: grant, refresh, revoke, confirmation proof |
| POST `/source/sessions/{id}/challenges` | Native metadata challenge; exact stored challenge echo, no authority added |
| POST `/fragments` | Exact content length and hashed `X-H2A-Source-Meta` → scoped ingest ACK |
| POST `/source/snapshots`, `/source/segments` | Bounded canonical JSON manifest/part with exact hashed admission → scoped native ingest ACK |
| POST `/source/acks` | Metadata-only terminal gap → exact idempotent gap echo |
| GET `/history/authorizations/{id}` | Current login/read authority → exact `history-read`, independent of source online state |
| GET `/history/admissions/{descriptorHash}` | Current login → server-stored immutable archive admission |

The receiver must reject invalid metadata before consuming a content body,
resolve the exact live IdP login at source renewal/admission, keep content and
login/revoke budgets independent, reconcile durable local denials before any
reconnect allow, and publish complete archives atomically. A source credential,
receipt, read response or archive hash is never an action confirmation.

## Capsule and archive boundaries

Pinned fixtures are at `src/fixtures/session-content/v2/`, shipped identically
under `dist/fixtures/session-content/v2/` and available through
`@sentropic/h2a-runtime/session-content/fixtures/*`. `manifest.json` inventories
every schema/fixture/vector with SHA-256 and byte length. The dedicated fixture
type harness checks all 25 message shapes; AJV 2020 and the semantic validator
execute the same positive fixtures. Credentials and provider examples are
synthetic. Capabilities intentionally advertise `native: []`.

`NativeHistoryProvider` requires an exact separately qualified provider tuple
and native metadata catalog. Bookmarks inspect metadata only. Content is read
in bounded workers after activation; changed files, incomplete JSONL, missing
or unconsented companions and unsafe paths refuse a complete export. This
generic catalog does not qualify Claude's real checkpoint/reference semantics.
Existing-at-activation bookmarks include the frozen lineage/checkpoint selectors.
Inclusive record ranges are indexed in the bounded snapshot worker across the
metadata-frozen file order; records larger than 256 KiB refuse. The 256 MiB
archive budget counts source bytes once; staging re-reads retain their separate
part and memory bounds. `exportToSource` sends every manifest/part through native
consent and authenticated HTTPS, cancels on exclusion or source invalidation,
and requires the final immutable archive admission. An explicit archive sink
remains available for adapters; the receiving service owns atomic publication.

Pauses retain metadata-only gaps with the last acknowledged contiguous raw
sequence per channel. Reapplication reports dropped and outage ranges before
committing a fresh boundary; it never replays their content. Control proposals
are serialized in a bounded queue, and an incoming proposal preempts obsolete
preparation/confirmation. Local denial remains a synchronous reserved path.

On the qualified Linux host, `ContentFence` requires `flock` on PATH. Its lock
is held by an open file description and released by the kernel on exit/crash;
lockfile age never authorizes takeover and proof/denial files remain durable.

`SessionContentImport` resolves current authenticated read authority and the
server-stored descriptor, validates every policy/manifest/admission/retention
link, verifies all bounded parts in a worker and atomically publishes into a
new managed data directory. It starts no process, acquires no keyboard and
returns `resumable:false`. It preserves original expiry. It cannot restore
hooks/configuration into a live provider directory or invoke migration/resume.
Its managed `readData` stream rechecks current retained-read authority and the
original deadline between bounded worker chunks, without a source connection.

## Remaining production qualification

Do not publish or close F2 from these synthetic witnesses. Required external
evidence includes the deployed issuer/client/JWKS/policy tuple, one UV event
consumed atomically across issuer workers, exact-login logout/renewal refusal,
the real qualified Claude checkpoint tuple, receiving store/HTTP and Sessions
route witnesses, identical Sentropic fixture execution/lock, and the integrated
0.98.8 single-MCP/registry head. The conductor allocates the candidate version
and records the exact packed artifact integrity. Local-only exclusion cannot
reach an offline server until reconciliation; already accepted copies keep
their independent immutable retention deadline.
