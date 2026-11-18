# npm security-debt policy

`npm run audit:security` is the repository's dependency-security gate. It runs
`npm audit --json` against the installed root npm tree and fails on every new
or changed `moderate`, `high`, or `critical` vulnerability. The threshold is
`moderate`: `high` would make the two currently accepted runtime exceptions
invisible, while a `low` failure is too noisy for this gate to stay enabled.

The gate reads [vulnerability-register.yaml](./vulnerability-register.yaml).
An exception is not a package allowlist: it must exactly name the component,
severity, every embedded lockfile path, installed version, and either all GHSA
advisories or its complete `via` package chain. The script rejects malformed,
ambiguous, expired, or resolved-but-still-recorded rows. It also rejects high
and critical exceptions: those receive a dedicated fix branch rather than
waiting in the register. Rows may be reviewed for at most 31 days from their
recorded discovery date; the gate warns during the final seven days and fails
on or after `review_due`.

## Patched-fork overrides

When upstream has no patched release at all, the pattern established for
deepmerge (GHSA-gcqx-w48m-w2h4) applies: pin a patched fork through an npm
alias override in every locked tree, and prove the installed module with
exploit and compatibility tests in the `security-debt` CI job. Current case:
picomatch (GHSA-fc5q-39xc-vjpf / CVE-2026-112366, `first_patched_version:
null`, latest upstream 4.0.7) is pinned to `@ryotsu/picomatch@4.0.7-a` in the
root, `apps/focus`, and `packages/h2a/focus-kit` trees;
`scripts/picomatch-security.test.mjs` exercises the ReDoS patterns and the
glob behaviour the tools rely on in each tree. No register row is needed
because the installed code is patched, and a register row for a resolved
finding would fail this gate. Remove all three overrides when upstream
publishes a patched picomatch the consumers accept. Note that `npm install`
in the workspace root can drop this alias from `package-lock.json`; the CI
test above is the guard that turns such a silent revert red.

## Operating rule

1. Fix first with a compatible, real dependency upgrade. Do not use an
   override or `--force` merely to silence audit.
2. If an exception is necessary, record the owner, component, paths, installed
   versions, advisory chain, rationale, a review date, and a concrete exit in
   the register. The gate proves the record still describes the exact debt; it
   does not approve the decision by itself.
3. Before `review_due`, either remove the row because the upgrade is now
   possible, or create a new short review decision with current evidence.

## Defence layers and boundary

- **Structural:** the Linux `security-debt` CI job installs the lockfile and
  runs this fail-closed gate; release verification runs it too.
- **Test:** `packages/h2a/test/audit-security-debt.test.js` covers accepted,
  unregistered, path-drift, expired, and malformed-audit cases.
- **Spec:** this policy and the versioned register make the accepted risk and
  exit condition reviewable.
- **Habit:** the owner must act before the printed review date. Automation
  makes that habit visible but cannot make the upstream release happen.

The gate stops at the root `package-lock.json` npm dependency tree. It does
not scan container images, vendored artefacts, the separately locked and
packaged Focus build under `apps/focus`, or arbitrary release artefacts.
It runs on Linux only under the owner's cross-platform decision
`01KYJ3Q3V5AW9YR0QMXSGW93RE`; it is not evidence of Windows or macOS security
behaviour. Finally, this check can fail a workflow, but branch protection must
require that workflow before it can structurally prevent a privileged manual
merge.
