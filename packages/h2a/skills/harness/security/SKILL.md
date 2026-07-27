---
name: security
description: Use for dependency, vulnerability, and supply-chain debt — maps scanner coverage, makes exceptions expire, and wires enforceable gates.
---

# harness/security

Native vulnerability-debt discipline. Load it before accepting findings, changing dependency policy, or
shipping an artifact. It is not a claim that one scanner covers a repo.

## Map the coverage boundary

Inventory each shipped/runnable surface: resolved dependency trees, container image/base OS, vendored
code, and packaged/generated artefacts. A coverage map records component, embedded path, delivery form,
stack-appropriate scanner, and CI gate. Choose from the lockfile/package manager, image builder, and
artifact format; do not hardcode an ecosystem command into a portable repo.

A dependency scanner sees only its resolved package tree, not image layers, vendored artefacts, packaged
builds, or another ecosystem's tree. An unscanned surface is a visible coverage gap, never an exception;
use an SBOM or artifact/image scanner at the appropriate boundary.

## Triage and record exceptions

Fix a HIGH finding on its own dedicated branch; do not wait for a dependency batch. An accepted finding in
`.security/vulnerability-register.yaml` has stable advisory/scanner identity, scanner-native affected
identifier/version or digest, component, embedded path, severity/source, rationale, owner, accepted date,
`review_by: YYYY-MM-DD` (UTC), and removal plan with target. Match identity, affected item, component,
and path exactly: no package-wide, glob, or expiry-free suppression.

`review_by` is the last valid UTC date, not a reminder. The gate validates every row on every run; when
the current UTC date is later, it emits advisory, owner, component, path, and date, then fails until the
finding is fixed or a new explicit decision renews it. Missing, malformed, or non-matching rows suppress
nothing.

## Gate and threshold

CI scans first, consults the checked-in register, then suppresses only exact, unexpired accepted findings.
Never blanket-disable a scanner or globally ignore results to unblock release. Give dependency-tree, image,
and artifact gates separate results so their coverage cannot be confused.

Choose the threshold from scanner signal, exposure, exploitability, patch burden, and triage capacity.
Failing on LOW commonly creates noise that gets the gate disabled; failing on nothing is theatre. Many
repos initially fail HIGH/CRITICAL and report MEDIUM/LOW with an owner/SLA; that is a reasoned starting
point, not a harness default.

## Enforceability ladder

**Structural > test > spec line > habit.** CI matching, expiry failure, and separate surface gates are
structural. Fixture/contract tests for threshold, exact match, expiry, and malformed rows are test. This
skill, the repository's documented register fields, and coverage map are spec line. Triage, ownership, and
keeping removal plans/review dates current are habit, so insufficient alone.

The H2A reference implementation — `.security/vulnerability-register.yaml`, `audit:security`, and its CI
gate — is delivered separately. This skill specifies that contract; it neither creates the gate nor proves
an unobserved platform result.
