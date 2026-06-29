# h2a — Notes de validation Fabien (à date) + pointeur mapping

Status: VALIDATION LOG (vivant). Date: 2026-06-29. PRINCIPAL: Fabien.
Artefact lié : **mapping HTML** committé `docs/focus/h2a-mapping.html` (jumeau servi sur localhost:8088). Spec modèle : `2026-06-28-h2a-finalites-spec.md`.

## ✅ Validé à date
- **Décision B** : h2a = LA CLI/cadre-org unique de sentropic ; sentropic = libs ; un seul plugin. ADR BR-42 signé (Fabien + architecte) ; **stp déprécié immédiat**.
- **Modèle par finalité (5)** : **Coordinate · Run · Track · Admin · Extend** (anglais ; labels #4 Admin/Govern et #5 Extend/Develop encore à confirmer).
- **3 packages que h2a possède** : `@sentropic/h2a` (core : coordination + objective-loop + identité/auth = **modules internes**), `@sentropic/h2a-cli` (CLI + **agent natif** + **remote mergé**), `@sentropic/track`. **Pas** de packages `loop`/`agent`/`runtime`/`identity` séparés. Libs LLM (gateway/mesh) = existantes consommées. Additifs (harness/design/graphify/agent-stats) gardent leur CLI.
- **agent h2a natif** : `h2a` (bare) ouvre une session chat/code ; `h2a --resume` reprend (au rang de claude/codex).
- **agent-stats** : 1 concern = mesure ; sorties → Track (+ Admin coûts) ; le knowledge-code = graphify.

## 🆕 Rulings de ce round (2026-06-29) — à intégrer au mapping
1. **DESCRIPTION obligatoire** par commande (sans ça, abscons).
2. **`host` = dissous** : pas de namespace `host`. auth/config/plugin/account/mesh/workspace/connect/disconnect deviennent des **verbes GLOBAUX** ; cibler un hôte/session = une **OPTION** (`--host`/`--session`), pas un namespace.
   - `connect` marche sans host → **pas de `host disconnect`** (juste `h2a disconnect`).
   - `workspace`/`sync`/`migrate`/`forward`/`browser`/`diff` : pas sous `host`.
3. **`h2a ls` unifié** : liste à la fois les hôtes connectés (MCP h2a) ET les sessions ; **auth · mcp · type (job/run/…)** sont des **colonnes de statut** de ce `ls`. Pas de `host ls` séparé.
4. **auth globalisée** : `account` = une **option de `auth`** ; `mesh` (comptes LLM) = config/auth, pas un namespace host.
5. **Tout ce qui est utile DOIT avoir une forme plugin (MCP/skill)** pour que les agents l'invoquent : **org, loop, drumbeat, wake, decision, delegate + supervision (jobs)**. Si absent aujourd'hui = à ajouter en « nouveau (plugin) ».
6. **`run`** : l'utilité de `run` est questionnée. **Garder `remote run` / `remote resume`** (réellement utilisés). Le lancement de profil = `h2a <profile>` (run implicite ?). **Ne pas oublier les options** : **pinning gateway (`--gw` / `--no-gw`)** + **gestion des profils**.
7. **delegate + superviser des agents** doivent exister **dans les CLIs/plugins** (un agent peut déléguer/superviser).
8. **design (Extend) incomplet** : exposer TOUTE la surface design (`design check`/audit/tokens/fidelity/theme-clone…) **en plugin** — c'est un raté si `design check` n'est pas dans le plugin.
9. **agent-stats** : enlever « agents » → **`h2a stats`** (voire `h2a analyze`).

## ⏳ Encore ouvert
- Labels : **#4 Admin vs Govern** · **#5 Extend vs Develop**.
- OPEN : `remote check`/`smoke` → `h2a host check`(✗ host) ⇒ `h2a check --host` ou `h2a <profil> check` ?
