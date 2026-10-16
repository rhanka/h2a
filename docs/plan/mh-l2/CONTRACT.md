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
| Per-attachment ownership/checkpoint | MH-L4 now supplies the qualified source barrier/freeze/checkpoint and independent operation rights. Unqualified writers/transports still refuse; MH-L3 supplies stable logical attachment/transport semantics. |
| Retire/live source transition | Passive `live-transfer` acceptance under the 2026-10-15 amendment below. No product strategy initiates it; the external conformance peer (later the .8 coordinator) supplies authorization and publication. |
| Shim transport epochs, IDs/progress/cancellation | Authentication envelope is implemented; logical transport/replay/fencing remains MH-L3. |
| Store writers/wake/launch receipts | Pending runtime executor and notification callbacks are counted; unknown/launching outcomes stay blocked. Full business reconciliation/admission fences remain MH-L4. |
| Image qualification | Byte inventory/profile verification is consumed. Temporary L1 prototype tests do not qualify release closure, real Claude, packaging or native continuity. MH-L6/MH-L8 owns those gates. |
| State filenames | Safe digest-addressed transaction/checkpoint filenames remain in the private namespace directory; records keep original IDs. H4 consumes `componentControl.activeTransaction` and checkpoint references, never reconstructs names from untrusted IDs. |

No installed h2a/MCP/native state, unrelated process, main or Track mutation.
Conductor independent confined review is pending on the final pushed SHA, as R4
ratifies. Author tests and this contract are not an independent verdict.

## Amendment — 2026-10-15: owner option A, passive live acceptance

Authority: owner decision of 2026-10-15, option A bounded ("passage à chaud"),
`l3-explain/out.md` §5. This supersedes only the former cold-only reservation
and unconditional retire refusal. Spec v7 §6.2 line 961, §10.3 M21 line 1838,
§5.7 lines 765–776, §6.6 lines 1084–1092 and acceptance criterion 13 line 2148
require exercising the installed .7 source with an external conformance peer.
The earlier removal was correct for the previously authorized cold-only scope.

The .7 product never creates live authorizations, publishes a live successor,
acquires/restores a transferred attachment, or chooses a live upgrade strategy.
Cold-stop retains its selection, isolated precheck, irreversible commit and
successor-attempt contracts. Live acceptance additionally requires:

1. The existing connection-bound authenticated administrative request and the
   exact source generation/publication epoch, transaction IDs/epoch, coordinator
   process identity and current session inventory revision.
2. A private immutable `liveSourceAuthorization`, stored by digest in the
   namespace state directory and authenticated in the source compatibility key
   domain with purpose `live-source-authorization`. It binds the complete old
   marker, complete proposed new marker, target image/entrypoint, selection,
   inventory and H4 authorization tuple. Target namespace/prefix/root/UID/frame
   match the source; generation and publication epoch advance. Its validity is
   checked at first acceptance and again before publication commitment.
3. The canonical H4 journal `I/state/upgrade/transactions/<upgradeId>.json` is
   ACTIVE/DELEGATED, SELECTED or ACTIVATING, with the exact controller identity,
   epoch, selected manifest and build. A private ticket and immutable
   `delegationReceipt` in `I/state/upgrade/receipts/<digest>.json` agree on the
   ticket digest, predecessor revision, delegated identity/build and manifest.
   A separate ticket MAC proves possession of the private ticket nonce: its key
   is SHA-256(UTF-8 ticketNonce), the existing `requests` key domain and source
   context are used, and the canonical payload is
   `{purpose:'live-source-ticket',authorization:<record without mac/ticketMac>}`.
   The source compatibility MAC covers this ticket MAC as well as the tuple.
   Ticket references are relative to `I/state/upgrade`; no ticket or secret is
   sent to a shim or put in a public report. The receipt adds no product H4
   producer; the conformance peer supplies these private fixtures.
4. MH-L4 barrier, freeze and immutable checkpoint complete before publication.
   Live `retire` consumes a source-authenticated `liveSourcePublication`, stored
   by digest, binding the reservation digest, exact checkpoints and proposed
   marker digest. The actual rendezvous marker must equal that proposed marker.
   No unverified marker, stale inventory, changed checkpoint or wrong authority,
   source, target, transaction or epoch grants a transition.
5. The source persists PUBLISHED before fencing each source attachment from
   FROZEN to TRANSFERRING with the exact checkpoint hash. Completion is
   idempotent after lost ACK. G0 admitted-operation rights remain valid through
   result/payload persistence while owner effects stay fenced. Retirement waits
   for the full calls/children/briefs/callbacks/effects drain, persists RETIRED,
   and closes only the old listener/transports without deleting G1's marker or
   presence. No force, signal or retry replaces that drain.

The partial PUBLISHED receipt is bound to the caller's retire stepId and full
request digest. A lost ACK or a nonempty drain resumes that same step; no public
stepId is reserved for internal bookkeeping. A final RETIRED receipt retains the
publication digest, including when a second concordant retire step finishes it.

After source publication commitment and acquisition, G1 may open the common
writer gate only under its exact ACTIVE component-control generation/process
identity. G0 validates that authority as well as the frozen checkpoint/owner
tuple; an anonymous OPEN gate or one belonging to another handover refuses.
The component-control reference retains this handover until G0 retires. A
PUBLISHED/RETIRED live source counts and reconciles only operations and launch
memos executed by that source generation/process; G1's new work remains owned
by G1. G0's unknown work continues to block its drain. The existing unscoped
ledger/cold-stop behavior is unchanged. This is a source acceptance primitive,
not a .7 target acquisition/restoration or live strategy.

Authority verification during reconciliation is a pure read of the authenticated
publication tuple. An indeterminate participant registry is fsynced/reconciled
before participant validation/fencing runs again. Every mutation path retains
the checkpoint and exact owner checks; no wire flag disables them.

Publication, including a concordant marker observed before its receipt can be
reconciled, prohibits abort/expiration/operator-stop from reopening G0. A
contradiction closes admissions and requires explicit reconciliation. Repeated
accepted steps retain their original digest-bound result; new mutations still
require current authority. Compatibility verdict provenance/consumption and
shim transfer/correlation remain MH-L3; this amendment does not qualify .8's
semantic verifier, product restoration, or the actual .7→.8 release transition.

This amendment and its implementation are separate review targets. Independent
conductor review must complete before MH-L3 continues; author green tests do not
replace that gate.
