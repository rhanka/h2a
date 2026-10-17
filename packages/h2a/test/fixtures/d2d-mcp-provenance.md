# Airbus MCP incident input

`d2d-mcp.json.pre-incident` is an exact copy of the pre-incident bytes
supplied by the owner for R6, from tracked `HEAD:.mcp.json` in
`airbus-genair-d2d`, commit `3508b24`.

- Size: 346 bytes, UTF-8, LF, no BOM.
- SHA-256: `984069aaed26cd2ce888dc692a4400f9c9c1cbb5add9c86fedbed3fc6b3d5470`.
- Git blob: `0d7a324` (the isolated fixture's initial index).
- Sole server: `graphify-ts`, command `npx.cmd`, package version `0.23.1`.

Reported sequence on 2026-10-04: global 0.98.0 installation; at 00:38,
`{"h2a":{"central":{"enabled":true}}}` in user configuration; between
00:43 and 00:46, `h2a run` / `h2a restore` across nine repositories. The
Airbus file reportedly lost Graphify and contained only the central h2a
connector at `http://127.0.0.1:48000/mcp`.

Tests verify this input's hash before executing the unchanged published
0.98.0 preparation and writer. Liveness is simulated and discovery receives
the published `runtimeBase` seam, so its connector has an extra private
`--runtime-base` argument. Neither JSON parsing nor the merge is substituted.
This input reproduces implicit tracked-file modification, but not the reported
Graphify destruction. The restoration preparation alone does not write a
project file; a restored absent session re-enters the launch preparation.

The published core and runtime archive hashes are checked in the tests.
The R6 qualification also verified both archives against the npm registry's
0.98.0 `dist.integrity`. Full launch flags, process traces and post-incident
file bytes were not supplied; no live owner sessions or repositories are
used by these tests.

The historical cause remains unknown: the published writer retained Graphify
in reproduction. The owner closed R6 by the candidate's zero-project-write
invariant and exact byte-preservation regression, and restored Claude default
ON with explicit opt-out and environment escape. This decision does not claim
a reproduction of the historical destruction.
