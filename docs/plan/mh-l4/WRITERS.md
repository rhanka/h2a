# MH-L4 writer audit

Source base c8a11016. Qualified continuity requires a maintained admission-closure proof. The default remains store_writer_set_unknown; a legacy actor able to enter yields legacy_writer_unfenced. No scan, expired lease, pathname or historical-use heuristic produces eligibility.

| Domain | Conforming mutation boundary |
|---|---|
| Presence | write/update/delete bind sessionId and expectedInstance to ownership; snapshot janitors re-read under the common guard; discovery notifications use sweep:false. |
| Identity/registry | LocalStore mutators, key generation/adoption/orphan cleanup, alias append, sync/async binding publication, point-index append/build, mirror sequence fence. |
| Inbox/outbox | Put, pop/ACK, routing and indexes through LocalStore guarded methods. |
| Negotiations/consent | Append, transitions, disclosures, stabilization and optional advisory dossier writes; no shared business schema migration. |
| Blockage | Raise/resolve guarded around read-modify-write. |
| Launch | Atomic private memo before spawn; token-bound existing launch.json is read for reconciliation, not rewritten; delegation append guarded. |
| Payload | Persistence and expiry sweep hold the common guard throughout their critical section. |

Lock order is common guard then synchronous business domain lock. Identity binding takes its existing asynchronous/synchronous identity lock before the common guard; no common-guard holder acquires that identity lock. No network await occurs under the common guard. The synchronous reentrance set is process-local; eight processes exercise actual kernel exclusion.

The guard uses Linux util-linux /usr/bin/flock with an inherited open description. File and parent are non-writable by the executing UID; kernel lock release on crash is tested. Absence/unqualified tool refuses without a PID-lock fallback. This system tool prerequisite needs packaging/profile qualification in MH-L6/MH-L8; no executable is downloaded or installed by this lot.

A normal unmanaged store without control remains usable, but never becomes continuity-eligible by that fact. A preparatory central opens initialize:false/readOnly:true and constructs no writer control or participants. Public one-shot/store writers see the durable barrier; an admitted operation's runtime context checks its independent execution authority. Legacy binaries that ignore these guards are excluded by the admission proof, not retrofitted.

The complete M17 campaign (10,000 mutations per domain with eight roles and a legacy actor) remains MH-L5. The local eight-process registry/inbox probe has 160 mutations per domain and is not presented as M17 qualification.
