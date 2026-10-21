# Amendment — restore group matchers beyond the D13(a) proposition set

Status: design amendment shipped by PR #382 (round 3, review P3
`pr382-r3-sol`, `config.ts:116`). It extends — never weakens — SPEC
`pty-restore-injection` D13; every D13 guarantee below holds unchanged.

## What exceeds the proposition set

D13(a) proposes four matcher fields: `projects`, `cwdPrefixes`,
`projectPrefixes`, `labels`. The implementation ships four more on
`LayoutGroup` (`packages/h2a-runtime/src/config.ts`):

| Field | Role | D13 clause it implements |
|---|---|---|
| `tools` | exact agent-CLI tool equality (`claude`, `codex`, `agy`, `muse`, `vibe`) | D13(a) matcher family, D13(d) remote-group selection |
| `tags` | any-of equality against the row's registry tags | D13(a) matcher family |
| `excludeProjects` | veto: a matching project is never placed by this group | D13(b) exact-once partition aid |
| `maxTabs` | per-group window cap (default: global `maxPerWindow`) | D13(c) per-group overflow accounting |

## Why this stays inside D13

- **Partition, exactly once — D13(b).** Extra matchers only ADD ways for a
  session to match a group; placement is still first-match-wins and a taken
  session never reaches another window (`groupSessions`, `taken` set).
- **No silent loss — D13(c).** `maxTabs` overflow lands in the same
  `groupCapDrops` account as `maxPerWindow` overflow, named per group.
- **Remote groups select — D13(d).** `tools`/`tags` apply to remote tabs by
  label/cwd the same way; unmatched remote tabs are reported, never
  duplicated.
- **Validated config — D13(e).** All four fields are shape-validated
  (`validateLayoutGroups`); unknown keys still refuse loudly, so a
  misspelled matcher can never degrade to a silently empty group.
- **Pre-flight account — D13(f).** Extra matchers change which sessions a
  group matches, and the plan still states per group what matched, which
  groups are empty, and what was dropped by which cap.
- **Nothing hardcoded — standing owner rule.** No family name, root path,
  title, tool default, or tag value is hardcoded in code or defaults;
  `DEFAULT_LAYOUT.groups` stays `[]`. The owner's dedicated groups remain
  user config data.

## Conformance claim

Conformance to SPEC v4 is claimed WITH this amendment: the D13(a) field
set was a proposition ("proposition field set, pinned by lot LG before
code"), and lot LG pins the extended set here instead. Removing the four
fields would break the `restore-groups` suite (cap overflow, tool/tag
selection, exclusion veto) with no spec gain.
