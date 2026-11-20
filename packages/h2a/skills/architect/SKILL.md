---
name: architect
description: Use when asked for an architecture diagram or schema (« schéma d'archi », « mermaid engram », a logical or infra view of a repo) — writes one engram.archi-mermaid/1 file (profile archi@1) from facts with evidence, checks it with scripts/check-mmd.mjs, and hands it to the design-system renderer. Intentions only (kinds, relations, nesting, view order, folds, legend, lifecycle); never geometry, styles or layout scripts.
---

# architect

Turn sourced facts into one `.engram/architecture/<name>.mmd` that engram accepts
and the design system can render.

| Owner | Delivers |
|---|---|
| h2a (this skill) | facts with evidence → the `.mmd` → a green check → hand-off |
| engram | the format `engram.archi-mermaid/1`, the model, `engram archi check` and `engram archi fmt`, ingestion |
| design system | layout, rendering, exports (SVG, draw.io, Svelte, Vue) |

## Workflow

1. **Gather facts with evidence.** Read the sources (code, manifests, IaC, an
   existing diagram). Each fact keeps its evidence: `path:line` or
   `path:start-end` (prefix `repo@commit:` for another repo), or
   `assertion: <who stated it, when>`. 1–8 items, ≤ 200 characters each.
   Never invent a line number, an entity or a relation.
2. **Classify and relate** with the vocabulary below. A source element that
   fits no kind, or a link that fits no relation, goes to the gap report.
3. **Write the file.** Start from the head printed by
   `node <skill-dir>/scripts/check-mmd.mjs --print-head --document <id> --owning-repo <e_repo_id> --language en [--legend]`
   (it carries the governed pins), then the entity tree, relations and views.
4. **Check** until green:
   `node <skill-dir>/scripts/check-mmd.mjs <file> --write`
   (`--write` rewrites the canonical form first; `--json` for machines).
5. **Gap report** next to the file: every source item that archi@1 cannot
   carry, with its source location and the reason. Listed, never invented.
6. **Hand off.** DS renderer: pending — no design-system entry point consumes
   engram.archi-mermaid/1 yet. Give the checked file to the design-system
   owner; never write a layout, routing or render script.

`<skill-dir>` is the directory of this file. engram ingests
`.engram/architecture/architecture.mmd`; a file with another name is a
candidate until engram ingests it. This skill never commits: the owner of the
repo decides.

## Vocabulary (archi@1)

| Kind | Forms (required, optional for actor) | Exclusive test |
|---|---|---|
| actor | human, agent, team, org | who uses, owns or operates (no role needed) |
| system | — (container) | a product |
| repo | — (container); `url` | a source repository |
| package | library, plugin, app (container); `version` | a distribution |
| component | — | a part of a package's code |
| runtime | cli, mcp-server, daemon, job, hook | an executed entry point |
| service | — | the operated process, not its data |
| api | mcp, http, cli; `access` read-only\|read-write | an interface |
| store | jsonl, file, database, object-store, graph; `writerPolicy` single-writer\|multi-writer | data written at run time |
| artifact | skill, manifest, schema, doc | a file not written at run time |
| host | workstation, cluster, cloud-project (container) | where runtimes and services run |

Every kind but actor needs `role` (≤ 400 characters); every record needs
`evidence`. `shortName` (≤ 40) and `category` (a key such as `core`) are optional.

| Relation | From → to | Written as |
|---|---|---|
| partOf | component, artifact → package; package, runtime, service, api, store, system → system | nesting: `subgraph` + `%% @dl nest <id>` |
| managedIn | system, package, component, runtime, service, api, store, artifact → repo | `rel` |
| runsOn | runtime, service → host | `rel` |
| ownedBy | any kind but actor → actor | `rel` |
| operatedBy | service, host → actor, system | `rel` |
| uses | actor → runtime, service, system | `rel` |
| providesApi | runtime, service → api | `rel` |
| deployedAs | package → runtime, service | `edge` |
| dependsOn | package → package | `edge` |
| executedBy | package, component → runtime | `edge` from a package, `rel` from a component |
| loadedBy | package, artifact → runtime | `edge` from a package, `rel` from an artifact |
| invokes | runtime → runtime; `trigger` hook\|poll\|mcp-stdio\|command\|schedule | `edge` |
| consumesApi | runtime, service, actor → api | `edge` |
| accesses | runtime, service, component → store; `mode` read\|append\|write | `edge`, but `rel` for read or a single-writer store |
| documents | artifact → runtime, api, component, package | `edge` |

An `edge` label starts with its verb, alone or as `verb · detail`:
en `launches` (invokes), `polls` (invokes, trigger poll), `calls`,
`deployed as`, `depends on`, `documents`, `run by`, `loaded by`,
`appends to`, `writes`; fr `lance`, `sondage`, `appelle`, `déployé comme`,
`dépend de`, `documente`, `exécuté par`, `chargé par`, `ajoute à`, `écrit`.

Footers the check requires: a store has ≥ 1 writer (`accesses` append or
write; exactly 1 when single-writer); a service or host has `operatedBy`; a
repo has `ownedBy`; any other non-actor has a repo (`managedIn` on it or an
ancestor) or `ownedBy`. `executedBy` needs its package (or a dependency) to
be `deployedAs` that runtime.

Texts: `name` is the referent's own name, `shortName` (≤ 40) the display
title when it differs, `role` what it does. Keep the source wording.

## When a fact is missing

- A required owner, operator or repo that no source states: link to one
  actor named `unverified` (evidence `missing source: …`), keep it out of
  every view's `draw`, and list each link as an owner question. Never pick an
  owner.
- A required enum the source does not state (`writerPolicy`, `access`,
  `mode`): record the value chosen and why in the gap report.
- A container the vocabulary cannot nest (a free zone, a host inside a host,
  a repo inside a forge): drop the container, keep its members, carry the
  grouping with `group`/`order`, and list it. A kind chosen only to keep a
  nesting is listed as a compromise.

## File shape

```
flowchart LR
%% @dl format engram.archi-mermaid/1          ← head: from --print-head
...
%% @dl entity system
%% @dl role "Takes and serves notes"
%% @dl evidence "README.md:3"
subgraph e_sys_notes["Notes"]
  %% @dl entity runtime cli
  %% @dl role "Writes notes from the terminal"
  %% @dl evidence "package.json:8"
  %% @dl nest po-cli                           ← partOf e_sys_notes
  %% @dl evidence "package.json:8"
  e_rt_cli["notes"]
end

%% @dl rel ro-cli runsOn e_rt_cli e_host_ws
%% @dl evidence "README.md:7"
%% @dl edge ca-api consumesApi
%% @dl evidence "src/cli.ts:40"
e_rt_cli -->|"calls · HTTP"| e_api_http

%% @dl view overview archi-composition
%% @dl draw e_rt_cli
%% @dl expanded e_sys_notes
```

- Ids (≤ 40 characters after the prefix): entity `e_` + a letter + `[a-z0-9_]`;
  relation and view a letter + `[a-z0-9-]`. Names are quoted.
- A `subgraph` means `partOf` only. Other trees (`runsOn`, `managedIn`) are
  `rel` lines; a view picks its tree: `archi-composition`, `archi-source`,
  `archi-deployment` or `archi-dossier-hosts`.
- A view lists `draw` and `expanded` (drawn containers shown open; the others
  are folded), then optional `legend`/`key`/`token`, `stretch`, `order`,
  `group`/`item`. A legend needs `profile generic@2` (`--legend`) and
  `legend-key` entities whose `category` matches the entities'.
- `%% @dl lifecycle proposed|retired` draws dashed: edges use `-.->`, and the
  file ends with `classDef dashed stroke-dasharray: 5 5` and
  `class <eids> dashed` (write it once by hand; `--write` keeps it canonical).
- Full grammar: engram `src/archi-mermaid/index.ts`; working example:
  `packages/h2a/test/fixtures/architect/notes.mmd` in the h2a repo.

## Intentions, never geometry

Carry: typed entities with evidence, relations with a leading verb, nesting,
view `order`/`group`/`item`/`stretch`, `expanded`, legend keys and tokens,
lifecycle. Never: sizes, coordinates, gaps (`@dl gap`, `gap-after`), styles
(`style`, `linkStyle`, `classDef` beyond the lifecycle class, `:::`), Mermaid
configuration (`%%{init}%%`, front matter), routing or label positions. The
design system refuses spacing overrides and owns the layout.

## Checker

`scripts/check-mmd.mjs` (Node built-ins only) runs, in order:
`forbidden` (the list above, even when parsing fails), `parse`, `canonical`
(`format(x) === x`), `stage1` (engram ingestion invariants), `pins` (the
governed pins), `semantic` (engram `checkArchi`), `profile` (relation matrix,
required attributes, enums and lengths of the archi@1 declaration).
Exit codes: 0 pass, 1 diagnostics, 2 usage or I/O error, 3 engram not available.

It uses `engram archi check <f.mmd> [--json] [--allow-gap]` and
`engram archi fmt <f.mmd> [--write|--check]` when that CLI is on `PATH`
(invoking `engram archi check <f.mmd> --json` without `--allow-gap`, and
`engram archi fmt <f.mmd> --check` or `--write`), and the
`@sentropic/engram` library for the other stages: `--engram-dist <dir>` or
`ENGRAM_DIST`, else the copy installed with the h2a plugin, the current
directory, or the global npm root. To build one from source:
`git clone https://github.com/rhanka/engram && cd engram && npm ci && npm --prefix engram-memory run build && npm run build:server`,
then pass `--engram-dist <engram>/dist`. Force a path with `--engram cli|lib`.

## Never

- Write geometry, styles, layout hints beyond the list above, or a render script.
- Invent evidence, an entity or a relation to close a gap.
- Write outside `.engram/architecture/` and the session's temporary folder, or commit.
- Use Python.
