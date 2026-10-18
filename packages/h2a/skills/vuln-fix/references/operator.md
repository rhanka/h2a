# Daily vulnerability fix job

`h2a vuln-fix run --config /absolute/config.json [--dry-run]` scans upstream main,
attempts one compatible lock-only remediation per affected repository per UTC
day through local seats, opens a draft PR and gates ready on two independent
reviews. It never merges. No Dependabot alert, CI image or API credit is needed.

The initial local adapter supports qualified Claude and Codex headless lanes.
AGY, Muse and Vibe are represented in the seat interface but unavailable until
their native headless/tool restrictions are qualified. Requested model/effort
are recorded; effective provider identity is not attested.

## Configuration

Keep the configuration and state outside the candidate repositories, owned by
the operator. Each repo must have an exact canonical root, an origin matching
its configured `rhanka/repo`, ignored `tmp/worktrees/`, npm v2/v3 locks and an
explicit list of targeted Node/Vitest test files. Include h2a, sentropic and all
other applicable local rhanka repositories in this list; no hidden global
inventory or privileged owner-state discovery is performed.

```json
{
  "version": 1,
  "stateDir": "/home/antoinefa/.cache/h2a-vuln-fix",
  "repositories": [{
    "path": "/home/antoinefa/src/h2a",
    "github": "rhanka/h2a",
    "osv": true,
    "tests": [{"command":"node","args":["--test","packages/h2a/test/audit-security-debt.test.js"]}],
    "scanners": []
  }],
  "seats": [
    {"id":"codex-a","profile":"codex","model":"EXACT_APPROVED_MODEL_A","effort":"high",
     "admission":{"command":"/absolute/trusted-seat-authority","args":[]}},
    {"id":"claude-b","profile":"claude","model":"EXACT_APPROVED_MODEL_B","effort":"high",
     "admission":{"command":"/absolute/trusted-seat-authority","args":[]}},
    {"id":"claude-c","profile":"claude","model":"EXACT_APPROVED_MODEL_C","effort":"high",
     "admission":{"command":"/absolute/trusted-seat-authority","args":[]}}
  ]
}
```

Replace the explicit model/example authority values with qualified local seat
configuration. Add sentropic, radar-immobilier, graphify and other owned repos
with their actual targeted tests; paths/tests are not inferred from repo names.
Two complementary reviewer host/model pairs must exist for an author. The
cursor skips infeasible authors, so full author rotation needs at least two
qualified models on each of the two local hosts. One model on Codex and two on
Claude can operate, with Codex remaining the only eligible author.

`tests` accepts `node --test file.test.js`, `vitest run file.spec.ts`, or
`npx --no-install vitest run file.spec.ts`; every selector must be an explicit
relative test file. No broad directories, globs, bare npm test or full suites.
Use `redBefore: true` only for a regression that must fail on the baseline and
pass on the candidate. Otherwise baseline tests must pass; the vulnerability
audit itself supplies dependency red/green. Both test phases use temporary
XDG/H2A state; skips, TODOs and missing execution evidence block readiness.

Every tracked `package-lock.json` / `npm-shrinkwrap.json` is audited in its own
domain, including root workspaces and independent nested components. An
unrepresented manifest or ambiguous lock pair fails coverage explicitly.
Do not hide intentional fixtures: give them a qualified lock/scanner or resolve
their component inventory in a separate repository setup change.

OSV receives only public npm registry resolved package identities. Private,
local and workspace dependencies are not sent to OSV. `osv:false` explicitly
disables that sharing and remains a reported coverage gap. npm audit uses each
repository's registry policy; configure its sharing before admitting that repo.
Optional trusted `scanners` entries have `name`, `command`, `args`; they run
without a shell at the repository workspace and return a JSON array of findings
with `id` and `severity` (`high`, `critical`, `unknown` cause triage). Other
fields can include aliases, component/path, affected version and source facts.
Scanner errors or invalid JSON are incomplete, never clean. OSV batch IDs are
hydrated; unknown severity stays visible and blocks a false clean result.

## Seat authority interface

`LocalSeats` is the single seam for future CI seats. Today it launches through
h2a-runtime's existing native launch argument/stdin builder, without tmux/native
host access. A trusted admission executable reads one JSON object on stdin:
`action` (`status` or atomic `reserve`), `units:1`, `seat`, `profile`, `model`,
`purpose:vulnerability-remediation`, exact `workspace`, `scopeBundleSha256`.
It returns JSON with `available`, `guardQualified`, `remainingUnits` (integer),
`reservePercent` (>20 and <=100), and:

```json
{"scope":{"workspace":"/exact/worktree","host":"codex","plugin":"h2a@sentropic",
 "bundleSha256":"SHA256_OF_QUALIFIED_SHIPPED_SCOPE_BUNDLE","qualifiedAt":"UTC_ISO_TIMESTAMP"},
 "reserved":true,"reservationId":"DURABLE_UNIQUE_RESERVATION"}
```

`reserved`/`reservationId` are required for reserve. Qualification must be fresh
(24h), tied to that exact workspace and the shipped hooks+helpers digest. The
authority must verify installed native hooks and quota; **echoing the request
or a static successful stub is not qualification**. Unknown quota means no
inference. Reserve must atomically account across all consumers on that CLI;
the job also pessimistically caps/reserves ten units per CLI and UTC day.
Unspent reservations are not automatically refunded. Future CI custody
implements this interface without introducing credit fallback.

Claude gets pinned SessionStart/PreToolUse hooks and restricted tools, with
shell/MCP tools disabled. Codex explicitly enables the authority-qualified
`h2a@sentropic` plugin, requires its exact-workspace scope receipt, and uses its
native read-only/workspace-write sandbox with network disabled. Qualification
of actual native execution remains external; config inspection alone is not a
live qualification. Neither local runner is the future hostile-code CI custody
sandbox; credentials/provider routing are owned by the seat authority.

## Verification and reports

Baseline/candidate SHAs, findings and targeted command outputs are retained in
`<stateDir>/reports/<UTC-day>-<run-id>.json`; `latest.json` is stable.
Dry runs use `latest-dry-run.json`. Stdout emits one summary line, exit 0 for a
successful job, 2 for failed/blocked results, 1 for usage/configuration failures.
Report files are private (0600); do not publish raw private reports to a PR.

The controller generates compatible updates with `npm audit fix
--package-lock-only --ignore-scripts`, never force. It rejects non-lock changes,
major changes per occurrence, ambiguous versions, new packages and registry or
install-script changes. Candidate checks include `npm ci --ignore-scripts`,
`npm audit signatures`, registry integrity/signature/provenance presence and
seven-day maturation. Missing provenance/unsupported evidence leaves draft;
provider/builder allowlist attestation is not implemented in this local lane.
Targeted tests and all configured detection sources must be green for ready.

Each reviewer gets its own fixed-SHA worktree and trusted diff, before/after
locks and verification artifacts, without the other review. A strict receipt
must approve the same SHA with no blocking findings. Local/remote heads are
checked before ready. GitHub has no ready-with-expected-SHA atomic primitive;
the final remote check is immediate but not a remote CAS. Manual merge remains
the conductor's responsibility.

Open automation PRs block new attempts until the conductor resolves them;
their existence does not create a green verification result. No auto rebase,
merge, major follow-up PR or human-branch mutation occurs.

## Daily timer

On Linux with Node, npm, gh, git, util-linux `flock` and qualified native CLIs:

```sh
h2a vuln-fix run --config /absolute/config.json --dry-run
h2a vuln-fix timer --config /absolute/config.json --directory /absolute/rendered-units --node /absolute/node --cli /absolute/reviewed/h2a/dist/bin.js
install -m 600 /absolute/rendered-units/h2a-vuln-fix.service /absolute/rendered-units/h2a-vuln-fix.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now h2a-vuln-fix.timer
systemctl --user list-timers h2a-vuln-fix.timer
```

The persistent timer fires at 03:00 in the machine's timezone, with up to 15m
jitter. Ensure the user manager runs overnight; lingering is an operator/system
policy. No image or CI scheduler is installed. Rendering never enables a unit.
Keep the absolute reviewed release path alive until the timer is updated.

`flock` releases the controller lock on exit/crash/reboot; never delete its
inode to bypass a live lock. Daily claims are fsynced before inference, so a
crash consumes that day's attempt. A failed/ambiguous push or PR-create response
requires the conductor to reconcile that exact remote branch before retrying.
Timeout/output overflow quarantines the repository and retains worktrees:
only the spawned direct process is signalled, and unknown descendant cleanup
is not reported as success. The systemd unit stops its own cgroup. Resolve own
service/processes/worktrees and preserve the incident evidence before manually
removing the repository's quarantine entry. Never reset claims/usage for retries.

Initial coverage excludes OS/container layers, vendored/generated artifacts,
non-npm ecosystems without custom scanners, unsupported native CLIs, effective
model attestation and live CI custody. Reports expose these gaps. Real seat
qualification and real timer activation must be performed outside confinement.
