---
name: vuln-fix
description: Configure, run or investigate the daily multi-repository vulnerability remediation job through h2a seats, including dry-run reports and a systemd user timer.
---

# Daily vulnerability remediation

Use the reviewed h2a `vuln-fix` command. The controller detects vulnerabilities
independently of Dependabot, launches admitted seats in repository worktrees,
creates draft PRs, and requires verification plus two independent reviews before
ready. Merging belongs to each repository's conductor.

Read the [operator reference](references/operator.md) for configuration,
admission receipts, timer installation and recovery.

For an authorized run:

1. Inspect the explicit repository/targeted-test inventory and stable report
   directory. Keep the controller configuration outside candidate repositories.
   Include every independent npm lock domain; unsupported/unlocked manifests
   are coverage gaps requiring a repository setup correction.
2. Run `h2a vuln-fix run --config /absolute/config.json --dry-run`. It fetches
   main and uses disposable scan worktrees, without inference or publication.
   Treat a failed source as incomplete coverage, never a healthy repository.
3. For fixes already authorized by the owner, run the same command without
   `--dry-run`. Do not replace missing quota/guard admission with a guessed
   boolean, another provider or API credit. Unsupported CLIs remain unavailable.
4. Read `latest.json` and its per-run report: findings, PRs, blocked verification,
   rejected reviews and failures. An existing PR remains pending conductor
   resolution. No automated rebasing or new PR while that PR remains open.

For requested scheduling, render with `h2a vuln-fix timer --config
/absolute/config.json --directory /absolute/units`. Install/enable the two
rendered user units only in the owner's authorized target environment. Never
reach hidden native host state or activate a real timer from a confinement.

During remediation, obey the controller's workspace and lock-only scope. A
dependency audit is the red/green proof when no meaningful exploit regression
test applies. Preserve targeted test output and both pinned review receipts.
Major changes, new dependencies, provenance gaps and releases younger than
seven days stay blocked for a separate supervised PR/decision. Never weaken a
test/scanner, add a blanket exception, force a fix, or merge.

After a crash, the kernel releases the controller lock, but daily claims and
quota reservations remain consumed. Read the report before recovery. Ambiguous
publication or process cleanup requires the conductor to reconcile the exact
branch/process/worktree; do not clear the journal to obtain another attempt.
