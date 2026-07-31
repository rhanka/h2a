# Track-report wiring — bug `01KYTTAHFXRJ2PPQR73VRJKZQ7`

## Diagnosis

`track-operation` was the only deployed skill whose description explicitly claimed a plain
human report request and instructed the agent to paste `track report` output.  In the two
host stores it even included the literal French trigger, `fais-moi un track report`.  That
route can use the global executable:

```text
$ which track
/home/antoinefa/.npm-global/bin/track
```

The current H2A installer is not missing either Harness skill.  Its canonical inventory,
`packages/h2a/src/vendor/harness/skills/manifest.js`, is:

```text
using-harness, brainstorm, test, debug, review, security, track-report, plan, adopt
```

`collectInstallableSkills()` in `packages/h2a/src/cli.ts` reads
`SKILLS_DIR/harness`, enumerates exactly `HARNESS_SKILLS.map((s) => s.name)`, and rewrites
each name to `harness-<name>`.  The local plan therefore included both:

```text
.claude/skills/harness-security/SKILL.md
.claude/skills/harness-track-report/SKILL.md
```

The root cause of the missing host files was deployment drift, not a missing manifest entry:
the manifest additions are from July 27, while the user-level stores had not been refreshed.
Before this repair, both stores had `harness-adopt`, `harness-brainstorm`, `harness-debug`,
`harness-plan`, `harness-review`, `harness-test`, and `harness-using-harness`, but neither
`harness-security` nor `harness-track-report`.

## Exact change set

- `packages/track/skills/track-operation/SKILL.md`
  - narrows its frontmatter description to state hygiene, imports, and MCP-versus-CLI routing;
  - defers an owner-facing contextual report to `harness/track-report` in the one permitted
    report-section pointer; it adds no freshness mechanism.
- `packages/h2a/skills/harness/track-report/SKILL.md`
  - sharpens only the YAML `description` with the plain French request and checkout-local
    bootstrap route.

No installer or inventory code needed changing: the checked-out implementation already
enumerates and renders both Harness skills.

## User-level installation proof

I ran the documented idempotent command from this checkout for each host:

```bash
node packages/h2a/dist/bin.js install-skills --host claude --scope user --force
node packages/h2a/dist/bin.js install-skills --host codex --scope user --force
```

Both installs report 3 H2A skills, 4 Track skills, and 9 Harness skills.  The relevant
before/after result is:

| Host | Before | After |
| --- | --- | --- |
| Claude | neither Harness target existed | `~/.claude/skills/harness-track-report/SKILL.md` and `harness-security/SKILL.md` exist |
| Codex | neither Harness target existed | `~/.codex/skills/harness-track-report/SKILL.md` and `harness-security/SKILL.md` exist |

Both refreshed `track-operation/SKILL.md` files carry the new operational-only description.
The same force-install also refreshed the managed `h2a-run` and `harness` entries; no files
outside the two host skill stores were manually changed.

## Routing proof and enforceability

After deployment, `harness-track-report` is a selectable top-level skill on both hosts and
its description explicitly covers `fais-moi un track report` and the fresh checkout-local
`track` bootstrap.  `track-operation` no longer claims that human request; it declares only
operational work and points to `harness/track-report` for contextual reports.

This is structural for availability: the inventory, installer, on-disk target names, and
frontmatter names are all verified.  The final selection remains description-based model
routing, which no command or unit test can force.  The fix improves that routing signal and
removes the competing claim; it does not claim a mechanical guarantee of a model decision.

## Frozen-surface and freshness proofs

`harness/track-report`'s body is byte-identical to `origin/main`:

```text
origin/main body sha256: e5d0aebc367c122fcf722c55551660e532fa90f61d0e6241456e40f9b53b3b13
working body sha256:     e5d0aebc367c122fcf722c55551660e532fa90f61d0e6241456e40f9b53b3b13
```

`git diff origin/main...HEAD -- packages/h2a/skills/harness/track-report/SKILL.md` shows
only its `description:` line.  The required frozen-spec guard is empty:

```bash
git diff --exit-code origin/main...HEAD -- \
  docs/specs/examples/track-report-contextual.md \
  docs/specs/2026-07-29-track-report-period.md
```

The unchanged body still requires `npm ci`, `npm run build -w @sentropic/track`, and an
absolute `track_bin` under this checkout; no guard was added to `track-operation`.

## Verification

| Command | Result |
| --- | --- |
| `npm ci` | passed; 311 packages installed |
| `npm run build -w @sentropic/track` | passed |
| `npm run build:h2a` | passed |
| `node --test packages/h2a/test/install-skills-hosts.test.js` | 12 passed, 0 failed |
| `git diff --check` | passed |
| frozen-spec diff guard | passed (empty) |

The workspace package has no `build` script, so the literal `npm run build -w @sentropic/h2a`
command is not available; `npm run build:h2a` is this repository's H2A TypeScript build entry point.
