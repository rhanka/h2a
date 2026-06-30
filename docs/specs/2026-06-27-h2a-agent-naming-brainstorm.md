# `h2a agent` — Renaming `remote` around AGENTS, not placement (brainstorm)

**Status: brainstorm / design-only.** No code, no plan. Companion + amendment to
`2026-06-27-h2a-unified-cli-syntax.md` (which split the `remote` CLI into `sess` + `job`).
This doc asks a narrower question the PRINCIPAL raised: **what should the `remote` surface be
*called* inside the merged `h2a`?** Verdict up front: the namespace is **`agent`** (a noun), and
**`delegate` survives as a verb** under it. `--remote` becomes a placement *flag*.

---

## 1. The thesis — `remote` names the wrong axis

`remote` was named after a *deployment substrate* (Kubernetes / Scaleway Kapsule). But the CLI's
job is not "be remote" — it is **to launch, supervise and end agents**. The remote/k8s dimension
is one **placement option** among two (local tmux vs deported Pod), and the code already treats it
that way: in `remote delegate`, distance is the `--remote [url]` *flag*, not the command's identity
(`packages/remote-cli/src/index.ts:4977`). Local `remote run` and remote delegation share the same
lifecycle (`ls`/`attach`/`stop`/`logs`). So the organising noun is **agent**, and *where it runs* is
a flag. Renaming `remote → agent` makes the CLI say what it does.

## 2. What `remote` actually is (read-only audit)

Mapping the live commander surface (`src/index.ts`) onto five concerns:

| Concern | `remote` commands today | Agent-centric reading |
|---|---|---|
| **Launch interactive** | `run <profile> [path]`, per-profile wrappers `claude`/`codex`/`agy`/… (`:1948`), `--count` fan-out | create an agent *instance* I attach & drive |
| **Delegate headless** | `delegate <type> <task>` `--headless` `--on-done` `--max-depth` `--track` (`:4973`) | hand a *task* to a detached agent → job id |
| **Deport to k8s** | the `--remote [url]` flag on `delegate`; `workspace`/`migrate`/`sync`/`diff`/`forward` | **placement**, not identity |
| **Supervise** | `ls`, `status`, `agents {ls,inspect}` (`:5248`), `jobs {ls,status,attach,logs,decisions,decide,conduct}` (`:5294`) | inventory + drive the estate |
| **Wake / lifecycle** | `attach`, `stop`, `resume`, `wake-request` (`:6439`), `relaunch`, `resume-throttled` | nudge / end an instance |

The deport plumbing (`workspace`/`sync`/`migrate`/`forward`/`connect`/`tunnel`) is the **only** part
where "remote" is honest — it really is about the k8s substrate. Everything else is *agents*.

## 3. The name — `agent` (noun) AND `delegate` (verb) coexist

The PRINCIPAL's instinct is exactly right and resolves into a noun/verb split that already exists
in the surface:

- **`agent`** = the **noun namespace** for an agent *instance*'s whole lifecycle (launch → attach →
  supervise → stop → wake). Namespaces in the unified grammar are all nouns (`msg`, `key`, `nhi`,
  `sub`, `job`, `sess`…); `agent` belongs in that family. `h2a agent run claude` launches one of our
  agents; `h2a agent ls` lists them. This is the bulk of the old `remote` and the daily surface.
- **`delegate`** = a **verb** that *creates* a task-bearing agent (`h2a agent delegate codex "fix X"`).
  It keeps the h2a-frame resonance (delegating a task to a peer) **precisely because it stays a verb**
  — it is the imperative "hand this task off", not a place to park lifecycle verbs.

**They coexist as namespace + sub-verb**, not as two competing names: `delegate` lives *inside*
`agent`. `agent run` = "I will drive it"; `agent delegate` = "you run it and report back". Same noun,
two creation verbs distinguished by who holds the keyboard.

**Why `agent` beats `delegate` as the namespace.** `delegate` names *one* operation (task handoff);
making it the namespace is synecdoche — `delegate attach`/`delegate ls` would read as nonsense. A
namespace must be the noun that *all* its verbs operate on. Only `agent` does.

**Discarded candidates:**
- **`runagent`** — bakes one verb (`run`) into the noun; `runagent stop`/`runagent ls` reads badly,
  and it is not a real word. Same synecdoche flaw as `delegate`-as-namespace.
- **`background-agent`** — names a *mode* (detached/headless), which is exactly what we are demoting
  to a flag (`--background`). Naming the namespace after a mode contradicts the whole thesis (mode &
  placement are options, not identity). Hyphen also makes an ugly CLI token.
- **`subagent`** — implies subordination to a parent, but `h2a agent run claude` launches a *peer*
  I drive, not necessarily a child. Worse, `sub`/`subagent` is **already taken** in the unified
  grammar for the h2a subagent *registry* (`register`/`route`/`audit`/`revoke`, delegated identities).
  Reusing it here collides.

## 4. The `h2a agent …` grammar

```
h2a agent <verb> [target] [flags]

LIFECYCLE sub-verbs (instance, any placement/mode):
  run [profile] [path]        launch & (default) attach an interactive agent
  delegate <profile> <task>   hand a task to a detached agent → returns a job id
  ls                          inventory agents: local + remote, interactive + delegated
  status                      health snapshot of the agent estate (+ auth correlation)
  attach <slug|id>            attach this terminal to an agent
  logs <id>                   tail an agent's output (headless job / session)
  stop <slug|id>              stop a local session / terminate a remote one
  wake <slug|id>              nudge a stalled/idle agent (relaunch + wake-request + resume)
  inspect <id>                one-agent detail projection (was `agents inspect`)

DELEGATION-CONTROL sub-verbs (only meaningful for delegated/background agents):
  decide <id> <answer>        answer a delegated agent's decision request
  conduct                     drain the pending delegation queue   (--watch)

PROFILE flags — which kind of agent (canonical = positional <profile>; flags = sugar):
  --claude | --codex | --gemini | --agy | --mistral
PLACEMENT flag — where it runs (default = local tmux):
  --remote [url]              run in a SCW Pod (k8s); optional control-plane URL
MODE flags — how it runs:
  --background / --detach     don't attach (fan-out / scripted orchestration)
  --task <t>                  attach a task → delegated/headless semantics
  --headless                  run-once-exit batch (claude -p / codex exec)
COMMON: --name <slug>  --count <n>  --resume <conv>  --track <wp>  --json  --watch
```

Notes:
- **Profile = positional, canonical.** `h2a agent run claude` mirrors today and keeps `delegate
  <profile> <task>` unambiguous. `--claude`/`--codex`/… are convenience aliases (`h2a agent --claude`
  ≡ `h2a agent run claude`), absorbing the old per-profile wrappers (`remote claude`).
- **One verb per axis.** Interactive vs headless = the `--task`/`--headless`/`--background` *mode*
  flag on the same `run`/`delegate`. Local vs k8s = the `--remote` *placement* flag. Supervision
  verbs (`ls`/`attach`/`logs`/`inspect`) are identical regardless of mode or placement.
- **Bare-verb coexistence (per the syntax doc).** The Tier-1 bare verbs the doc keeps
  (`h2a run`/`attach`/`stop`/`delegate`/`wake`/`logs`) are simply the single-owner *shortcuts* into
  this namespace — `h2a run` ≡ `h2a agent run`. `agent` is the explicit escape hatch; nothing is lost.

## 5. Reconciliation with the syntax doc (§4 / §11)

The syntax doc split the old `remote` CLI into **`sess`** (session lifecycle) + **`job`** (delegation
supervision) + bare verbs. This proposal **collapses both into one `agent` namespace**, because the
`sess`/`job` split is along *provenance* (a session I started vs a job I delegated) — but once
running, both are just *agents* differing by **flags**. Two near-duplicate verb sets (`sess
run/attach/stop` vs `job ls/attach/logs`) is exactly the duplication Principle 7 warns against.

| Syntax-doc form | This proposal | Note |
|---|---|---|
| `h2a run <profile>` (bare) | `h2a agent run <profile>` (bare alias kept) | interactive launch |
| `h2a delegate <type> <task>` (bare) | `h2a agent delegate <type> <task>` (bare alias kept) | `delegate` = verb, stays |
| `h2a sess {run,attach,stop,resume}` | `h2a agent {run,attach,stop,resume}` | `sess` namespace **retired** |
| `h2a sess {workspace,migrate,sync,diff,forward,restore}` | `h2a remote {…}` (deport plumbing) | see Q-B: `remote` *shrinks*, not dies |
| `h2a job {ls,status,attach,logs}` | `h2a agent {ls,status,attach,logs}` (filter `--background`) | folded into `agent` |
| `h2a job {decide,conduct,decisions}` | `h2a agent {decide,conduct}` | delegation-control, filtered not split |
| `remote agents {ls,inspect}` | `h2a agent {ls,inspect}` | projection = the same `ls`/`inspect` |
| `remote wake-request` / `relaunch` / `resume-throttled` | `h2a agent wake [--relaunch] [--throttled]` | one `wake` verb |

**Decision — can ONE `agent` namespace cover interactive + headless + distant + supervision?**
**Yes, recommend collapsing `sess`+`job`+`agents` into `agent`.** The four axes are orthogonal flags,
not separate namespaces: mode (`--task`/`--headless`/`--background`), placement (`--remote`),
provenance (a `--background` filter on `ls`), and supervision (shared verbs). The delegation-only
control verbs (`decide`/`conduct`) stay as `agent` sub-verbs (they simply no-op on interactive
agents) rather than justifying a whole `job` namespace.

**One residual carve-out:** the genuine **deport plumbing** (`workspace`/`sync`/`migrate`/`forward`/
`connect`/`tunnel`) is *infrastructure for the k8s substrate*, not agent-instance lifecycle. Keep it
OUT of `agent` so `agent` stays about agents — park it under a slimmed **`remote`** (now honest: it
names *only* the k8s-deport plane) or `host`. This is the one place the word `remote` keeps its job.

## 6. Five before / after

| # | Before (`remote`) | After (`h2a agent`) |
|---|---|---|
| 1 | `remote run claude` | `h2a agent run claude` (or `h2a agent --claude`) |
| 2 | `remote delegate codex "fix X"` | `h2a agent delegate codex "fix X"` |
| 3 | `remote delegate codex "fix X" --remote` | `h2a agent delegate codex "fix X" --remote` (k8s placement) |
| 4 | `remote jobs ls` | `h2a agent ls --background` (delegated agents only) |
| 5 | `remote agents ls` | `h2a agent ls` (whole estate, local + remote) |

## 7. Open questions (double-consensus before any spec)

- **Q-A — `agent` vs the doc's `sess`/`job`.** This proposal retires `sess` and folds `job` into
  `agent`. Confirm one namespace with flags beats two provenance-named namespaces. (Reversible.)
- **Q-B — what keeps the word `remote`.** Recommend `remote` *shrinks* to the k8s-deport plumbing
  (`workspace`/`sync`/`migrate`/`forward`/`tunnel`). But the syntax doc's Q2 also wanted `remote` for
  h2a's HTTP **bus**, and renamed that to `h2a bus`. So `remote` is free for the deport plane — or do
  we kill the word entirely and put deport under `host`/`deploy`? (Cross-doc; pick one owner.)
- **Q-C — profile: positional or flag canonical.** Recommend positional `<profile>` canonical +
  `--claude`/… as sugar. Or invert (flags canonical, à la the PRINCIPAL's `h2a agent --claude`)?
- **Q-D — `delegate`'s home.** Keep `delegate` as BOTH a bare Tier-1 verb (`h2a delegate`) AND
  `agent delegate`? Or only one? Recommend both (bare = ergonomics, namespaced = discoverability).
- **Q-E — `decide`/`conduct` placement.** Folded as `agent` sub-verbs here. Acceptable, or does the
  delegation control plane deserve a thin `job`/`delegate` namespace after all? (Watch the bare
  `decide` collision with `track decide` flagged in the syntax doc §11.)
- **Q-F — migration/compat.** Inherit the syntax-doc §11 deliverable: legacy aliases
  (`remote run` → `h2a agent run` with a deprecation warning), `h2a help map`, `h2a explain
  <old-command>`. Non-negotiable for deployability.
```

---

## 8. Réconciliation double consensus (Opus-4-8 + Codex 5.5 xhigh — 2026-06-27)

Verdict des deux = **AMEND** (convergent). La direction (renommer autour des agents, `--remote`=placement, `delegate`=verbe) est validée ; 4 must-fixes.

### MF1 — Résoudre la SURCHARGE de `agent` par une TAXONOMIE stricte (le trou central)
`agent` collisionne avec le vocabulaire h2a existant (pair du bus, NHI, subagent-registry). Résolution retenue : **`agent` = uniquement les INSTANCES RUNTIME que je lance/supervise** ; les autres populations gardent leurs namespaces distincts.

| Concept | Surface | N'est PAS `agent` |
|---|---|---|
| Instance runtime que JE lance (interactive/headless/local/Pod) | `h2a agent run/ls/attach/logs/stop/wake/inspect` | — |
| Tâche déléguée (contrat + résultat + supervision) | **type `job`** observable ; `h2a agent delegate` crée, `h2a job ls/decide/conduct` supervise | distinct du lifecycle |
| Pair découvert sur le bus (présence) | `h2a find` / `h2a ls` (peers) | pas `agent ls` |
| Identité non-humaine | `h2a nhi …` | |
| Subagent délégué enregistré | `h2a sub …` | |

Règle : `h2a agent ls` = **mes instances lancées**, jamais les pairs du bus (ceux-là = `find`/`ls`). Taxonomie d'IDs/types/états à figer dans la spec avant tout code. Alternative si la frontière ne tient pas : utiliser **`instance`/`run`** au lieu de `agent`.

### MF2 — `delegate` : canonique namespacé + un seul statut
`h2a agent delegate <profile> <task>` = **canonique** ; bare `h2a delegate` = alias Tier-1 documenté. Trancher : `delegate` est un **verbe distinct** (création d'un job avec contrat de tâche) — PAS un simple mode-flag de `run`. `run` = j'attache ; `delegate` = je confie + j'attends un résultat. Deux verbes assumés, une seule forme canonique.

### MF3 — `job` survit comme TYPE observable
Le plan de contrôle de délégation (`decide`/`conduct`/file de décisions/`on-done`/`max-depth`) est **job-level, pas instance-level**. `job` reste un type visible dans les sorties/docs/IDs ; garder un mince `h2a job {ls,decide,conduct}` (ou `agent` qui refuse clairement les non-jobs). Ne pas dissoudre `job` dans `--background`.

### MF4 — `remote` / placement
- `--remote` **booléen** (placement Pod/k8s) + `--remote-url <url>` séparé (le `--remote [url]` à valeur optionnelle avale le positionnel suivant — footgun).
- La plomberie de déport (workspace/sync/migrate/forward/tunnel) → sous **`host`** (ou `deploy`), **pas** un namespace `remote` ressuscité.
- Pré-requis cross-doc : décider le nom du bus HTTP (Q2 du doc syntaxe : `h2a bus`) AVANT de réutiliser/retirer le mot `remote`.

### Q-A..Q-F — tranchées
Q-A collapse oui (mais `job`=type, MF3). Q-B plomberie sous `host` tant que le bus n'est pas renommé. Q-C positionnel canonique. Q-D `agent delegate` canonique + bare alias. Q-E `decide`/`conduct` = délégation-control (job-typé), refus explicite sur instances interactives. Q-F migration/compat héritée du doc syntaxe §11 (alias mesurés, warning, `explain`, gel — pas éternels).

**Statut : AMENDÉE par double consensus.** DÉCIDÉ (Fabien 2026-06-27): garder **`agent`** + taxonomie stricte MF1 (`agent`=instances runtime que je lance ; pairs=`find` ; NHI=`nhi` ; registre=`sub`).
