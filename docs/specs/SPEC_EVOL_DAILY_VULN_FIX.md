# Daily vulnerability fix

Owner directive of 17 October 2026 supersedes pending VA questions in study-v5:
local daily systemd, local CLI seats now, future CI seats behind an interface,
and manual merging. No Dependabot dependency or credit fallback.

- D1: Explicit repository inventory, canonical roots and matching GitHub remotes.
  Scan tracked lock domains at fetched upstream main, including npm workspaces
  and independent nested locks. npm HIGH/CRITICAL plus hydrated OSV records and
  configurable trusted scanners. Unknown severity remains visible for triage.
- D2: Invalid, unavailable or truncated scanner output is incomplete, never clean.
  Send only public registry package resolutions to OSV; report coverage gaps.
- D3: Global controller lock, durable per-repository UTC daily claim before
  inference and persistent round robin. Ambiguous/crashed attempts consume the
  day. Reconcile existing bot PRs before author dispatch to prevent duplicates.
- D4: One SeatRunner interface for local CLI and future CI seat admission.
  Declared host/model pairs are distinct, model/effort explicit; exclude author's
  host and model from two blind independent reviewers. Requested identity is not
  proof of the effective provider model. Unknown admission blocks inference.
- D5: Repo-local ignored worktrees, never main; baseline and candidate SHA pinned.
  Existing lockfiles only in the initial lane. Compatible generated lock updates
  preferred; no force or install scripts. Major/ambiguous version changes block
  this lane and require a separate manually supervised PR.
- D6: Controller owns push and PR operations; no merge code. Agent receives
  explicit workspace and harness scope; native tool restrictions supplement the
  workspace guard. A local seat is admitted only with explicit guard qualification.
- D7: Record red baseline audit and green candidate audit, plus configured
  targeted tests and lock installation checks. Meaningful regression red/green
  where applicable. Failed/skipped/missing verification blocks readiness.
- D8: Draft PR first, two separate review worktrees at the same candidate SHA,
  strict verdict receipts and evidence, unchanged local/remote head before ready.
  Rejections/failures leave draft with evidence for conductor handoff.
- D9: Atomic stable reports with findings, PRs, failures and coverage gaps, one
  stdout summary. Dry run scans without inference, publication, daily claims or
  cursor changes; disposable scan worktrees/fetch remain necessary for freshness.
- D10: Render systemd user units with absolute paths and restrictive umask;
  document install/enable. No activation against real owner state in confinement.

Two independent design reviews identified false-clean scanners, OSV hydration,
identity aliases, daily crash safety, lock policy and fixed-SHA review risks.
These are acceptance gates. Real-seat qualification, shared machine-wide quota,
effective identity attestation and future CI custody are integration boundaries.
The local runner is not a hostile-code sandbox or a replacement for CI custody.
