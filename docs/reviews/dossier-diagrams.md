# Dossier diagrams implementation

Spec: `SPEC_EVOL_DOSSIER_DIAGRAMS.v3.md`, SHA-256
`34b0b43a1f7edbde8805f59dbc6789c1d85f0a3f8ee00d1c56d11e9b13ee0b37`.
The two supplied independent spec reviews say GO-CODE. They do not review this code.

## External dependency boundary

H2 needs distributable `@sentropic/diagram-core@0.1.0` and
`@sentropic/diagram-canvas@0.1.0`. On 2026-10-18 both `npm view <name>
version --json` commands returned E404. The DS `origin/main` canvas manifest
still declares `private:true`. No reproducible, pinned DS2 tarballs were supplied.
H2 adoption stops at this boundary; H3 also needs DS4/DS5 renderer controls,
projections/publication and controlled heat-map exports. No engine fork is made.

DS conductor handoff: deliver public type/runtime exports, exact dependency
tarballs and hashes, measurement and diagnostics contracts, and a fresh isolated
consumer layout/replay witness. H2 resumes with those artifacts; DS3 qualifies
geometry, DS4 supplies the four in-canvas control families. Focus supplies closed
choice/reference bindings; the DS renderer owns placement, hit/focus regions,
pan/zoom/resize, camera and atomic scene publication. A page toolbar is insufficient.

## Review selection

```yaml
status: selection-failed
target-ref: feat/dossier-diagrams
review-author:
  host: codex
  model: unknown
  effort: unknown
observed-failure: Exact author metadata is unavailable; installed h2a/live mesh dispatch is forbidden by owner confinement.
```

No independent implementation consensus or merge gate is claimed.
