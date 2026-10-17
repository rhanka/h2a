#!/usr/bin/env node
// Generator for v5 modules mapping (MD + HTML).
// Node port of docs/focus/gen-mapping.py (removed for the zero-Python rule).
// Same data, same layout, same tallies on stderr.
//
// Usage: node docs/focus/gen-mapping.mjs <md_out> <html_out>
// (The .py version wrote to two hardcoded personal absolute paths that do not
// exist in this repo, so outputs are explicit arguments here instead.)
import { writeFileSync } from "node:fs";

const DASH = "—";

// today module labels
const TODAY = {
  hcli: "@sentropic/h2a-cli",
  rcli: "@sentropic/remote-cli",
  trk: "@sentropic/track",
  harn: "@sentropic/harness",
  dsg: "@sentropic/design-system-skills",
  gfy: "graphify",
  ast: "@sentropic/agent-stats",
};
// tomorrow lib labels — SIMPLIFIÉ (décision Fabien): 3 packages h2a possède
// (@sentropic/h2a = core ; @sentropic/h2a-cli ; @sentropic/track) + libs existantes consommées.
// loop/agent/runtime/identity = MODULES internes, PAS des packages séparés.
const TOM = {
  core: "@sentropic/h2a", // le core existant (coordination + loop + identity + gouvernance = modules)
  loop: "@sentropic/h2a", // module interne du core (pas un package)
  agent: "@sentropic/h2a-cli", // agent natif + lancement hosts = dans la CLI
  rt: "@sentropic/h2a-cli", // remote mergé dans h2a-cli (consomme les libs runtime/k8s existantes)
  id: "@sentropic/h2a", // identité/auth/keys/NHI = module interne du core
  trk: "@sentropic/track",
  harn: "@sentropic/harness",
  hcli: "@sentropic/h2a-cli",
  add: "additif",
  gw: "@sentropic/llm-gateway", // lib existante consommée
  mesh: "@sentropic/llm-mesh", // lib existante consommée
};

function is_migration(today_key, tom_key) {
  // additive packages keep their own package -> no migration
  if (tom_key === "add") return false;
  // migration = le LABEL de package change (aujourd'hui != demain)
  return (TODAY[today_key] ?? today_key) !== (TOM[tom_key] ?? tom_key);
}

// Row: (old_cli, plumb, plugin, new_cli, today_key, tom_key, hermes, open, desc, val)
// Trailing options object carries { desc, val }; herm/opn stay positional as in the .py calls.
function R(old, plumb, plugin, nw, tkey, nkey, ...rest) {
  const opts = rest[rest.length - 1];
  let herm = DASH;
  let opn = false;
  if (rest.length === 3) {
    herm = rest[0];
    opn = rest[1] === true;
  } else if (rest.length === 2) {
    if (typeof rest[0] === "boolean") opn = rest[0];
    else herm = rest[0];
  }
  const desc = opts.desc ?? "";
  const val = opts.val ?? "";
  // nouveau (plugin): forme MCP/skill cible alignée sur le nouveau verbe.
  // Règle Fabien: tout user-facing NON-plumbing et NON-lancement-de-process a une forme plugin.
  const new_no_args = nw
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("<") && !w.startsWith("--"))
    .join(" ");
  const is_launch = nw.startsWith("h2a run") || nw.startsWith("h2a resume") || nw === "h2a";
  let nplug;
  if (plumb || is_launch || !new_no_args) {
    nplug = DASH;
  } else {
    nplug = `h2a_${new_no_args.replace("h2a", "").split(/\s+/).filter(Boolean).join("_")}`;
  }
  return { old, plumb, plugin, new: nw, nplug, tkey, nkey, herm, opn, desc, val };
}

// Statut de validation Fabien, ligne à ligne (lecture de ses retours ; override possible via val=)
function row_status(r, name) {
  if (r.val) return r.val;
  if (r.opn) return "open"; // à trancher
  const o = r.old.toLowerCase();
  const n = r.new.toLowerCase();
  // corrigé ce round (touché par un retour explicite de Fabien)
  if (
    o.includes("host") ||
    o.startsWith("h2a subagent") ||
    o.includes("agent stats") ||
    o.includes("mesh") ||
    n.includes("--subagent") ||
    n.includes("--target") ||
    n.includes("--parent") ||
    n === "h2a" ||
    n.includes("hermes") ||
    o.startsWith("remote run") ||
    o.startsWith("remote resume") ||
    o.startsWith("h2a loop") ||
    o.includes("drumbeat") ||
    o.startsWith("h2a drive") ||
    o.startsWith("h2a org") ||
    o.startsWith("h2a coach") ||
    n.startsWith("h2a run") ||
    n.startsWith("h2a resume") ||
    n.startsWith("h2a stats") ||
    n.startsWith("h2a auth") ||
    n.startsWith("h2a config") ||
    n.startsWith("h2a plugin") ||
    n.startsWith("h2a workspace") ||
    n.startsWith("h2a sync") ||
    n.startsWith("h2a migrate") ||
    n.startsWith("h2a connect") ||
    n.startsWith("h2a disconnect") ||
    n.startsWith("h2a setup")
  ) {
    return "fix";
  }
  // validé explicitement (ok pour track / dev / knowledge / design)
  if (name === "Track" || n.startsWith("h2a dev") || n.startsWith("h2a knowledge") || n.startsWith("h2a design")) {
    return "ok";
  }
  return "none"; // sans retour à date
}

const STATUS_LABEL = { ok: "✅ validé", fix: "🔧 corrigé", open: "🔴 à trancher", none: "⚪ sans retour"};

const HARN_PLUG = "claude: harness / codex: /cmd";

// ---------------- COORDINATE (81) ----------------
const coordinate = [
    R("h2a discover", false, "h2a_discover_instances · /h2a discover", "h2a find", "hcli","core", { desc: "résout/localise un pair sur le bus"}),
    R("h2a subagent register", false, DASH, "h2a run <cli> --parent <instance>", "hcli","core", { desc: "enregistre un sous-agent délégué"}),
    R("h2a subagent list", false, DASH, "h2a ls --subagents", "hcli","core", { desc: "liste les sous-agents"}),
    R("h2a subagent route", false, DASH, "h2a route --target <subagent>", "hcli","core", { desc: "route un message vers un sous-agent"}),
    R("h2a subagent inbox", false, DASH, "h2a inbox --subagent <id>", "hcli","core", { desc: "lit l'inbox d'un sous-agent"}),
    R("h2a subagent audit", false, DASH, "h2a audit --target <subagent>", "hcli","core", { desc: "audite l'activité d'un sous-agent"}),
    R("h2a subagent revoke", false, DASH, "h2a revoke --target <subagent>", "hcli","core", { desc: "révoque un sous-agent"}),
    R("h2a negotiate open", false, "h2a_open_negotiation", "h2a nego open", "hcli","core", { desc: "ouvre une négociation signée"}),
    R("h2a negotiate status", false, DASH, "h2a nego status", "hcli","core", { desc: "état d'une négociation"}),
    R("h2a negotiate event", false, "h2a_append_journal", "h2a nego event", "hcli","core", { desc: "journalise un événement de négociation"}),
    R("h2a negotiate offer", false, "h2a_offer", "h2a nego offer", "hcli","core", { desc: "émet une offre"}),
    R("h2a negotiate counter", false, "h2a_counteroffer", "h2a nego counter", "hcli","core", { desc: "émet une contre-offre"}),
    R("h2a negotiate sign", false, "h2a_sign", "h2a nego sign", "hcli","core", { desc: "signe un accord"}),
    R("h2a negotiate stabilize", false, "h2a_stabilize", "h2a nego stabilize", "hcli","core", { desc: "stabilise et fige l'accord"}),
    R("h2a negotiate journal", false, DASH, "h2a nego ls", "hcli","core", { desc: "liste le journal de négociation"}),
    R("h2a declare-interest", false, "h2a_declare_conflit_interet", "h2a nego interest", "hcli","core", { desc: "déclare un conflit d'intérêt"}),
    R("h2a conflict-posture", false, "h2a_conflict_posture", "h2a nego conflict", "hcli","core", { desc: "définit la posture de conflit"}),
    R("h2a dossier", false, DASH, "h2a nego dossier", "hcli","core", { desc: "produit le dossier de négociation"}),
    R("h2a confiance", false, DASH, "h2a nego trust", "hcli","core", { desc: "évalue la confiance d'un pair"}),
    R("h2a attest-comprehension", false, "h2a_attest_comprehension", "h2a nego attest", "hcli","core", { desc: "atteste la compréhension partagée"}),
    R("h2a comprehension list", false, DASH, "h2a nego comp ls", "hcli","core", { desc: "liste les attestations de compréhension"}),
    R("h2a comprehension verify", false, DASH, "h2a nego comp verify", "hcli","core", { desc: "vérifie une attestation de compréhension"}),
    R("h2a inbox put", false, "h2a_inbox {put} · /h2a send", "h2a send", "hcli","core", { desc: "envoie un message à un pair"}),
    R("h2a inbox read", false, "h2a_inbox {read} · /h2a receive", "h2a inbox", "hcli","core", { desc: "lit les messages reçus"}),
    R("h2a inbox pop", false, "h2a_inbox {pop}", "h2a inbox pop", "hcli","core", { desc: "retire le prochain message"}),
    R("h2a outbox put", false, DASH, "h2a msg out send", "hcli","core", { desc: "dépose un message sortant"}),
    R("h2a outbox read", false, DASH, "h2a msg out ls", "hcli","core", { desc: "liste les messages sortants"}),
    R("h2a remote serve", true, DASH, "h2a serve", "hcli","rt", { desc: "sert le bus aux pairs distants"}),
    R("h2a sysml verify", true, DASH, "h2a sysml verify", "hcli","core", { desc: "vérifie le modèle SysML"}),
    R("h2a status", false, "/h2a status", "h2a status", "hcli","core", { desc: "état de l'instance locale"}),
    R("h2a sessions", false, "h2a_discover_sessions", "h2a ls", "hcli","core", { desc: "liste hôtes et sessions"}),
    R("h2a org validate", false, DASH, "h2a org validate", "hcli","core", { desc: "valide la structure d'organisation"}),
    R("h2a org show", false, DASH, "h2a org show", "hcli","core", { desc: "affiche l'organisation"}),
    R("h2a org diff", false, DASH, "h2a org diff", "hcli","core", { desc: "compare les versions d'organisation"}),
    R("h2a org provision", false, DASH, "h2a org apply", "hcli","core", { desc: "applique l'organisation cible"}),
    R("h2a coach propose", false, DASH, "h2a org propose", "hcli","core", { desc: "propose une évolution d'organisation"}),
    R("h2a coach ratify", false, DASH, "h2a org ratify", "hcli","core", { desc: "ratifie une proposition d'organisation"}),
    R("h2a blockage raise", false, "h2a_blockage_raise", "h2a block raise", "hcli","core", { desc: "signale un blocage"}),
    R("h2a blockage list", false, "h2a_blockage_list", "h2a block ls", "hcli","core", { desc: "liste les blocages"}),
    R("h2a blockage resolve", false, "h2a_blockage_resolve", "h2a block resolve", "hcli","core", { desc: "résout un blocage"}),
    R("h2a keepalive", true, DASH, "h2a keepalive", "hcli","rt", { desc: "maintient la présence active"}),
    R("h2a thread", false, DASH, "h2a msg thread", "hcli","core", { desc: "affiche un fil de messages"}),
    R("h2a conductor", false, "h2a_conductor · /h2a conductor", "h2a cond", "hcli","core", { desc: "affiche et pilote le conducteur"}),
    R("h2a conductor claim", false, "h2a_conductor_claim", "h2a cond claim", "hcli","core", { desc: "revendique le rôle de conducteur"}),
    R("h2a conductor release", false, "h2a_conductor_release", "h2a cond release", "hcli","core", { desc: "libère le rôle de conducteur"}),
    R("h2a conductor-launch-check", true, "h2a_conductor_launch_check", "h2a cond launch --check", "hcli","core", { desc: "vérifie avant lancement conducteur"}),
    R("h2a conductor-launch", false, "h2a_conductor_launch", "h2a cond launch --confirm", "hcli","core", { desc: "lance un agent via le conducteur"}),
    R("remote ls [url]", false, DASH, "h2a ls", "rcli","core", { desc: "liste les agents distants"}),
    R("remote agents ls", false, DASH, "h2a ls / h2a find", "rcli","core", { desc: "liste et résout les agents", val: "ok"}),
    R("remote agents inspect", false, DASH, "h2a inspect", "rcli","core", { desc: "inspecte un agent distant"}),
    R("remote conductor-launch", false, DASH, "h2a cond launch", "rcli","core", { desc: "lance un agent à distance"}),
    R("remote status", false, DASH, "h2a status", "rcli","core", { desc: "état du host distant"}),
    R("h2a loop create", false, DASH, "h2a loop create", "hcli","loop", { desc: "crée une boucle objectif"}),
    R("h2a loop list", false, DASH, "h2a loop ls", "hcli","loop", { desc: "liste les boucles"}),
    R("h2a loop status", false, DASH, "h2a loop status", "hcli","loop", { desc: "état d'une boucle"}),
    R("h2a loop agents", false, DASH, "h2a loop agents", "hcli","loop", { desc: "liste les agents d'une boucle"}),
    R("h2a loop attach", false, DASH, "h2a loop attach", "hcli","loop", { desc: "attache un agent à une boucle"}),
    R("h2a loop logs", false, DASH, "h2a loop logs", "hcli","loop", { desc: "journaux d'une boucle"}),
    R("h2a loop tick", false, DASH, "h2a loop tick", "hcli","loop", { desc: "avance la boucle d'un pas"}),
    R("h2a loop watch", false, DASH, "h2a loop watch", "hcli","loop", { desc: "surveille une boucle en continu"}),
    R("h2a drumbeat record", false, DASH, "h2a drum record", "hcli","rt", { desc: "enregistre un battement d'activité"}),
    R("h2a drumbeat scan", false, DASH, "h2a drum ls", "hcli","rt", { desc: "liste les battements détectés"}),
    R("h2a drumbeat clear", false, DASH, "h2a drum clear", "hcli","rt", { desc: "efface les battements"}),
    R("h2a drumbeat escalations", false, DASH, "h2a drum escalations", "hcli","rt", { desc: "liste les escalades du drumbeat"}),
    R("h2a drumbeat relance-inbox", false, DASH, "h2a drum relance", "hcli","rt", { desc: "relance les inbox en attente"}),
    R("h2a drumbeat watch", true, DASH, "h2a drum watch", "hcli","rt", { desc: "daemon de surveillance d'activité"}),
    R("h2a remote send", true, DASH, "h2a relay send", "hcli","rt", { desc: "relaie un message via transport distant"}),
    R("h2a drive", false, "h2a_wake", "h2a wake", "hcli","rt", { desc: "réveille/pingue un agent via tmux (écrit [h2a from=…] signé)", val: "fix"}),
    R("h2a drive receive", true, DASH, "h2a wake verify", "hcli","rt", { desc: "reçoit et vérifie un réveil"}),
    R("h2a drive serve", true, DASH, "h2a wake serve", "hcli","rt", { desc: "daemon de service de réveil"}),
    R("remote wake-request", true, DASH, "h2a wake", "rcli","rt", { desc: "demande un réveil à distance"}),
    R("remote relaunch [filter]", true, DASH, "h2a wake --relaunch", "rcli","rt", { desc: "relance les agents morts"}),
    R("remote resume-throttled [f]", true, DASH, "h2a wake --throttled", "rcli","rt", { desc: "reprend les agents throttlés"}),
    R("remote h2a ping <instance>", false, "h2a_ping", "h2a ping <instance>", "rcli","core", { desc: "ping/notifie un agent (envelope h2a.ping ; --bridge pour pousser à distance)", val: "fix"}),
    R("remote h2a bridge [id]", true, DASH, "h2a relay bridge", "rcli","rt", { desc: "ouvre un pont vers un agent"}),
    R("track decision new", false, "claude: present-decision / codex: /decision", "h2a decision new", "trk","trk", { desc: "ouvre une décision à tracer"}),
    R("track decision outcome <id>", false, "present-decision / /decision", "h2a decision outcome", "trk","trk", { desc: "enregistre l'issue d'une décision"}),
    R("track decision dossier <id>", false, "present-decision / /decision · track_canevas (read)", "h2a decision dossier", "trk","trk", { desc: "produit le dossier de décision"}),
    R("track decision disposition <id>", false, "present-decision / /decision", "h2a decision disposition", "trk","trk", { desc: "fixe la disposition d'une décision"}),
    R("track decision add-artifact <id>", false, "present-decision / /decision", "h2a decision add-artifact", "trk","trk", { desc: "attache un artefact à la décision"}),
    R("track focus <decision-id>", false, DASH, "h2a track focus", "trk","trk", { desc: "met une décision au focus"}),
];
// ---------------- RUN (49 rows in data; header comment of the .py said 46) ----------------
const run = [
    R("remote run <profile> [path]", false, DASH, "h2a run <profile> [path]", "rcli","agent", "hermes run --agent <profile>", { desc: "lance un profil (run implicite) ; pin --gw/--no-gw"}),
    R("remote resume [slug]", false, DASH, "h2a resume", "rcli","agent", "hermes run --resume", { desc: "reprend la dernière session ; gestion de profil"}),
    R("remote codex", false, DASH, "h2a run codex", "rcli","agent", "hermes run --agent codex", { desc: "lance un agent Codex"}),
    R("remote claude (claude-code)", false, DASH, "h2a run claude", "rcli","agent", "hermes run --agent claude", { desc: "lance un agent Claude Code"}),
    R("remote agy (antigravity)", false, DASH, "h2a run agy", "rcli","agent", "hermes run --agent agy", { desc: "lance un agent Antigravity"}),
    R("remote gemini (gemini-cli)", false, DASH, "h2a run gemini", "rcli","agent", "hermes run --agent gemini", { desc: "lance un agent Gemini"}),
    R("remote mistral (mistralcli)", false, DASH, "h2a run mistral", "rcli","agent", "hermes run --agent mistral", { desc: "lance un agent Mistral"}),
    R("remote opencode", false, DASH, "h2a run opencode", "rcli","agent", "hermes run --agent opencode", { desc: "lance un agent OpenCode"}),
    R("(nouveau) agent h2a natif", false, "h2a (skill)", "h2a", "hcli","agent", DASH, { desc: "ouvre une session de l'agent h2a natif sur le cwd (interactif)", val: "fix"}),
    R("(nouveau) agent Hermes", false, DASH, "h2a run hermes", "rcli","agent", "hermes run", { desc: "lance un agent Hermes headless (NousResearch)", val: "fix"}),
    R("(nouveau) logs agent", false, DASH, "h2a logs <instance>", "rcli","agent", "hermes logs", { desc: "journaux d'un agent lancé (cycle de vie)", val: "fix"}),
    R("remote rename <id> <name>", false, DASH, "h2a rename", "rcli","agent", { desc: "renomme un agent"}),
    R("remote shell", false, DASH, "h2a shell run", "rcli","agent", { desc: "ouvre un shell sur le host"}),
    R("remote attach <url|id>", false, DASH, "h2a attach", "rcli","agent", { desc: "attache à une session agent"}),
    R("remote stop <url|id>", false, DASH, "h2a stop", "rcli","agent", { desc: "arrête un agent"}),
    R("remote delegate <type> <task>", false, DASH, "h2a delegate <profile>", "rcli","agent", "hermes run", { desc: "délègue une tâche à un agent"}),
    R("remote jobs ls", false, DASH, "h2a job ls", "rcli","rt", "hermes job ls", { desc: "liste les jobs"}),
    R("remote jobs status <id>", false, DASH, "h2a job status", "rcli","rt", "hermes job status", { desc: "état d'un job"}),
    R("remote jobs attach <id>", false, DASH, "h2a job attach", "rcli","rt", { desc: "attache à un job"}),
    R("remote jobs logs <id>", false, DASH, "h2a job logs", "rcli","rt", "hermes job logs", { desc: "journaux d'un job"}),
    R("remote jobs decisions", false, DASH, "h2a job decisions", "rcli","rt", { desc: "liste les décisions de jobs en attente"}),
    R("remote jobs decide <id> <a>", false, DASH, "h2a job decide", "rcli","rt", { desc: "tranche une décision de job"}),
    R("remote jobs conduct", false, DASH, "h2a job conduct", "rcli","rt", { desc: "conduit les jobs en cours"}),
    R("remote connect", false, DASH, "h2a connect --tunnel", "rcli","rt", { desc: "connecte un host via tunnel"}),
    R("remote disconnect", false, DASH, "h2a disconnect", "rcli","hcli", { desc: "déconnecte un host"}),
    R("remote check <profile> (smoke)", false, DASH, "h2a check --host / h2a <profile> check", "rcli","agent", DASH, true, { desc: "smoke-test d'un profil ou host"}),
    R("remote workspace link", false, DASH, "h2a workspace link", "rcli","rt", { desc: "lie un workspace local au host"}),
    R("remote workspace list [url]", false, DASH, "h2a workspace ls", "rcli","rt", { desc: "liste les workspaces"}),
    R("remote workspace status", false, DASH, "h2a workspace status", "rcli","rt", { desc: "état des workspaces"}),
    R("remote workspace push", false, DASH, "h2a workspace push", "rcli","rt", { desc: "pousse le workspace vers le host"}),
    R("remote workspace pull", false, DASH, "h2a workspace pull", "rcli","rt", { desc: "récupère le workspace du host"}),
    R("remote workspace rm [id]", false, DASH, "h2a workspace rm", "rcli","rt", { desc: "supprime un workspace"}),
    R("remote workspace gc", false, DASH, "h2a workspace gc", "rcli","rt", { desc: "nettoie les workspaces orphelins"}),
    R("remote diff [id]", false, DASH, "h2a diff", "rcli","rt", { desc: "diff workspace local et distant"}),
    R("remote sync <id>", false, DASH, "h2a sync", "rcli","rt", { desc: "synchronise un workspace"}),
    R("remote sync-status", false, DASH, "h2a sync-status", "rcli","rt", { desc: "état de synchronisation"}),
    R("remote sync-files", false, DASH, "h2a sync-files", "rcli","rt", { desc: "synchronise les fichiers"}),
    R("remote forward <id> <port>", false, DASH, "h2a forward", "rcli","rt", { desc: "redirige un port du pod"}),
    R("remote browser open <id>", false, DASH, "h2a browser open", "rcli","rt", { desc: "ouvre le navigateur du host"}),
    R("remote migrate forward <p>", false, DASH, "h2a migrate forward", "rcli","rt", { desc: "migre la session vers l'avant"}),
    R("remote migrate ls", false, DASH, "h2a migrate ls", "rcli","rt", { desc: "liste les migrations"}),
    R("remote migrate pick", false, DASH, "h2a migrate pick", "rcli","rt", { desc: "choisit une cible de migration"}),
    R("remote migrate back", false, DASH, "h2a migrate back", "rcli","rt", { desc: "revient à la session précédente"}),
    R("remote migrate to-remote [p]", false, DASH, "h2a migrate to-remote", "rcli","rt", { desc: "migre la session vers le distant"}),
    R("remote migrate to-local", false, DASH, "h2a migrate to-local", "rcli","rt", { desc: "rapatrie la session en local"}),
    R("remote restore [group]", false, DASH, "h2a restore", "rcli","rt", { desc: "restaure des sessions"}),
    R("remote layout show", false, DASH, "h2a layout show", "rcli","rt", { desc: "affiche la disposition tmux"}),
    R("remote lineage suspend <id>", true, DASH, "h2a lineage suspend", "rcli","rt", { desc: "suspend une lignée d'agent"}),
    R("remote lineage resume <id>", true, DASH, "h2a lineage resume", "rcli","rt", { desc: "reprend une lignée d'agent"}),
];
// ---------------- TRACK (28: 27 track + agent-stats web) ----------------
const track = [
    R("track init", false, DASH, "h2a track init", "trk","trk", { desc: "initialise le suivi du dépôt"}),
    R("track item new", false, DASH, "h2a track item new", "trk","trk", { desc: "crée un item de travail"}),
    R("track item reparent <id>", false, DASH, "h2a track item reparent", "trk","trk", { desc: "rattache un item à un parent"}),
    R("track item scope-declare <id>", false, DASH, "h2a track item scope-declare", "trk","trk", { desc: "déclare le périmètre d'un item"}),
    R("track item spec-amend <id>", false, DASH, "h2a track item spec-amend", "trk","trk", { desc: "amende la spec d'un item"}),
    R("track item spec <id>", false, DASH, "h2a track item spec", "trk","trk", { desc: "spécifie un item"}),
    R("track item realize <id>", false, DASH, "h2a track item realize", "trk","trk", { desc: "marque un item réalisé"}),
    R("track item show <id>", false, DASH, "h2a track item show", "trk","trk", { desc: "affiche un item"}),
    R("track item ls", false, DASH, "h2a track item ls", "trk","trk", { desc: "liste les items"}),
    R("track blocker raise", false, DASH, "h2a track blocker raise", "trk","trk", { desc: "signale un bloqueur"}),
    R("track blocker resolve <id>", false, DASH, "h2a track blocker resolve", "trk","trk", { desc: "résout un bloqueur"}),
    R("track blocker resolve-external", false, DASH, "h2a track blocker resolve-external", "trk","trk", { desc: "résout un bloqueur externe"}),
    R("track accept criterion <id>", false, DASH, "h2a track accept criterion", "trk","trk", { desc: "ajoute un critère d'acceptation"}),
    R("track accept link <id>", false, DASH, "h2a track accept link", "trk","trk", { desc: "lie une preuve d'acceptation"}),
    R("track accept run <evId>", false, DASH, "h2a track accept run", "trk","trk", { desc: "exécute une vérification d'acceptation"}),
    R("track accept waive <id>", false, DASH, "h2a track accept waive", "trk","trk", { desc: "déroge à un critère"}),
    R("track consolidate", false, DASH, "h2a track consolidate", "trk","trk", { desc: "consolide l'état du suivi"}),
    R("track priority assess <id>", false, DASH, "h2a track priority assess", "trk","trk", { desc: "évalue la priorité d'un item"}),
    R("track report", false, "track_report (read)", "h2a report", "trk","trk", { desc: "rapport d'état du travail"}),
    R("track query", false, "track_query (read)", "h2a track query", "trk","trk", { desc: "interroge le graphe de suivi"}),
    R("track export-graph", false, DASH, "h2a track export", "trk","trk", { desc: "exporte le graphe de suivi"}),
    R("track workspace-activity", false, "track_workspace_activity (read)", "h2a track activity", "trk","trk", { desc: "activité récente du workspace"}),
    R("track scope validate", false, "track_scope_validate (read)", "h2a track scope validate", "trk","trk", { desc: "valide le périmètre déclaré"}),
    R("track validate", false, "track_validate (read)", "h2a track validate", "trk","trk", { desc: "valide la cohérence du suivi"}),
    R("track branch import <BRANCH.md>", false, DASH, "h2a track import", "trk","trk", { desc: "importe un BRANCH.md"}),
    R("track ingest <file.jsonl>", false, DASH, "h2a track ingest", "trk","trk", { desc: "ingère des événements de suivi"}),
    R("track workspace-id", false, DASH, "h2a track workspace-id", "trk","trk", { desc: "affiche l'identifiant du workspace"}),
    R("agent-stats web (estate-wide)", false, DASH, "h2a stats --all", "ast","add", { desc: "mesure agrégée de tout le parc"}),
];
// ---------------- ADMIN (64) ----------------
const admin = [
    R("h2a register", false, "h2a_register_instance", "h2a register", "hcli","id", { desc: "enregistre l'instance sur le bus"}),
    R("h2a mcp-serve", true, DASH, "h2a mcp serve", "hcli","rt", { desc: "sert l'API MCP"}),
    R("h2a keys generate", false, DASH, "h2a key gen", "hcli","id", { desc: "génère une paire de clés"}),
    R("h2a keys add", false, DASH, "h2a key add", "hcli","id", { desc: "ajoute une clé"}),
    R("h2a keys list", false, DASH, "h2a key ls", "hcli","id", { desc: "liste les clés"}),
    R("h2a keys revoke", false, DASH, "h2a key revoke", "hcli","id", { desc: "révoque une clé"}),
    R("h2a nhi report", false, "h2a_nhi_report", "h2a nhi report", "hcli","id", { desc: "rapport des identités non-humaines"}),
    R("h2a nhi inventory", false, "h2a_nhi_inventory", "h2a nhi ls", "hcli","id", { desc: "inventaire des identités NHI"}),
    R("h2a nhi export", false, "h2a_nhi_export", "h2a nhi export", "hcli","id", { desc: "exporte l'inventaire NHI"}),
    R("h2a nhi attest", false, "h2a_nhi_attest", "h2a nhi attest", "hcli","id", { desc: "atteste une identité NHI"}),
    R("h2a nhi offboard", false, "h2a_nhi_offboard", "h2a nhi offboard", "hcli","id", { desc: "désenrôle une identité NHI"}),
    R("remote auth status [profile]", false, DASH, "h2a auth status", "rcli","id", { desc: "état d'authentification (--host)"}),
    R("remote auth login <profile>", false, DASH, "h2a auth login", "rcli","id", { desc: "connexion d'un profil (--host)"}),
    R("remote auth push <url|id>", false, DASH, "h2a auth push", "rcli","id", { desc: "pousse l'auth vers un host"}),
    R("remote refresh [url|id]", false, DASH, "h2a auth refresh", "rcli","id", { desc: "rafraîchit les jetons d'auth"}),
    R("remote secrets status [id]", false, DASH, "h2a auth secrets status", "rcli","id", { desc: "état des secrets"}),
    R("remote enroll", true, DASH, "h2a auth enroll", "rcli","id", { desc: "enrôle un host ou agent"}),
    R("h2a --help", false, DASH, "h2a --help / h2a help", "hcli","hcli", { desc: "affiche l'aide"}),
    R("h2a hosts", false, DASH, "h2a ls", "hcli","hcli", { desc: "liste les hôtes connectés"}),
    R("h2a mcp-tools", false, DASH, "h2a mcp tools", "hcli","hcli", { desc: "liste les outils MCP exposés"}),
    R("h2a init", false, DASH, "h2a init", "hcli","hcli", { desc: "initialise la config locale"}),
    R("h2a upgrade", false, DASH, "h2a up", "hcli","hcli", { desc: "met à jour la CLI"}),
    R("h2a host setup", true, DASH, "h2a setup", "hcli","hcli", { desc: "assistant de configuration d'un host"}),
    R("h2a host plugin", true, DASH, "h2a plugin", "hcli","hcli", { desc: "gère les plugins (--host)"}),
    R("h2a host status", false, DASH, "h2a ls", "hcli","hcli", { desc: "statut hôte, colonne de h2a ls"}),
    R("h2a connect", false, "/h2a connect (skill -> h2a_session_open)", "h2a connect", "hcli","hcli", { desc: "ouvre une session de coordination"}),
    R("h2a doctor", false, DASH, "h2a doctor", "hcli","hcli", { desc: "diagnostique l'installation"}),
    R("h2a install-skills", true, DASH, "h2a skills", "hcli","hcli", { desc: "installe les skills (--host)"}),
    R("h2a deploy k8s-sidecar", false, DASH, "h2a deploy sidecar", "hcli","rt", { desc: "déploie le sidecar k8s"}),
    R("h2a deploy k8s-tenant", false, DASH, "h2a deploy tenant", "hcli","rt", { desc: "déploie un tenant k8s"}),
    R("remote install <url>", false, DASH, "h2a install", "rcli","rt", { desc: "installe le runtime sur un host"}),
    R("remote config set <url>", false, DASH, "h2a config set", "rcli","hcli", { desc: "définit l'URL du host"}),
    R("remote config token <v>", false, DASH, "h2a config token", "rcli","hcli", { desc: "définit le jeton du host"}),
    R("remote config target <t>", false, DASH, "h2a config target", "rcli","hcli", { desc: "définit la cible du host"}),
    R("remote config tools <list>", false, DASH, "h2a config tools", "rcli","hcli", { desc: "configure les outils autorisés"}),
    R("remote config tmux-profile", false, DASH, "h2a config tmux-profile", "rcli","hcli", { desc: "configure le profil tmux"}),
    R("remote config clear", false, DASH, "h2a config clear", "rcli","hcli", { desc: "efface la config du host"}),
    R("remote config show", false, DASH, "h2a config show", "rcli","hcli", { desc: "affiche la config"}),
    R("remote config tunnel", false, DASH, "h2a config tunnel", "rcli","hcli", { desc: "configure le tunnel"}),
    R("remote plugin add <pkg>", false, DASH, "h2a plugin add", "rcli","hcli", { desc: "ajoute un plugin au host"}),
    R("remote plugin ls", false, DASH, "h2a plugin ls", "rcli","hcli", { desc: "liste les plugins du host"}),
    R("remote plugin sync", true, DASH, "h2a plugin sync", "rcli","hcli", { desc: "synchronise les plugins"}),
    R("remote plugin sync-skills", true, DASH, "h2a plugin sync-skills", "rcli","hcli", { desc: "synchronise les skills des plugins"}),
    R("track install-skills", true, DASH, "h2a skills --of track", "trk","trk", { desc: "installe les skills track"}),
    R("harness skills install", true, DASH, "h2a skills --of dev", "harn","harn", { desc: "installe les skills dev/harness"}),
    R("h2a store migrate", true, DASH, "h2a store migrate", "hcli","core", { desc: "migre le store local"}),
    R("remote llm-mesh start", false, DASH, "h2a gateway start", "rcli","gw", { desc: "démarre la gateway LLM"}),
    R("remote llm-mesh stop", false, DASH, "h2a gateway stop", "rcli","gw", { desc: "arrête la gateway LLM"}),
    R("remote llm-mesh restart", false, DASH, "h2a gateway restart", "rcli","gw", { desc: "redémarre la gateway LLM"}),
    R("remote llm-mesh status", false, DASH, "h2a gateway status", "rcli","gw", { desc: "état de la gateway LLM"}),
    R("remote llm-mesh logs", false, DASH, "h2a gateway logs", "rcli","gw", { desc: "journaux de la gateway LLM"}),
    R("remote account enroll", false, DASH, "h2a auth account enroll", "rcli","id", { desc: "enrôle un compte LLM"}),
    R("remote account ls", false, DASH, "h2a auth account ls", "rcli","id", { desc: "liste les comptes LLM"}),
    R("remote account rm <id>", false, DASH, "h2a auth account rm", "rcli","id", { desc: "supprime un compte LLM"}),
    R("remote account exhausted <id>", false, DASH, "h2a auth account exhausted", "rcli","id", { desc: "marque un compte épuisé"}),
    R("remote account clear-quota <id>", false, DASH, "h2a auth account clear-quota", "rcli","id", { desc: "réinitialise le quota d'un compte"}),
    R("remote account select", false, DASH, "h2a auth account select", "rcli","id", { desc: "sélectionne un compte actif"}),
    R("remote account log", false, DASH, "h2a auth account log", "rcli","id", { desc: "journal d'usage des comptes"}),
    R("remote account rm-binding <k>", false, DASH, "h2a auth account rm-binding", "rcli","id", { desc: "supprime un binding de compte"}),
    R("remote account bindings", false, DASH, "h2a auth account bindings", "rcli","id", { desc: "liste les bindings de comptes"}),
    R("remote account push-cluster", false, DASH, "h2a auth account push-cluster", "rcli","id", { desc: "pousse les comptes au cluster"}),
    R("remote llm-mesh enroll <prov>", false, DASH, "h2a auth mesh enroll", "rcli","mesh", { desc: "enrôle un fournisseur LLM"}),
    R("remote llm-mesh enable", false, DASH, "h2a auth mesh enable", "rcli","mesh", { desc: "active le mesh LLM"}),
    R("remote llm-mesh disable", false, DASH, "h2a auth mesh disable", "rcli","mesh", { desc: "désactive le mesh LLM"}),
];
// ---------------- EXTEND (36) ----------------
const extend = [
    R("harness check scope", false, HARN_PLUG, "h2a dev check scope", "harn","harn", { desc: "vérifie le périmètre déclaré"}),
    R("harness check branch", false, HARN_PLUG, "h2a dev check branch", "harn","harn", { desc: "vérifie l'état de la branche"}),
    R("harness verify --category", false, HARN_PLUG, "h2a dev verify --category", "harn","harn", { desc: "exécute les vérifications par catégorie"}),
    R("harness audit", false, HARN_PLUG, "h2a dev audit", "harn","harn", { desc: "audite la conformité harness"}),
    R("harness init", false, HARN_PLUG, "h2a dev init", "harn","harn", { desc: "initialise le profil harness"}),
    R("harness brainstorm", false, "claude: harness-brainstorm / codex: /cmd", "h2a dev brainstorm", "harn","harn", { desc: "explore l'intention avant conception"}),
    R("harness plan", false, "claude: harness-plan / codex: /cmd", "h2a dev plan", "harn","harn", { desc: "écrit un plan exécutable"}),
    R("harness test", false, "claude: harness-test / codex: /cmd", "h2a dev test", "harn","harn", { desc: "applique la pyramide de tests"}),
    R("harness debug", false, "claude: harness-debug / codex: /cmd", "h2a dev debug", "harn","harn", { desc: "diagnostic racine d'un bug"}),
    R("harness review", false, "claude: harness-review / codex: /cmd", "h2a dev review", "harn","harn", { desc: "revue par consensus de pairs"}),
    R("harness branch init", false, HARN_PLUG, "h2a dev branch open", "harn","harn", { desc: "ouvre une branche de travail"}),
    R("harness branch close", false, HARN_PLUG, "h2a dev branch close", "harn","harn", { desc: "clôt une branche de travail"}),
    R("harness adopt", false, "claude: harness-adopt / codex: /cmd", "h2a dev adopt", "harn","harn", { desc: "adapte le harness à un dépôt"}),
    R("design audit", false, "claude: sent-tech-design", "h2a design lint", "dsg","add", { desc: "audite le design system"}),
    R("design audit:visual", false, "claude: sent-tech-design", "h2a design lint --visual", "dsg","add", { desc: "audit visuel du design"}),
    R("design audit:parity", false, "claude: sent-tech-design", "h2a design fidelity", "dsg","add", { desc: "vérifie la fidélité au modèle"}),
    R("design check", false, DASH, "h2a design check", "dsg","add", { desc: "contrôle rapide du design"}),
    R("design build", false, DASH, "h2a design build", "dsg","add", { desc: "build le package de thème"}),
    R("design align", false, DASH, "h2a design align", "dsg","add", { desc: "aligne sur les tokens cibles"}),
    R("design polish", false, DASH, "h2a design polish", "dsg","add", { desc: "peaufine le rendu du design"}),
    R("design init", false, DASH, "h2a design init", "dsg","add", { desc: "initialise un package de thème"}),
    R("design init --extract", false, DASH, "h2a design tokens", "dsg","add", { desc: "extrait les tokens de design"}),
    R("ds-theme-clone (skill)", false, "claude: ds-theme-clone", "h2a design theme clone <id>", "dsg","add", { desc: "clone un thème de marque mesuré"}),
    R("embeddable-view (pkg)", false, DASH, "h2a design views", "dsg","add", { desc: "vues design embarquables"}),
    R("graphify . build (--update/deep)", false, "/graphify", "h2a knowledge ingest <path>", "gfy","add", { desc: "ingère une source dans le graphe"}),
    R("graphify query (path/explain)", false, "/graphify", "h2a knowledge query <q>", "gfy","add", { desc: "interroge le graphe de connaissance"}),
    R("graphify serve/watch/clone/merge", false, "/graphify", "h2a knowledge graph", "gfy","add", { desc: "sert et synchronise le graphe"}),
    R("graphify profile / ontology", false, "/graphify", "h2a knowledge ontology", "gfy","add", { desc: "gère l'ontologie du graphe"}),
    R("graphify studio export", false, "/graphify", "h2a knowledge export", "gfy","add", { desc: "exporte le graphe (studio)"}),
    R("graphify agent-stats {sync,..}", false, "/graphify", "h2a knowledge agents", "gfy","add", { desc: "intègre les stats agents au graphe"}),
    R("@sentropic/agent-stats-core (lib)", false, DASH, "consommé par h2a (dep optionnelle)", "ast","add", { desc: "lib de mesure consommée par h2a"}),
    R("agent-stats stats <id>", false, DASH, "h2a stats <id>", "ast","add", { desc: "stats d'un agent"}),
    R("agent-stats report", false, DASH, "h2a stats <id> --report", "ast","add", { desc: "rapport de stats d'un agent"}),
    R("agent-stats anomalies", false, DASH, "h2a stats <id> --anomalies", "ast","add", { desc: "détecte les anomalies d'un agent"}),
    R("agent-stats clean", false, DASH, "h2a stats <id> --clean", "ast","add", { desc: "nettoie les stats"}),
    R("agent-stats analyze", false, DASH, "h2a stats <id> --analyze", "ast","add", { desc: "analyse les stats d'un agent"}),
];

const SECTIONS = [
  ["Coordinate", "#58a6ff", "@sentropic/h2a (core : bus, loop, gouvernance — modules) · @sentropic/track",
    "qui parle / décide / conduit — le bus (coordination PURE)", coordinate],
  ["Run", "#c792ea", "@sentropic/h2a-cli (agent natif + lancement hosts + exec ; consomme les libs runtime/k8s existantes)",
    "lancer / piloter un agent, où qu'il tourne", run],
  ["Track", "#b1bac4", "@sentropic/track (+ additif agent-stats pour la mesure)",
    "l'état / le record du travail", track],
  ["Admin", "#f0883e", "@sentropic/h2a (identité/auth/keys/NHI = module core) · @sentropic/h2a-cli · libs consommées @sentropic/llm-gateway · @sentropic/llm-mesh",
    "identité, auth, clés, NHI, hosts, deploy, MCP, comptes LLM, liveness", admin],
  ["Extend", "#7ee787", "@sentropic/harness · additif (design-system · graphify · agent-stats)",
    "extensions additives (gardent leur package)", extend],
];

// ---- per-CLI tallies ----
const CLI_OF_TODAY = {
  hcli: "h2a-cli", rcli: "remote-cli", trk: "track",
  harn: "harness", dsg: "design-system-skills", gfy: "graphify", ast: "agent-stats",
};
const cli_user = {};
const cli_plumb = {};
let mig_total = 0;
let herm_total = 0;
let open_total = 0;
for (const [, , , , rows] of SECTIONS) {
  for (const r of rows) {
    const cli = CLI_OF_TODAY[r.tkey];
    if (r.plumb) cli_plumb[cli] = (cli_plumb[cli] ?? 0) + 1;
    else cli_user[cli] = (cli_user[cli] ?? 0) + 1;
    if (is_migration(r.tkey, r.nkey)) mig_total += 1;
    if (r.herm !== DASH) herm_total += 1;
    if (r.opn) open_total += 1;
  }
}

const CLI_ORDER = ["h2a-cli", "remote-cli", "track", "harness", "design-system-skills", "graphify", "agent-stats"];
const total_cmds = SECTIONS.reduce((a, s) => a + s[4].length, 0);
const total_plumb = Object.values(cli_plumb).reduce((a, n) => a + n, 0);
const total_user = Object.values(cli_user).reduce((a, n) => a + n, 0);

// plugin-ancien per section
function plugin_count(rows) {
  return rows.filter((r) => r.plugin !== DASH).length;
}

// ===================== MARKDOWN =====================
function md() {
  const o = [];
  o.push("# h2a unified CLI — command mapping v5 MODULES (ancien réel · module aujourd'hui → demain · par finalité)");
  o.push("");
  o.push("**Status: mapping-for-validation v5. Read-only sur toutes les sources.** Re-grounde le « ancien » de "
    + "[v4 exhaustif](2026-06-28-h2a-command-mapping-v4-exhaustif.md) sur ce qui **existe vraiment** "
    + "(le plumbing interne est marqué ⚙, pas compté comme commande user-facing) et **ajoute deux colonnes module** "
    + "(package *aujourd'hui* → lib cible *demain* v1.1). Jumeau HTML : `…/scratchpad/semantic-focus/mapping.html`.");
  o.push("");
  o.push("> **Le « ancien » est le RÉEL, pas du fantasme.** Sources de vérité : "
    + "`packages/h2a-cli/src/cli-contract.ts` (les ~90 verbes dispatchables, dispatch dans `cli.ts`) · "
    + "`packages/remote-cli/src/index.ts` (les `.command(...)`) · `track --help` · skills `~/.claude/skills/harness-*`. "
    + "Le plumbing (transport / daemon / hook / wiring) **reste listé** (il existe) mais marqué ⚙ pour ne pas gonfler le compte « commandes ».");
  o.push("");
  o.push("## Colonnes (8, dans l'ordre demandé)");
  o.push("");
  o.push("`ancien (cli) | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité`");
  o.push("");
  o.push("- **ancien (cli)** — la commande réelle ; préfixe **⚙** = plumbing interne (PAS user-facing).");
  o.push("- **ancien (plugin)** — forme MCP `h2a_*`/`track_*` ou skill actuelle, ou `—` (CLI-only).");
  o.push("- **nouveau (cli)** — la cible alias-court.");
  o.push("- **nouveau (plugin)** — l'outil MCP cible aligné sur le nouveau verbe (`h2a_<verbe>`), ou `—` (CLI-only).");
  o.push("- **module aujourd'hui** — le package qui porte la commande AUJOURD'HUI "
    + "(`@sentropic/h2a-cli` + core `@sentropic/h2a` · `@sentropic/remote-cli` + 7 libs remote · "
    + "`@sentropic/track` · `@sentropic/harness` · `@sentropic/design-system-skills` · `graphify` · `@sentropic/agent-stats`).");
  o.push("- **module demain (SIMPLIFIÉ — décision Fabien)** — seulement 3 packages que h2a possède : "
    + "**`@sentropic/h2a`** (core : coordination + loop + identité = modules internes) · "
    + "**`@sentropic/h2a-cli`** (CLI + agent natif + remote mergé) · **`@sentropic/track`** ; "
    + "+ libs existantes consommées (`@sentropic/llm-gateway` · `@sentropic/llm-mesh`) + additifs. "
    + "**Pas** de packages `loop`/`agent`/`runtime`/`identity` séparés. **gras** = migration (aujourd'hui ≠ demain).");
  o.push("- **hermes** — équivalent NousResearch Hermes ou `—`.");
  o.push("- **finalité** — une des 5 : Coordinate · Run · Track · Admin · Extend.");
  o.push("");
  o.push("## KPI — total RÉEL (pas « 90 commandes »)");
  o.push("");
  o.push(`- **Total mappé : ${total_cmds}** commandes réelles — dont **${total_user} user-facing** + **${total_plumb} plumbing ⚙**.`);
  o.push(`- **Migrations de module (aujourd'hui ≠ demain) : ${mig_total}** · stables : ${total_cmds - mig_total}.`);
  o.push(`- **Équivalent hermes : ${herm_total}** (toutes en Run) · **OPEN : ${open_total}** `
    + `(\`remote agents ls\`, \`remote check\`). \`agent-stats web\` est **résolu** → finalité Track.`);
  o.push("");
  o.push("### User-facing vs plumbing — par CLI (le vrai compte)");
  o.push("");
  o.push("| CLI (package aujourd'hui) | total | user-facing | plumbing ⚙ |");
  o.push("|---|---|---|---|");
  for (const cli of CLI_ORDER) {
    const u = cli_user[cli] ?? 0;
    const p = cli_plumb[cli] ?? 0;
    if (u + p === 0) continue;
    o.push(`| \`${cli}\` | ${u + p} | ${u} | ${p} |`);
  }
  o.push(`| **TOTAL** | **${total_cmds}** | **${total_user}** | **${total_plumb}** |`);
  o.push("");
  o.push("> **Lecture :** `h2a-cli` n'est PAS « 90 commandes user » — c'est "
    + `**${cli_user["h2a-cli"] ?? 0} user-facing + ${cli_plumb["h2a-cli"] ?? 0} plumbing** `
    + "(mcp-serve, host setup/plugin, install-skills, store migrate, drumbeat×6, drive×3, remote serve/send, sysml verify, "
    + "keepalive, conductor-launch-check). De même `remote-cli` = "
    + `${cli_user["remote-cli"] ?? 0} user / ${cli_plumb["remote-cli"] ?? 0} plumbing `
    + "(wake/relaunch/ping/bridge, lineage, enroll, plugin sync).");
  o.push("");

  for (const [name, , , , rows] of SECTIONS) {
    const u = rows.filter((r) => !r.plumb).length;
    const p = rows.filter((r) => r.plumb).length;
    const mig = rows.filter((r) => is_migration(r.tkey, r.nkey)).length;
    const herm = rows.filter((r) => r.herm !== DASH).length;
    const opn = rows.filter((r) => r.opn).length;
    const pl = plugin_count(rows);
    o.push("---");
    o.push("");
    o.push(`## Finalité — ${name} (${rows.length} commandes)`);
    o.push("");
    o.push(`*Concern : ${SECTIONS.find((s) => s[0] === name)[3]}. Libs demain : ${SECTIONS.find((s) => s[0] === name)[2]}.*`);
    o.push("");
    o.push(`**KPI section :** ${rows.length} cmds · user-facing **${u}** / plumbing ⚙ **${p}** · `
      + `migrations module **${mig}** · plugin ancien **${pl}** · hermes **${herm}** · OPEN **${opn}**.`);
    o.push("");
    o.push("| statut | ancien (cli) | description | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité |");
    o.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      const old = (r.plumb ? "⚙ " : "") + r.old;
      const oldCell = r.opn ? `⚠ ${old} **OPEN**` : old;
      const plug = r.plugin !== DASH ? r.plugin : "—";
      const nplug = r.nplug !== DASH ? `\`${r.nplug}\`` : "—";
      const today = TODAY[r.tkey];
      const tom = TOM[r.nkey];
      const tom_cell = is_migration(r.tkey, r.nkey) ? `**${tom}**` : tom;
      const hermCell = r.herm !== DASH ? r.herm : "—";
      const desc = r.desc || "—";
      const st = STATUS_LABEL[row_status(r, name)];
      o.push(`| ${st} | \`${oldCell}\` | ${desc} | ${plug} | \`${r.new}\` | ${nplug} | \`${today}\` | ${tom_cell} | ${hermCell} | ${name} |`);
    }
    o.push("");
  }

  o.push("---");
  o.push("");
  o.push("## Synthèse");
  o.push("");
  o.push(`- **Total réel : ${total_cmds}** = **${total_user} user-facing** + **${total_plumb} plumbing ⚙**.`);
  o.push("- **User-facing vs plumbing par CLI :** "
    + CLI_ORDER.filter((c) => (cli_user[c] ?? 0) + (cli_plumb[c] ?? 0))
      .map((c) => `\`${c}\` ${cli_user[c] ?? 0}u/${cli_plumb[c] ?? 0}p`).join(" · ") + ".");
  o.push(`- **Migrations de module (aujourd'hui ≠ demain) : ${mig_total}** `
    + "(le gros : `h2a-cli` éclaté en h2a-core/identity/runtime/loop ; `remote-cli` éclaté en agent/runtime/identity/llm-*). "
    + `Stables : ${total_cmds - mig_total} (thin CLI \`h2a-cli\`, \`track\`, \`harness\`, additifs).`);
  o.push("- **Par finalité :** " + SECTIONS.map(([n, , , , rows]) => `${n} ${rows.length}`).join(" · ") + ".");
  o.push(`- **hermes : ${herm_total}** · **OPEN : ${open_total}** (\`remote agents ls\`, \`remote check\`).`);
  o.push("");
  o.push("### Récap par finalité");
  o.push("");
  o.push("| Finalité | total | user-facing | plumbing ⚙ | migrations | plugin ancien | hermes | OPEN |");
  o.push("|---|---|---|---|---|---|---|---|");
  for (const [name, , , , rows] of SECTIONS) {
    const u = rows.filter((r) => !r.plumb).length;
    const p = rows.filter((r) => r.plumb).length;
    const mig = rows.filter((r) => is_migration(r.tkey, r.nkey)).length;
    const herm = rows.filter((r) => r.herm !== DASH).length;
    const opn = rows.filter((r) => r.opn).length;
    const pl = plugin_count(rows);
    o.push(`| ${name} | ${rows.length} | ${u} | ${p} | ${mig} | ${pl} | ${herm} | ${opn} |`);
  }
  o.push(`| **TOTAL** | **${total_cmds}** | **${total_user}** | **${total_plumb}** | **${mig_total}** | `
    + `**${SECTIONS.reduce((a, s) => a + plugin_count(s[4]), 0)}** | **${herm_total}** | **${open_total}** |`);
  o.push("");
  o.push("### Chemins de sortie");
  o.push("");
  o.push("- `docs/specs/2026-06-28-h2a-command-mapping-v5-modules.md`");
  o.push("- `…/scratchpad/semantic-focus/mapping.html`");
  o.push("");
  return o.join("\n");
}

// ===================== HTML =====================
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function html_doc() {
  const o = [];
  o.push(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mapping v6 — CLI h2a (ancien réel · cli+plugin · modules simplifiés h2a/h2a-cli/track · 5 finalités)</title>
<style>
:root{
  --bg:#0d1117; --panel:#161b22; --panel2:#1c2230; --line:#2b3240;
  --txt:#e6edf3; --mut:#9aa7b4; --acc:#58a6ff;
  --ok:#3fb950; --warn:#d29922; --warnbg:#231c0e; --bad:#f85149;
  --gray:#6e7681; --graybg:#13161c; --move:#7ee787;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--txt);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
.wrap{max-width:1560px;margin:0 auto;padding:28px 22px 80px}
header.top{display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:22px}
.kick{color:var(--mut);font-size:12px;letter-spacing:.12em;text-transform:uppercase}
h1{margin:2px 0 0;font-size:26px;font-weight:700}
.sub{color:var(--mut);font-size:14px}
.back{font-size:13px;margin-top:4px}
.counters{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 15px;min-width:104px}
.kpi .n{font-size:23px;font-weight:700;font-variant-numeric:tabular-nums}
.kpi .l{font-size:10.5px;color:var(--mut);letter-spacing:.05em;text-transform:uppercase;margin-top:2px}
.kpi.tot .n{color:var(--acc)} .kpi.open .n{color:var(--warn)}
.kpi.user .n{color:#9ec5ff} .kpi.plumb .n{color:var(--gray)}
.kpi.mig .n{color:var(--move)} .kpi.herm .n{color:#7ee787}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:14px}
.panel h4{margin:0 0 10px;font-size:13px;color:var(--acc);letter-spacing:.04em;text-transform:uppercase}
.cli-tbl{width:100%;border-collapse:collapse}
.cli-tbl th,.cli-tbl td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);font-size:12.5px}
.cli-tbl th{color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:11px}
.cli-tbl td.num{font-variant-numeric:tabular-nums;text-align:right}
.cli-tbl td.u{color:#9ec5ff} .cli-tbl td.p{color:var(--gray)}
.cli-tbl tr.tot td{border-top:2px solid var(--line);font-weight:700}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0 4px;font-size:12px;align-items:center}
.legend .lab{color:var(--mut)}
.legend .swatch{display:inline-block;width:11px;height:11px;border-radius:3px;vertical-align:-1px;margin-right:5px}
h2{font-size:20px;margin:40px 0 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
h2 .dot{width:12px;height:12px;border-radius:50%}
h2 .cnt{color:var(--mut);font-weight:400;font-size:14px}
.finlibs{color:var(--mut);font-size:12.5px;margin:0 0 4px}
.seckpi{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 2px}
.seckpi .sk{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:4px 10px;font-size:11.5px;color:var(--mut)}
.seckpi .sk b{color:var(--txt);font-variant-numeric:tabular-nums}
.seckpi .sk.plumb b{color:var(--gray)} .seckpi .sk.mig b{color:var(--move)} .seckpi .sk.open b{color:var(--warn)}
p.concern{color:var(--mut);font-size:13px;margin:2px 0 6px}
.tblwrap{overflow-x:auto;margin-top:8px}
table.map{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
table.map th,table.map td{text-align:left;padding:7px 11px;border-bottom:1px solid var(--line);font-size:12.5px;vertical-align:top}
table.map th{background:var(--panel2);color:var(--mut);font-weight:600;position:sticky;top:0;z-index:1;white-space:nowrap}
table.map tr:last-child td{border-bottom:none}
tr.open{background:var(--warnbg)} tr.open td{border-bottom-color:#3a2f12}
tr.plumb{background:var(--graybg)}
tr.plumb td:first-child code{color:var(--gray);border-color:#262b33}
.gear{color:var(--gray);font-weight:700;margin-right:3px}
.openbadge{display:inline-block;font-size:9px;font-weight:700;color:var(--warn);border:1px solid #3a2f12;background:#231c0e;border-radius:999px;padding:1px 6px;margin-right:6px;letter-spacing:.04em;vertical-align:1px}
.plumbbadge{display:inline-block;font-size:9px;font-weight:700;color:var(--gray);border:1px solid #262b33;background:#13161c;border-radius:999px;padding:1px 6px;margin-right:6px;letter-spacing:.04em;vertical-align:1px}
code{background:#0b1020;border:1px solid var(--line);border-radius:5px;padding:1px 6px;font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd9e5;white-space:nowrap}
td.plug{color:var(--mut);font-size:11.5px;white-space:normal}
td.mod{font-size:11px;white-space:nowrap}
td.mod code{font-size:10.5px}
td.modnow code{color:#9aa7b4;background:#0b1020}
td.modnext.move code{color:var(--move);border-color:#1f3a26;background:#0e1a12}
td.modnext.stay code{color:var(--mut)}
td.herm{color:#7ee787;font-size:11.5px;white-space:normal}
td.fin{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
.st{white-space:nowrap}
.stbadge{display:inline-block;font-size:10px;font-weight:700;border-radius:999px;padding:2px 7px;letter-spacing:.02em}
.st-ok{color:#3fb950;border:1px solid #1c3a23;background:#0f2316}
.st-fix{color:#d29922;border:1px solid #3a2f12;background:#231c0e}
.st-open{color:#f85149;border:1px solid #4a2222;background:#2a1414}
.st-none{color:#8b949e;border:1px solid #262b33;background:#13161c}
.dash{color:#52606d}
.foot{margin-top:44px;color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:16px}
.foot table{margin-top:10px;border-collapse:collapse}
.foot th,.foot td{font-size:12px;padding:5px 9px;border-bottom:1px solid var(--line);text-align:left}
@media(max-width:1000px){
  td.plug,th.plug,td.mod,th.mod,td.herm,th.herm{display:none}
}
</style>
</head>
<body>
<div class="wrap">`);

  // header
  o.push('  <header class="top">');
  o.push('    <span class="kick">Mapping v6 · CLI h2a · ancien RÉEL (⚙ plumbing) · module aujourd\'hui → demain · 5 finalités</span>');
  o.push(`    <h1>Mapping des ${total_cmds} commandes — réel, plumbing &amp; trajectoire de module</h1>`);
  o.push('    <div class="sub">Chaque commande : <b>ancien (cli)</b> · <b>ancien (plugin)</b> · <b>nouveau (cli)</b> · '
    + '<b>module aujourd\'hui</b> · <b>module demain</b> · <b>hermes</b> · <b>finalité</b>. '
    + '<span class="gear">⚙</span> = plumbing interne (transport / daemon / hook / wiring), PAS user-facing. '
    + '<code style="color:var(--move)">vert</code> en « demain » = migration de module.</div>');
  o.push('    <div class="back"><a href="index.html">← retour à l\'écran focus (index.html)</a></div>');
  o.push('    <div class="counters">');
  o.push(`      <div class="kpi tot"><div class="n">${total_cmds}</div><div class="l">commandes réelles</div></div>`);
  o.push(`      <div class="kpi user"><div class="n">${total_user}</div><div class="l">user-facing</div></div>`);
  o.push(`      <div class="kpi plumb"><div class="n">${total_plumb}</div><div class="l">plumbing ⚙</div></div>`);
  o.push(`      <div class="kpi mig"><div class="n">${mig_total}</div><div class="l">migrations module</div></div>`);
  o.push(`      <div class="kpi herm"><div class="n">${herm_total}</div><div class="l">hermes-equiv</div></div>`);
  o.push(`      <div class="kpi open"><div class="n">${open_total}</div><div class="l">OPEN</div></div>`);
  o.push('    </div>');
  o.push('    <div class="legend"><span class="lab">Finalités :</span>');
  for (const [name, color, , , rows] of SECTIONS) {
    o.push(`      <span><span class="swatch" style="background:${color}"></span>${name} ${rows.length}</span>`);
  }
  o.push('    </div>');
  o.push('  </header>');

  // per-CLI panel
  o.push('  <div class="panel">');
  o.push('    <h4>User-facing vs plumbing — par CLI (le vrai compte, PAS « 90 commandes »)</h4>');
  o.push('    <table class="cli-tbl">');
  o.push('      <thead><tr><th>CLI (package aujourd\'hui)</th><th class="num">total</th><th class="num">user-facing</th><th class="num">plumbing ⚙</th></tr></thead>');
  o.push('      <tbody>');
  for (const cli of CLI_ORDER) {
    const u = cli_user[cli] ?? 0;
    const p = cli_plumb[cli] ?? 0;
    if (u + p === 0) continue;
    o.push(`        <tr><td><code>@sentropic/${cli}</code></td><td class="num">${u + p}</td><td class="num u">${u}</td><td class="num p">${p}</td></tr>`);
  }
  o.push(`        <tr class="tot"><td>TOTAL</td><td class="num">${total_cmds}</td><td class="num u">${total_user}</td><td class="num p">${total_plumb}</td></tr>`);
  o.push('      </tbody>');
  o.push('    </table>');
  o.push('    <div style="margin-top:12px;color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px">'
    + '<b style="color:var(--acc)">Sources « ancien = réel » :</b> '
    + '<code>packages/h2a-cli/src/cli-contract.ts</code> (verbes dispatchables, dispatch <code>cli.ts</code>) · '
    + '<code>packages/remote-cli/src/index.ts</code> (<code>.command()</code>) · <code>track --help</code> · '
    + 'skills <code>~/.claude/skills/harness-*</code>. '
    + 'Le plumbing reste listé (il existe) mais marqué <span class="gear">⚙</span> + grisé.</div>');
  o.push('  </div>');

  // sections
  for (const [name, color, libs, concern, rows] of SECTIONS) {
    const u = rows.filter((r) => !r.plumb).length;
    const p = rows.filter((r) => r.plumb).length;
    const mig = rows.filter((r) => is_migration(r.tkey, r.nkey)).length;
    const herm = rows.filter((r) => r.herm !== DASH).length;
    const opn = rows.filter((r) => r.opn).length;
    const pl = plugin_count(rows);
    const anchor = name.toLowerCase();
    o.push(`  <h2 id="${anchor}"><span class="dot" style="background:${color}"></span>${name} <span class="cnt">— ${rows.length} commandes</span></h2>`);
    o.push(`<div class="finlibs">Libs demain : ${esc(libs)}</div>`);
    o.push(`<p class="concern">${esc(concern)}</p>`);
    o.push(`<div class="seckpi"><span class="sk">total <b>${rows.length}</b></span>`
      + `<span class="sk">user-facing <b>${u}</b></span>`
      + `<span class="sk plumb">plumbing ⚙ <b>${p}</b></span>`
      + `<span class="sk mig">migrations <b>${mig}</b></span>`
      + `<span class="sk">plugin ancien <b>${pl}</b></span>`
      + `<span class="sk">hermes <b>${herm}</b></span>`
      + `<span class="sk open">OPEN <b>${opn}</b></span></div>`);
    o.push('<div class="tblwrap"><table class="map">');
    o.push('<thead><tr><th class="st">statut</th><th>ancien (cli)</th><th class="desc">description</th><th class="plug">ancien (plugin)</th><th>nouveau (cli)</th><th class="plug">nouveau (plugin)</th>'
      + '<th class="mod">module aujourd\'hui</th><th class="mod">module demain</th>'
      + '<th class="herm">hermes</th><th class="fin">finalité</th></tr></thead><tbody>');
    for (const r of rows) {
      const cls = [];
      if (r.opn) cls.push("open");
      if (r.plumb) cls.push("plumb");
      const trcls = cls.length ? ` class="${cls.join(" ")}"` : "";
      // old cell
      let badges = "";
      if (r.opn) badges += '<span class="openbadge">OPEN</span>';
      if (r.plumb) badges += '<span class="plumbbadge">⚙ PLUMBING</span>';
      const gear = r.plumb ? '<span class="gear">⚙</span>' : "";
      const oldcell = `${badges}${gear}<code>${esc(r.old)}</code>`;
      // plugin
      const plug = r.plugin === DASH ? '<span class="dash">—</span>' : esc(r.plugin);
      // modules
      const today = TODAY[r.tkey];
      const tom = TOM[r.nkey];
      const move = is_migration(r.tkey, r.nkey);
      const modnow = `<code>${esc(today)}</code>`;
      const modnext_cls = move ? "move" : "stay";
      const modnext = `<code>${esc(tom)}</code>`;
      // nouveau (plugin)
      const nplug_cell = r.nplug !== DASH ? `<code>${esc(r.nplug)}</code>` : '<span class="dash">—</span>';
      // hermes
      const herm_cell = r.herm !== DASH ? esc(r.herm) : '<span class="dash">—</span>';
      const desc_cell = esc(r.desc || "") || '<span class="dash">—</span>';
      const stv = row_status(r, name);
      const st_cell = `<span class="stbadge st-${stv}">${STATUS_LABEL[stv]}</span>`;
      o.push(`<tr${trcls}><td class="st">${st_cell}</td><td>${oldcell}</td><td class="desc">${desc_cell}</td><td class="plug">${plug}</td>`
        + `<td><code>${esc(r.new)}</code></td>`
        + `<td class="plug">${nplug_cell}</td>`
        + `<td class="mod modnow">${modnow}</td>`
        + `<td class="mod modnext ${modnext_cls}">${modnext}</td>`
        + `<td class="herm">${herm_cell}</td><td class="fin">${name}</td></tr>`);
    }
    o.push('</tbody></table></div>');
  }

  // footer
  const cli_str = CLI_ORDER.filter((c) => (cli_user[c] ?? 0) + (cli_plumb[c] ?? 0))
    .map((c) => `<code>${c}</code> ${cli_user[c] ?? 0}u/${cli_plumb[c] ?? 0}p`).join(" · ");
  o.push('  <div class="foot">');
  o.push(`    <b>Synthèse v5</b> — total réel <b>${total_cmds}</b> = <b>${total_user} user-facing</b> + `
    + `<b style="color:var(--gray)">${total_plumb} plumbing ⚙</b> · migrations module <b style="color:var(--move)">${mig_total}</b> · `
    + `hermes <b>${herm_total}</b> · OPEN <b style="color:var(--warn)">${open_total}</b>. `
    + '<code>agent-stats web</code> résolu → Track.');
  o.push(`    <div style="margin-top:8px">User/plumbing par CLI : ${cli_str}.</div>`);
  o.push('    <table>');
  o.push('      <thead><tr><th>Finalité</th><th>total</th><th>user-facing</th><th>plumbing ⚙</th><th>migrations</th><th>plugin ancien</th><th>hermes</th><th>OPEN</th></tr></thead>');
  o.push('      <tbody>');
  let tot_pl = 0;
  for (const [name, , , , rows] of SECTIONS) {
    const u = rows.filter((r) => !r.plumb).length;
    const p = rows.filter((r) => r.plumb).length;
    const mig = rows.filter((r) => is_migration(r.tkey, r.nkey)).length;
    const herm = rows.filter((r) => r.herm !== DASH).length;
    const opn = rows.filter((r) => r.opn).length;
    const plc = plugin_count(rows);
    tot_pl += plc;
    o.push(`        <tr><td>${name}</td><td>${rows.length}</td><td>${u}</td><td>${p}</td><td>${mig}</td><td>${plc}</td><td>${herm}</td><td>${opn}</td></tr>`);
  }
  o.push(`        <tr style="font-weight:700"><td>TOTAL</td><td>${total_cmds}</td><td>${total_user}</td><td>${total_plumb}</td><td>${mig_total}</td><td>${tot_pl}</td><td>${herm_total}</td><td>${open_total}</td></tr>`);
  o.push('      </tbody>');
  o.push('    </table>');
  o.push('    <div style="margin-top:14px"><b>OPEN (2) :</b> 1· <code>remote agents ls</code> → <code>h2a ls</code> vs <code>h2a find</code> (Coordinate) · '
    + '2· <code>remote check</code>/smoke → <code>h2a check --host</code> vs <code>h2a &lt;profile&gt; check</code> (Run). '
    + '<code>agent-stats web</code> n\'est plus OPEN (→ Track).</div>');
  o.push('    <div style="margin-top:12px">Chemins : <code>docs/specs/2026-06-28-h2a-command-mapping-v5-modules.md</code> · '
    + '<code>…/scratchpad/semantic-focus/mapping.html</code></div>');
  o.push('  </div>');
  o.push('</div>');
  o.push('</body>');
  o.push('</html>');
  return o.join("\n");
}

const [mdOut, htmlOut] = process.argv.slice(2);
if (!mdOut || !htmlOut) {
  process.stderr.write("usage: node docs/focus/gen-mapping.mjs <md_out> <html_out>\n");
  process.exit(2);
}
writeFileSync(mdOut, md());
writeFileSync(htmlOut, html_doc());

// tallies to stderr for verification
process.stderr.write(`TOTAL ${total_cmds} USER ${total_user} PLUMB ${total_plumb} MIG ${mig_total} HERM ${herm_total} OPEN ${open_total}\n`);
for (const c of CLI_ORDER) {
  if ((cli_user[c] ?? 0) + (cli_plumb[c] ?? 0)) process.stderr.write(`  ${c}: ${cli_user[c] ?? 0}u / ${cli_plumb[c] ?? 0}p\n`);
}
for (const [name, , , , rows] of SECTIONS) process.stderr.write(`  section ${name}: ${rows.length}\n`);

