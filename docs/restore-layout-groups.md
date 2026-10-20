# Dedicated restore groups

`h2a restore` partitions sessions into dedicated, user-configured windows.
This file shows the shape with placeholder names only — replace them with
real paths, never commit real family names or roots here.

```jsonc
// ~/.config/sentropic/h2a/config.json  (key: "layout")
{
  "layout": {
    "sharedWindows": 2,
    "maxPerWindow": 12,
    "groups": [
      {
        "title": "family-alpha",
        "cwdPrefixes": ["/data/family-alpha"],
        "tools": ["claude"],
        "maxTabs": 6
      },
      {
        "title": "scw-fleet",
        "remote": true,
        "projects": ["pod-alpha-1"]
      }
    ]
  }
}
```

## Matcher fields (`LayoutGroup`)

| Field | Meaning |
| --- | --- |
| `title` | Window title. Required, non-empty; slug-normalised titles must be unique. |
| `projects` | Exact project names (id-or-label equality). Checked first. |
| `cwdPrefixes` | Absolute path prefixes, e.g. a family root or a nested worktree parent. A session matches when its cwd equals a prefix or lives under it. Also admits registry rows outside `~/src` and exempts group scans from the age cutoff. No globs. |
| `tools` | Agent CLI tools, e.g. `["claude", "codex"]`. Must be known tools. |
| `tags` | Registry tags; a session matches when any tag is declared by the group. |
| `remote` | Fill this window from the SCW control plane instead of local discovery. |
| `excludeProjects` | Projects that never land in this group even when another matcher hits. |
| `maxTabs` | Per-group tab cap (default: global `maxPerWindow`). Overflow is reported, never silently dropped. |

Matching: first group wins, in config order. A group with no matchers
matches nothing locally (reported empty); for remote tabs it catches the
leftovers. A project listed in two groups lands in the first one only.

## Plan account (`--dry-run`)

The plan names placements, shared-pool (unmatched) sessions, empty groups,
and per-group cap drops. Unmatched sessions stay visible in shared windows;
unclassified or secondary sessions follow the provenance rules, not groups.
The account lines render through the locale catalog (`restore.groupCapDropped`,
`restore.emptyGroups`, `restore.unmatchedSessions`), like the rest of the plan.

## Invalid config refuses before anything launches

`validateLayoutGroups` rejects a bad `layout.groups` (empty title, duplicate
slug-normalised title, mistyped matcher, unknown tool, relative `cwdPrefixes`,
non-boolean `remote`, non-positive `maxTabs`) and `getLayoutConfig` throws, so
`h2a restore` exits 1 with a one-line `[h2a] invalid layout configuration: …`
error — no window opens, no session launches.
