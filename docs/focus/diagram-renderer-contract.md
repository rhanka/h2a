# Focus → DS renderer integration boundary

Prepared against DS `origin/main` `25c0f3d33c258fc2b906a4b85219ffce5f67eccc`.
This is an adapter contract/handoff, not an installed or qualified DS renderer.
On 2026-10-18 npm returned E404 for both `@sentropic/diagram-core@0.1.0`
and `@sentropic/diagram-canvas@0.1.0`; their reproducible DS2 distribution is
the exact H2 blocker. No source alias or copied layout implementation is used.

The existing public engine seam is
`layoutDocument(document: SemanticDocument, options: LayoutOptions): LayoutResult`.
Options supply `registry`, `measureText(text, role)` and the actual positive
viewport content-box `targetWidth`; optional `viewId`/metrics remain derived.
Roles are `node`, `container-title`, `edge-label`. A laid-out result supplies
`view`, `fit` and warnings; refusal supplies identified refusals/diagnostics.
H2 consumes DS placements, docks, routes and labels verbatim. It binds text
measurement to the loaded DS theme/fonts, remeasures on font/width changes,
and never qualifies warning-bearing `label-unplaced`, `label-budget-exhausted`,
`route-obstructed` or `row-fill-partial` results. Source/alt stays consultable.
Existing generic@1 limits and #368 identities/fallbacks remain until a separately
qualified widening. No geometry is added to the semantic document.

## DS4/H3 in-canvas controls

The component export/prop names are pending DS4; the following are requirements,
not a fabricated JSON toolbar API. Focus validates closed declarations and
stable reference bindings. DS renders and owns these controls inside the same
viewport, with active values visible there:

| Family | Focus supplies | DS renderer guarantees |
| --- | --- | --- |
| Case | Named choices and explicit entity **and** relation memberships, parallel branches included | Highlight without layout, keyboard/touch selection, equivalent list |
| Event | Named choices and correspondence bindings | Reachable local action, visible active/pending/failed state |
| Before/after | Comparable snapshots and added/removed/changed correspondence | One canvas without remount; common anchors, camera/selection preserved |
| Group | Declared containment/visual-group memberships and expanded ids | Group-local +/−, reversible aggregate boundary relations/ports/counts, focus return and zoom-to-group |

Pan, zoom and resize must keep every control/hit/focus region readable and
reachable, without clipping or masking graph labels. Zoom/fit alone and page
toolbars do not qualify. The linked plan/heat-map recipe needs DS5 controlled
selection with a stable shared domain and distinct missing states.

One published scene tuple binds semantic revision/hash, local-state/request
token, measurement/viewport version, view/routes/labels, quality, camera,
selection and expansion. Prepare candidates off screen and publish only if all
tokens are current. Pending controls identify the retained complete scene;
failure retains it and reports the cause. Old, cancelled, partial or stale-font
results cannot publish. Reuse core transactions and DS publication machinery.
Opening evidence and returning must preserve this context. Exploration performs
no approval command, signature, server write or Track write.

## Resume gates for the conductors

DS2 supplies hashed exact core/canvas tarballs with public types/runtime,
measurement/diagnostic exports, licences and an isolated layout/replay witness.
DS3 supplies final-scene quality evidence; DS4 supplies renderer controls,
projections and publication; DS5 supplies controlled heat-map semantics.
H2 then replaces the interim grid/smoothstep seam and proves painted geometry,
resize/fonts, atomic publication and equivalent pinned embedded/CDN artifacts.
H3 adds the linked task/race matrix. H1 evidence remains independently delivered.
No kit retirement, package transfer or new graph ontology is inferred.
