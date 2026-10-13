# MH-L2 integration contract

Ratifications: [RATIFICATIONS.md](RATIFICATIONS.md). Source base: `5cb66f7e`.

The `.6` process leaf is reused from Git `0b9cf886`; only TypeScript is erased.
HTTP never proves owner death. Admission additionally checks netns and uses the
L0 abstract preclaim through durable ready publication. Marker CAS compares
generation, publication epoch, dev/ino and canonical value digest. A missing
marker does not override a live durable owner.

For a managed installation, `I/state/namespaces/namespace.json` allocates the
namespace through exclusive filesystem publication. Callers read its canonical
marker reference rather than invent another domain from HOME/XDG. Both secrets,
epochs, control, steps, startup reservations and checkpoints live under
`I/state/mcp/<namespaceId>`. Pins live in `I/state/pins`. The historical marker
and common anchor retain their original rendezvous directory. A changed boot
refuses continuation of an old committed transaction; recovery is explicit.

`componentControl` binds generation, complete owner identity and ACTIVE/CLOSED.
`operatorStopCommitted` records intent committed internally; `operatorStopped`
is written only after listener/attachments close and marker removal. Pause is a
separate durable record. Explicit serve can lift pause before commitment;
upgrade never clears it. Stop remains armed while work drains; no force mode.

Every HTTP operation owns an agent/socket. It challenges that exact connection
before an application envelope is emitted; socket replacement refuses the body.
The signed wire body contains logical method, headers and body. This binds
session/workspace/context headers as well as the application JSON. No reusable
bearer is sent. Responses bind status, headers, body and requestUid; SSE messages
are signed individually. Notifications use a retained sequence verifier. UTF-8
decoders retain partial code points. Nonces/challenges/sequences have finite
caches; expiry cannot revive a previous challenge.

The administrative step digest binds operation, complete request, payload and
coordinator, preventing stepId reuse across different methods. Synchronous
critical sections serialize admission, renew, expiry, pause and stop. Persistence
indeterminacy closes admissions; explicit resync/re-read reconciles before close.
STOP_COMMITTED precedes closure and is never undone by abort/expiry/lost ACK.

The isolated precheck verifies the selected image, starts its entry using only
private temporary HOME/XDG/store, refuses business admission, records readiness,
awaits child exit and verifies cleanup. It neither publishes the real marker nor
ensures a native host. Reserve/barrier/commit revalidate selection and QF bin
identity/content. The real cold cycle is tested from a temporary L1 prototype.

All starters select the absolute registered entry. Before spawn they persist a
startup slot and, after a cold commit, consume the shared attempt counter. At
most three attempts exist; a living/unknown candidate prohibits another spawn.
An expired live candidate is fenced as SUCCESSOR_FAILED without being killed.
H4 compensation consumes a new ACTIVE authority, a verified previous source
image, a fresh precheck and new epochs. It publishes a new linked transaction;
it never reopens G0. The H4 CLI producer belongs to MH-L6.

QF B routes the npm bin into the selected image in the same process. QF A's
initial external bootstrap, npm install/uninstall lifecycle, last-valid diagnostic
fallback and closure qualification belong to MH-L6. No release bump/publish.

Boundaries consumed by the following lots:

| Boundary | L2 behavior / follow-on |
|---|---|
| Per-attachment ownership/checkpoint | Framework hooks exist; production freeze/checkpoint qualifies only an empty inventory. A transaction with unqualified transports refuses before barrier. MH-L3/L4 supplies full attachment semantics. |
| Retire/live source transition | Authenticated route refuses `live_publication_required`; no live-transfer/RETIRED transition or coordinator ships here. An attempted extension was rejected by automatic review as outside cold-stop scope and removed. |
| Shim transport epochs, IDs/progress/cancellation | Authentication envelope is implemented; logical transport/replay/fencing remains MH-L3. |
| Store writers/wake/launch receipts | Pending runtime executor and notification callbacks are counted; unknown/launching outcomes stay blocked. Full business reconciliation/admission fences remain MH-L4. |
| Image qualification | Byte inventory/profile verification is consumed. Temporary L1 prototype tests do not qualify release closure, real Claude, packaging or native continuity. MH-L6/MH-L8 owns those gates. |
| State filenames | Safe digest-addressed transaction/checkpoint filenames remain in the private namespace directory; records keep original IDs. H4 consumes `componentControl.activeTransaction` and checkpoint references, never reconstructs names from untrusted IDs. |

No installed h2a/MCP/native state, unrelated process, main or Track mutation.
Conductor independent confined review is pending on the final pushed SHA, as R4
ratifies. Author tests and this contract are not an independent verdict.
