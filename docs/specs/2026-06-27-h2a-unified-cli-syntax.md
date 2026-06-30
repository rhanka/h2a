# `h2a` — Unified Simplified CLI Syntax (brainstorm)

**Status: brainstorm / design-only.** No code, no plan. Proposes the verb grammar for the
future single `h2a` CLI that absorbs the surface of `remote` + `track` + `h2a` + `harness`.
Companion to `sentropic/spec/SPEC_EVOL_STP_FEDERATION.md` (the `stp <name>` federation
roster). Where federation keeps four CLIs behind one umbrella, this doc asks the opposite
question: **if `h2a` becomes the one CLI, what is its minimal harmonized verb grammar?**

Investigated surfaces (read-only, this session): `h2a --help` + `cli-contract.ts` (~90 verbs),
`remote --help` + subcommands (~40), `track --help` (~30), `harness --help` + `harness-*` skills
(~12), and the federation spec.

---

## 1. Principles (à la Hermes)

1. **Verb-first, namespace-optional.** A small set of *transverse verbs* is learned once and
   reused across every domain. The grammar is `h2a <verb>` (Tier 1, the 80%) or
   `h2a <domain> <verb>` (Tier 2, the specialist surface). You compose ~15 verbs × ~14 domains
   instead of memorizing ~160 unique command names.
2. **One verb, one meaning.** `ls` always lists, `open`/`close` always bracket a lifecycle,
   `report` always projects status, `verify` always gates. The *object* changes with the
   namespace; the *act* does not.
3. **Smart bare default.** A bare transverse verb resolves to its most-common object
   (`h2a ls` = live peers; `h2a status` = agent inventory; `h2a report` = work state). The
   namespaced form is the always-available escape hatch (mirrors federation Option A: bare verb
   = single owner; `h2a <domain> <verb>` never removed).
4. **`--json` universal; human text on a TTY.** Replaces today's split (`track --format json`,
   `harness --json`, h2a bare-JSON envelopes, remote ad-hoc). One flag, every verb.
5. **`--watch` is a flag, not a verb.** Any long-running verb (`watch`, `conduct`, daemons)
   becomes `<verb> --watch`. Removes four near-duplicate watch loops.
6. **`--root` / `--workspace` are global + env.** `H2A_ROOT` / `H2A_WORKSPACE` env defaults;
   one global flag. Stop repeating `[--root <path>]` on every line.
7. **Zero duplication.** Where remote/track/h2a each grew their own `status`, `ls`, `decide`,
   `init`, `install-skills`, they collapse to one verb with the union of behaviour behind flags.

---

## 2. The two-tier model

**Tier 1 — bare transverse verbs** (no namespace; the daily surface):

| Verb | Bare default (object) | Unifies (today) |
|---|---|---|
| `ls` | live peers/sessions | remote ls · h2a sessions/discover |
| `status` | local+remote agent inventory + auth | remote status · h2a status |
| `report` | work/realization state | track report |
| `find` | resolve a peer by name/role/scope | h2a discover · remote agents ls |
| `send` | deliver an envelope to a peer | h2a inbox put · remote send |
| `inbox` | read/pop my mailbox | h2a inbox read/pop |
| `open` | open my live session (presence) | h2a session_open |
| `close` | close my live session | h2a session_close |
| `connect` | bootstrap host wiring + keypair | h2a connect · host setup |
| `run` | start a local agent session | remote run |
| `attach` | attach to a session | remote attach |
| `stop` | stop a session | remote stop |
| `wake` | nudge/relance a stalled or idle peer | h2a drive · remote wake-request/relaunch |
| `delegate` | spawn an agent job for a task | remote delegate |
| `logs` | tail a job/loop/session | remote jobs logs · loop logs |
| `decide` | record/answer a decision | track decision · remote jobs decide |
| `verify` | run the scope/test/signature gate | harness verify · *-verify (namespaced) |
| `doctor` | diagnose store + wiring health | h2a doctor · remote check |
| `init` | create local stores (h2a+track+profile) | h2a init · track init · harness init |
| `up` | self-upgrade the CLI | h2a upgrade |

**Tier 2 — domain namespaces** (`h2a <domain> <verb>`; the specialist surface):

| Domain | Owns | Reuses transverse verbs |
|---|---|---|
| `msg` | mailbox + threads | `ls`, `send`, `pop`, `thread` |
| `nego` | negotiation + trust ledger | `open`, `ls` (journal), `status`, `verify` |
| `key` | ed25519 keyrings | `ls`, `add`, `revoke`, `gen` |
| `nhi` | non-human-identity posture | `report`, `ls` (inventory), `attest`, `export`, `offboard` |
| `sub` | subagents | `ls`, `route`, `revoke`, `audit` |
| `org` | org manifest + coach | `validate`, `show`, `diff`, `apply`, `propose`, `ratify` |
| `cond` | conductor election + launch | `ls`, `claim`, `release`, `launch` |
| `drum` | anti-stall drumbeat | `ls` (scan), `record`, `clear`, `watch` |
| `job` | delegation supervision | `ls`, `status`, `attach`, `logs`, `decide`, `conduct` |
| `sess` | remote session lifecycle | `run`, `attach`, `stop`, `resume`, `sync`, `diff`, `forward` |
| `track` | realization state | `item`, `decision`, `accept`, `blocker`, `scope`, `report` |
| `dev` | harness dev-discipline | `check`, `verify`, `brainstorm`, `plan`, `test`, `debug`, `review`, `branch` |
| `host` | host MCP/hook wiring | `setup`, `plugin`, `status`, `skills` |
| `deploy` | k8s render | `sidecar`, `tenant` |
| `mcp` | MCP transport | `serve`, `tools` |

Legend for the mapping tables below: **(C)** = the verb collides across domains and is
disambiguated by the namespace or the bare-default rule (§5).

---

## 3. Mapping A — current `h2a` → unified `h2a`

| Today | Unified | Note |
|---|---|---|
| `h2a hosts` / `mcp-tools` | `h2a host ls` / `h2a mcp tools` | |
| `h2a init` | `h2a init` | (C) now also seeds track+profile via `--all` |
| `h2a register` / `discover` | `h2a register` / `h2a find` | `find` = resolve/discover |
| `h2a connect` | `h2a connect` | absorbs `host setup` |
| `h2a status` / `sessions` | `h2a status` / `h2a ls` | (C) merged with remote (§5) |
| `h2a rename` | `h2a rename` | reflects host-native name |
| `h2a doctor` / `keepalive` | `h2a doctor` / `h2a keepalive` | |
| `h2a subagent {register,list,route,inbox,audit,revoke}` | `h2a sub {register,ls,route,inbox,audit,revoke}` | `list`→`ls` |
| `h2a negotiate {open,status,event,offer,counter,sign,stabilize,journal}` | `h2a nego {open,status,event,offer,counter,sign,stabilize,ls}` | `journal`→`ls` (C on `status`) |
| `h2a declare-interest` / `conflict-posture` / `dossier` / `confiance` | `h2a nego {interest,conflict,dossier,trust}` | trust ledger under `nego` |
| `h2a attest-comprehension` / `comprehension {list,verify}` | `h2a nego attest` / `h2a nego comp {ls,verify}` | (C) `verify` |
| `h2a inbox {put,read,pop}` / `outbox {put,read}` | `h2a send` / `h2a inbox` / `h2a inbox pop` / `h2a msg out {send,ls}` | `send` bare = inbox put |
| `h2a thread` | `h2a msg thread` | |
| `h2a store migrate` | `h2a store migrate` | |
| `h2a mcp-serve` / `upgrade` | `h2a mcp serve` / `h2a up` | |
| `h2a remote {serve,send,mirror-serve,mirror}` | `h2a bus {serve,send,mirror-serve,mirror}` | rename `remote`→`bus` to free `remote`/`sess` |
| `h2a drive` / `drive receive` / `drive serve` | `h2a wake` / `h2a wake verify` / `h2a wake serve` | (C) `verify`; `wake` = signed nudge |
| `h2a sysml verify` | `h2a sysml verify` | (C) `verify` |
| `h2a drumbeat {record,scan,clear,escalations,relance-inbox,watch}` | `h2a drum {record,ls,clear,escalations,relance,watch}` | `scan`→`ls`, `watch` keeps |
| `h2a host {setup,plugin,status}` | `h2a host {setup,plugin,status}` | (C) `status` namespaced |
| `h2a conductor` / `conductor {claim,release}` | `h2a cond` / `cond {claim,release}` | |
| `h2a conductor-launch-check` / `conductor-launch` | `h2a cond launch [--check] [--confirm]` | merge the two + dry-run flag |
| `h2a keys {generate,add,list,revoke}` | `h2a key {gen,add,ls,revoke}` | `list`→`ls` |
| `h2a nhi {report,inventory,attest,offboard,export}` | `h2a nhi {report,ls,attest,offboard,export}` | `inventory`→`ls` (C `report`) |
| `h2a blockage {raise,list,resolve}` | `h2a block {raise,ls,resolve}` | (C `ls`) |
| `h2a org {validate,show,diff,provision}` / `coach {propose,ratify}` | `h2a org {validate,show,diff,apply,propose,ratify}` | coach folds into `org` |
| `h2a install-skills` | `h2a host skills` | unify with track/harness skills (§6) |
| `h2a deploy {k8s-sidecar,k8s-tenant}` | `h2a deploy {sidecar,tenant}` | |
| `h2a loop {create,list,status,agents,attach,logs,tick,watch}` | `h2a loop {create,ls,status,agents,attach,logs,tick,watch}` | `list`→`ls` |

## 4. Mapping B — `remote` → `h2a`

| Today | Unified | Note |
|---|---|---|
| `remote run <profile>` | `h2a run <profile>` | bare verb |
| `remote ls` / `status` | `h2a ls` / `h2a status` | (C) merged with h2a |
| `remote attach` / `stop` / `resume` | `h2a attach` / `stop` / `resume` | |
| `remote codex/claude/gemini/agy/...` | `h2a run <profile>` | the wrappers become one `run --profile` |
| `remote delegate <type> <task>` | `h2a delegate <type> <task>` | bare verb |
| `remote jobs {ls,status,attach,logs,decisions,decide,conduct}` | `h2a job {ls,status,attach,logs,decisions,decide,conduct}` | (C) `decide`/`conduct` |
| `remote agents {ls,inspect}` | `h2a find` / `h2a sess agents` | projection = `find` |
| `remote conductor-launch` | `h2a cond launch` | same verb as the h2a side |
| `remote wake-request` | `h2a wake serve` | wake receiver |
| `remote relaunch` / `resume-throttled` | `h2a wake --relaunch` / `h2a wake --throttled` | flags on `wake` |
| `remote h2a {ping,bridge}` | `h2a bus {ping,bridge}` | |
| `remote connect` / `disconnect` | `h2a connect --tunnel` / `disconnect` | (C) `connect` (§5) |
| `remote install` / `config` / `auth` / `secrets` | `h2a sess {install,config,auth,secrets}` | session-plane admin |
| `remote workspace` / `migrate` / `restore` / `layout` | `h2a sess {workspace,migrate,restore,layout}` | |
| `remote sync` / `sync-files` / `sync-status` / `diff` | `h2a sess {sync,sync-files,sync-status,diff}` | |
| `remote forward` / `browser` / `check\|smoke` | `h2a sess {forward,browser,check}` | (C) `check` vs harness |
| `remote enroll` | `h2a sess enroll` | plumbing |
| `remote plugin add` | `h2a host plugin add` | unify with host wiring |

## 5. Mapping C — `track` → `h2a`

| Today | Unified | Note |
|---|---|---|
| `track init` | `h2a track init` (or `h2a init --all`) | |
| `track report` | `h2a report` | bare verb; gap-spec canonical alias |
| `track query` | `h2a track query` (or `h2a report --query`) | |
| `track item {new,reparent,scope-declare,spec-amend,spec,realize,show,ls}` | `h2a track item {...,ls}` | |
| `track decision {new,outcome,dossier,disposition,add-artifact}` | `h2a decide` / `h2a track decision {...}` | (C) bare `decide`=new/outcome |
| `track blocker {raise,resolve,resolve-external}` | `h2a track blocker {...}` | distinct from `h2a block` (peer blockage) (C) |
| `track accept {criterion,link,run,waive}` | `h2a track accept {...}` | |
| `track scope validate` / `validate` | `h2a track scope` / `h2a track validate` | (C) `verify` family |
| `track workspace-activity` / `focus` | `h2a track activity` / `h2a track focus` | |
| `track consolidate` / `priority assess` | `h2a track {consolidate,priority}` | |
| `track branch import` / `ingest` / `export-graph` | `h2a track {import,ingest,export}` | |
| `track workspace-id` | `h2a track workspace-id` | |
| `track install-skills` | `h2a host skills --of track` | one skills installer (§6) |

## 6. Mapping D — `harness` → `h2a`

| Today | Unified | Note |
|---|---|---|
| `harness check <scope\|branch>` | `h2a dev check <scope\|branch>` | (C) vs `remote check` → `sess check` |
| `harness verify --category` | `h2a verify --category` | bare verb = the dev gate |
| `harness audit` / `init` | `h2a dev audit` / `h2a dev init` (profile) | (C) `init` |
| `harness brainstorm/plan/test/debug/review` | `h2a dev {brainstorm,plan,test,debug,review}` | method recorders |
| `harness branch <init\|close>` | `h2a dev branch {open,close}` | (C) `open`/`close` namespaced |
| `harness skills install` | `h2a host skills --of dev` | one skills installer |

**One `skills` installer.** Today four CLIs each ship `install-skills`/`skills install`
(h2a, track, harness, and remote-via-plugin). Unified: `h2a host skills [--of h2a,track,dev]
[--host claude|codex|gemini|agy] [--scope user|project]`. Default installs the full bundle.

## 7. Mapping E — `stp` federation reconciliation

The federation roster keeps `stp <name>` as the umbrella over *separate* CLIs; this proposal
is the alternative where `h2a` itself is the single binary. They are compatible: a unified
`h2a` simply *becomes* the implementation behind `stp h2a`, and the bare-verb aliases the
federation ships (`stp report` ≡ `stp track report`) are exactly the Tier-1 bare verbs here
(`h2a report`). Decision: do bare verbs live in the `stp` umbrella (federation Option A) **or**
inside a merged `h2a` (this doc)? See open question Q1.

| `stp` form | This proposal |
|---|---|
| `stp <cli> <verb>` (escape hatch) | `h2a <domain> <verb>` (namespace = escape hatch) |
| `stp report` → `stp track report` | `h2a report` (single-owner bare verb) |
| `stp h2a` / `stp track` / `stp remote` / `stp harness` | `h2a` / `h2a track` / `h2a sess`+`h2a job` / `h2a dev` |

---

## 8. Transverse verbs — unified semantics

| Verb | Unified meaning across all domains |
|---|---|
| `ls` | enumerate the live/persisted objects of the (bare=peers) context; `--json` array |
| `status` | current-state snapshot of an entity or the estate; never mutates |
| `report` | a projected, human-shaped roll-up (work, NHI posture) — derived, read-only |
| `find` | resolve one addressable target by name/role/scope (presence-aware) |
| `open`/`close` | bracket a lifecycle: session, negotiation, dev branch |
| `send` | deliver a signed/plain envelope to a target (local inbox or remote URL) |
| `run`/`attach`/`stop`/`resume` | local/remote session lifecycle (one verb set) |
| `wake` | a signed nudge to a stalled/idle peer (drive + relance + wake-request) |
| `delegate` | spawn a detached agent job for a task; returns a job id |
| `decide` | record a decision (track) or answer a job's `decision.requested` |
| `verify` | a gate that returns a neutral pass/fail run (scope, tests, signatures) |
| `record`/`clear` | append / retire a durable marker (drumbeat, journal events) |
| `claim`/`release` | acquire / drop a reversible role (conductor) |
| `attest`/`sign` | emit signed evidence (comprehension, NHI, artifacts) |
| `add`/`revoke` | grant / withdraw a credential or binding (keys, subagents) |
| `watch` (flag) | turn any of the above into a foreground polling loop |

## 9. Five before/after examples

1. **List who is live**
   - before: `remote ls` *and* `h2a sessions` *and* `h2a discover --role CONDUCTOR`
   - after: `h2a ls` (peers) · `h2a find --role CONDUCTOR`
2. **Project work state**
   - before: `track report --wp --format md`
   - after: `h2a report --wp` (md on a TTY, `--json` otherwise)
3. **Spawn + supervise a delegated agent**
   - before: `remote delegate codex "fix X"` → `remote jobs ls` → `remote jobs decide <id> "yes"`
   - after: `h2a delegate codex "fix X"` → `h2a job ls` → `h2a decide <id> "yes"`
4. **Message a peer**
   - before: `h2a inbox put --instance claude:... --json '<env>'` (local) / `h2a remote send --url ...` (remote)
   - after: `h2a send claude:... '<env>'` (transport inferred from the target)
5. **Gate a change before merge**
   - before: `harness verify --category static` + `track scope validate --workspace W`
   - after: `h2a verify` (runs the scope+test gate; `--category` to narrow)

## 10. Open questions (double-consensus before any spec)

- **Q1 — Merge vs federate.** Is `h2a` literally *one binary* absorbing all four (this doc), or
  does it stay `stp h2a` under the federation umbrella with bare verbs at the `stp` layer? Both
  share this grammar; only the composition root differs. (Irreversible-ish; cross-repo.)
- **Q2 — `remote` name clash.** h2a already has `remote serve/send` (the HTTP *bus*) while the
  `remote` *CLI* becomes `sess`/`job`. Proposal renames the h2a transport to `h2a bus`. Confirm.
- **Q3 — Two `block`s.** `h2a block` (peer blockage / EVO-3) vs `h2a track blocker` (work
  dependency). Keep distinct namespaces, or unify under one `block` with `--kind`? (C)
- **Q4 — Two `decide`s / `verify`s / `status`es.** Confirm the bare-default rule (§5) resolves
  them: bare `decide`=track+job, bare `verify`=dev gate, bare `status`=agent inventory; the
  signature/host/work variants stay namespaced. Is the bare default the right "most common"?
- **Q5 — `init` scope.** Should bare `h2a init` seed *all* stores (.h2a + .track + harness
  profile) by default, or stay h2a-only with `--all` to opt in? (Reversible.)
- **Q6 — Namespace count.** 14 namespaces vs Hermes "minimal". Candidates to fold: `mcp`→top
  level, `deploy`→`sess`, `cond`/`drum`→`gov`? Trade learnability of fewer namespaces against
  flatter discoverability.
- **Q7 — `--json` default.** Today h2a emits bare JSON by *default* (machine-first, DEC-034).
  Flipping to human-default-on-TTY is a contract change (DEC-034 freeze). New DEC + major bump?

---

## 11. Réconciliation double consensus (Opus-4-8 + Codex 5.5 xhigh — 2026-06-27)

Verdict des deux pairs = **AMEND** (convergent). Décisions adjugées (pas moyennées) :

### Verbes bare — propriétaires figés, unions dangereuses retirées
- `verify` : **namespace-obligatoire** (pas de bare). `h2a dev verify` (gate), `h2a sysml verify`, `h2a nego comp verify`, `h2a track scope`. Bare `verify` = faux-pass silencieux pour un user track → interdit.
- `block` : **namespace-obligatoire / distinct**. `h2a block` (peer/EVO-3) renommé en `h2a impediment` OU gardé mais JAMAIS confondu avec `h2a track blocker` (dépendance travail). Pas de `--kind` qui enterre la différence de modèle.
- `check` : **non transverse**. `h2a dev check` vs `h2a sess check`.
- `decide` : **scindé**. Bare `h2a decide` = décision track uniquement ; `h2a job decide` = réponse à un job. Pas d'union.
- Bare OK (propriétaire unique stable) : `ls`, `status` (=inventaire agents/sessions), `report` (=état travail), `run`, `attach`, `stop`, `logs`, `wake`, `delegate`, `send`, `find`. Tous les `status`/`decide` spécialistes restent namespacés.

### Sortie machine — pas de flip (Q7 tranché : NON)
Garder **DEC-034 machine-first**. Ajouter `--human` + env `H2A_OUTPUT=json|human`. `--json` reste universel. Aucun flip silencieux TTY (fragile en tmux/ssh/pane capturé). Si un jour human-on-TTY : nouveau DEC + **major bump** + flag/env de compat + période de double sortie.

### `send` — protéger l'invariant addressing (CRITIQUE)
`send` NE DOIT PAS inférer le transport silencieusement depuis la cible. Conserver **resolve-before-send + liveness-gate explicites** (cf. addressing-remediation WP-1/2/3, npm 0.60.0). Résolution canonique + vérification de présence AVANT tout envoi ; `--url` explicite pour le transport distant.

### Contrat de migration/compat — LIVRABLE GATANT (défaut majeur des deux)
Ajouter une **matrice de compat** : `ancienne commande → nouvelle → alias (durée de vie) → contrat de sortie`. Plus : `h2a help map`, `h2a explain <ancienne-commande>`, **alias legacy** (les ~160 noms restent appelables avec warning de dépréciation), **autocomplete/completion**. Sans cette couche la syntaxe n'est pas déployable.

### Questions ouvertes — recos tranchées
- **Q1** : h2a = binaire unique (décision PRINCIPAL B) ; `stp` = umbrella/alias compat déprécié, pas la couche sémantique. (Réserve des pairs sur la vélocité notée, mais B tranche.)
- **Q2** : renommer la CLI `remote`→`sess` ; transport HTTP = `h2a bus` avec **alias legacy `h2a remote`** (dépréciation douce, basse priorité).
- **Q3** : peer-blockage et track-blocker distincts (cf. ci-dessus).
- **Q4** : bare-default sûr seulement pour `ls`/`report`/`decide(track)`/`status(inventaire)` ; `verify`/`block`/`check` namespacés.
- **Q5** : `h2a init` = h2a-core par défaut ; `--all` opt-in pour `.track` + profil dev. Pas de seed silencieux multi-store.
- **Q6** : replier `mcp`→`host` ; **garder `cond`/`drum` séparés** (pas de `gov` abstrait/moins découvrable). ~13 namespaces.
- **Q7** : voir « sortie machine » (NON au flip).

### À ajouter / supprimer
- AJOUTER : `h2a help map`, `h2a explain`, `h2a alias`/`compat`, `completion`, `which` (propriétaire d'un verbe).
- SUPPRIMER/FUSIONNER : `up`→`host upgrade` ; `find`⊆`ls --filter --resolve` (find = ls résolvant) ; `register` non-bare (selon objet : `key add`/`sub register`/`host register`).

**Statut : AMENDÉE par double consensus.** Reste à intégrer dans la spec de reprise + à valider en négociation avec stp + architecte (la syntaxe est un livrable de la reprise, gated par le contrat de migration).
