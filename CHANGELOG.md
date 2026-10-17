# Changelog

## 0.98.7 — 2026-10-17

Changes merged into `main` since `v0.98.6`:

- **Presence, identity and MCP send (#341):** recover heartbeat publication and
  bounded identity retries after transient storage failures. Require a live MCP
  recipient, preserve typed `recipient_not_live` refusals after expiry, and bound
  mesh sends with an explicit unconfirmed-delivery timeout.
- **Vibe equipment (#340):** distribute native skills, resources and hooks with
  managed ownership, repair diagnostics and qualification checks. Gemini and agy
  share one command owner; project installation preserves user equipment.
- **Vibe direct MCP (#346):** install the interim direct MCP entry and repair
  doctor convergence while preserving valid custom entries. Real target-host
  qualification remains a separate acceptance step.
- **Release candidates on npm `next` (#345):** require a successful RC from the
  same Git tree before stable publication, verify packaged bytes and installation,
  and document the owner's real reboot acceptance and explicit stable install.
- **Exact internal pins and CI (#339, #347):** keep the four published packages
  in lockstep, rehearse publication without credentials, and correct isolated
  fixture lifecycle, process cleanup and no-write checks.
- **Terminal recovery (#351):** restore terminal modes after tmux attachment and
  foreground runs, including signal handling, reset ordering and portability fixes.
- **Zero-Python guard (#349):** replace remaining automation with Node and reject
  executable Python usage outside the exact owner allowlist.
- **Focus registry entry R4 (#352):** ship the registry entry, skill, dossier
  schema and validator, including loader, semantic, parity and gate corrections.
- **Live L6a-H Git integration (#333):** integrate the live Git path and its
  fixture ownership and teardown proofs.
- **Crash logs (#350):** add per-component crash logs and the `h2a logs` viewer,
  including cause rendering and corrections from independent review.
- **Release regression:** native Gemini/agy resource assertions follow the exact
  package version instead of retaining a literal `0.98.6` path.

The four published packages (`@sentropic/track`, `@sentropic/h2a-runtime`,
`@sentropic/h2a`, `@sentropic/h2a-cli`), internal pins, lockfile, plugin manifests
and artifact-smoke version literal are aligned at `0.98.7`.

This PR prepares the stable version in Git; it creates no tag and publishes
nothing. After merge and green CI, the conductor tags `v0.98.7-rc.1` on the
merged commit as described in [the release procedure](docs/release.md).
