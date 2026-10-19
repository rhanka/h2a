# Focus editing contract v1 (implementation preview)

This implements the independent core and manual consumer of FE-0/FE-1/FE-5
from `SPEC_EVOL_FOCUS_EDIT_RETURN.v3.md`, SHA-256
`6d320f6627643c97a45baf47d103e0442618bbc2da4613054f8c7dd1e8b8e105`.
The first editing increment is **not qualified**. FE-3 stops because the
published DS package has no `RichTextEditor`. No fallback editor is authorised.
FE-4, the browser-produced FE-5 witness, FE-6 policies and FE-8 budgets remain
open. The existing portable host continues to be a snapshot host.

Import the neutral API through `@sentropic/focus/editing`. The package exposes
the two sidecar schemas through `./schemas/focus-edit-return.v1` and
`./schemas/focus-editing-manifest.v1`. Dossier v1/v2 schema bytes are unchanged;
snapshot interactions stay disabled. The root exports editing types only, so
render-only consumers do not load the editing codec or its dependencies.

## Three validation layers

| Layer | Enforced rules | Witness |
| --- | --- | --- |
| S: structure | Closed objects, versions, enums, required fields, operation/null combinations, unique ancestry elements | Generated schemas and runtime share `structure.ts`; Ajv parity and operation matrix in `editing-contract.spec.ts` |
| F: serialization | Strict JSON; JSON/YAML duplicate keys, tags, aliases, non-string map keys and non-JSON values refused; strings preserved without trimming | `decodeReturn` / `encodeReturn`, exact multiline/Unicode/empty/null round trip |
| M: semantics | Digests, node/target/field consistency, transaction/change identities, ancestry cross-field consistency, mapping, production, preconditions and recorded attribution | `validateManifest`, `validateReturn`, pure `reconcile` |

Only `supersedesReturnId` is optional in the return. Absence means a lineage
root, with `supersededReturnIds: []`. Unresolved scope/production and absent
text use explicit `null`; empty text is `""`. The manual consumer requires an
exact production triple. Answers are typed question/target/option identities
plus exact text; notes carry target and exact text. This new envelope does not
adapt the historical served-app answer payload yet (FE-4).

## Source profile and identity

Source parser: `@lezer/markdown@1.8.0`, CommonMark with its GFM extension.
An offset map translates its LF parser positions to the exact CRLF/CR source.
The codec retains source slices; it does not regenerate Markdown from an AST.
Top-level paragraphs with text, emphasis, strong, inline code and hard/soft
breaks are source-editable. Links, images, raw HTML, headings, lists, tables,
fences and other blocks remain opaque. Lists remain excluded until the real
DS Tiptap/Markdown codec passes FE-2. This is a **source-codec profile**, not
a claim of a qualified Tiptap round trip or an editable portable UI.

Plain narrative fields: question/question-context/recommendation and nested
option label/body/consequence. The manifest lists each source address; the
presentation's recommended-option prefix is never used as source text.
States, annotations, outcomes, citations and comprehension evidence are excluded.

`seedManifest` is for the first legacy baseline only. It deterministically
seeds distinct opaque paragraph IDs even for identical text. Subsequent
producer revisions use `carryManifest` with explicit ranges and retained IDs;
they must not reseed. A range uses UTF-16 source units and maps only its named
baseline. `retiredParagraphIds` is additional durable mapping data in this
proposed manifest vocabulary: it prevents reallocation and is included in its
digest. This concrete field and the codec profile need the FE-0 Focus/DS review
before merge. Undo within a draft restores the original unit; paste must allocate
a fresh ID at the future DS/host boundary.

`diffParagraphs` compares identity-bearing baseline/draft values and produces
ordered replace/insert/delete/move operations. Repeated typing coalesces to one
baseline-relative change. Splits retain the leading ID and insert fresh units;
merges retain the leading ID and delete consumed units. Moves preserve text.
Structural operations carry before/after sibling anchors with explicit null
boundaries. Unsupported source gaps are retained, including CRLF and tables.

## Digest domains

The opaque dossier `hash`/`cursor` are copied verbatim. `baseHash` is RFC 8785
canonical JSON, UTF-8, SHA-256 with `sha256:` prefix, over the exact authoring
document before diagram expansion or presentation. Strings are neither trimmed
nor normalized; lone surrogates, non-finite numbers and non-JSON values refuse.

`manifestBaseHash` hashes every manifest field except itself, **removed**, not
null or empty. Array order is retained. `digest` applies the same projection to
the complete return, excluding only `digest`. The pinned vector in
`editing-vectors.json` is verified independently with Node crypto and the same
core bundled for a browser environment. That witness does not qualify a real
browser, clipboard, storage, IME, Tiptap or `file://` host.

## Cumulative reconciliation

Every frozen return describes the complete desired delta against its baseline.
`freezeReturn` takes host-supplied IDs/time and a previous validated frozen
return. It builds `[previous.returnId, ...previous.supersededReturnIds]` and
reuses an unchanged frozen value. An empty delta after an earlier correction
is a new superseding return and can revoke it. Ancestry is never guessed.

`reconcile` takes retained baseline + current source/manifest + return + plain
lineage state. It performs no I/O. Identity/digest replay precedes paragraph
preconditions. Positively superseded returns refuse; a successor must extend
the head's transported ancestry exactly. Forks, truncated or incomparable
lineages refuse without advancing head/tombstones. Only accepted heads extend
the monotone tombstones, including ancestors never delivered.

Application records attribute existing corrections. Equality with an `after`
string alone grants no attribution. The remaining atomic transition can retain,
change or revoke earlier corrections. A third-party modification to an affected
unit/topology produces a conflict with baseline / lineage-applied / current /
requested values. Structural revocation restores exact baseline source gaps
while replaying independent third-party units. Every accepted application records
actual base/result hashes and consumed IDs. Refused valid identities are also
bound to their digest; replay receipts preserve the previous outcome.

## Manual producer workflow

Use the freshly built checkout, never a PATH-resolved or owner-installed binary:

```sh
node packages/h2a/dist/bin.js focus feedback retain dossier.json --state ./editing-state --producer producer:opaque --generation generation:opaque --request request:opaque
node packages/h2a/dist/bin.js focus feedback apply return.json --state ./editing-state
```

The producer explicitly selects source and state paths. Payload paths and
`provenance.source` are never opened. Retention preserves baseline and manifest;
`editing-state/manifest.json` is the initial sidecar. Application re-reads the
source; a carried current manifest can be supplied with `--manifest <file>`.
Lost mapping refuses instead of reseeding. JSON and YAML files work without a
live agent. The full return and receipts remain in `state.json`, including exact
notes and corrections without the old served-app trimming/truncation.

All cooperating offline producers must share the state directory's single-writer
lock. The consumer checks source bytes again immediately before publication,
fsyncs a pending journal, atomically renames the source, then commits manifest,
lineage and receipt. Restart resolves the journal using expected bytes/result
digest. A conflicting pending publication refuses. An abrupt process death can
leave `writer.lock`: it fails closed and requires explicit host recovery; no PID
inspection or automatic stale-lock theft is implemented. Non-cooperating writers
outside this lock are not protected by a filesystem CAS. Connected/shared-source
application is FE-6, not delivered here.

`applied` means source JSON published; it does not claim rebuilt/presentable HTML,
Track recording, ratification, signature, or successful delivery to an agent.
The manual preview does not translate to Track or widen snapshot registry
permissions. Complete FE-5 registry capabilities and presentation rebuild remain
gated on the FE-3/FE-4 round trip. Deployment must carry the matching newly built
Focus package; availability of this contract in published 0.5.0 is not asserted.

## Regeneration and qualification

Build Focus, then run `node packages/focus/scripts/sync-editing-schemas.mjs`;
`--check` rejects drift. `scripts/vendor-focus.mjs` and
`scripts/check-focus-vendor.mjs` remain the sole Track vendor generators/checks.
The influence fixtures are explicitly reduced source slices, not qualified real
dossiers; the original file and neighbouring HTML are untouched.

FE-2 is owned by the design system. Required handoff: publish a controlled,
read-only-capable `RichTextEditor` subpath and its exact codec/profile, with
identity, split/merge/undo/paste, IME and hostile-content witnesses. Observable
unblock: h2a can install that exact published artifact and run the FE-3 offline
paragraph/question edit, followed by FE-4 export/import and tarball round trip.
FE-8 then measures reactivity, fixes budgets and verifies them before acceptance.
