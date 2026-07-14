import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function doneDates(eventsPath) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(eventsPath, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "realization.transition" && e.payload?.to === "done" && e.aggregateId && e.at) {
        if (!out[e.aggregateId] || e.at > out[e.aggregateId]) out[e.aggregateId] = e.at;
      }
    } catch {
    }
  }
  return out;
}
function repoRoot() {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}
let cached;
const INSTALLED_TRACK_PACKAGE = "@sentropic/track";
function compatibleTrack(mod, source) {
  const candidate = mod;
  if (typeof candidate.TrackReader !== "function" || typeof candidate.formatWpConductor !== "function") {
    throw new Error(
      `track runtime incompatible (${source}): TrackReader or formatWpConductor is missing.`
    );
  }
  return candidate;
}
async function loadTrack(root) {
  if (cached) return cached;
  const dist = path.join(root, "packages", "track", "dist", "index.js");
  if (existsSync(dist)) {
    cached = compatibleTrack(await import(
      /* @vite-ignore */
      pathToFileURL(dist).href
    ), dist);
    return cached;
  }
  try {
    cached = compatibleTrack(
      await import(
        /* @vite-ignore */
        INSTALLED_TRACK_PACKAGE
      ),
      INSTALLED_TRACK_PACKAGE
    );
    return cached;
  } catch (err) {
    throw new Error(
      `track runtime introuvable: ni build monorepo (${dist}) ni package @sentropic/track installé (${err instanceof Error ? err.message : String(err)}).`
    );
  }
}
function baselineCommit(root) {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "HEAD";
  }
}
function lastReleaseAt(root) {
  try {
    const out = execSync("git log -1 --format=%cI --grep='^release: v'", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
    return out || void 0;
  } catch {
    return void 0;
  }
}
async function loadReport() {
  try {
    const root = repoRoot();
    const eventsPath = process.env.FOCUS_TRACK_EVENTS ?? path.join(root, ".track", "events.jsonl");
    if (!existsSync(eventsPath)) {
      return { ok: false, error: `Journal track introuvable (${eventsPath}).` };
    }
    const track = await loadTrack(root);
    const commit = baselineCommit(root);
    const reader = new track.TrackReader(eventsPath);
    const report = reader.report({ baselineCommit: commit, decisions: true, wpTree: true });
    const viewJson = track.formatWpConductor(report.wpTree ?? [], "json", report.decisions ?? []);
    const view = JSON.parse(viewJson);
    return {
      ok: true,
      repo: path.basename(root),
      baselineCommit: commit,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      buckets: report.buckets,
      view,
      dates: doneDates(eventsPath),
      lastReleaseAt: lastReleaseAt(root)
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
function cleanText(s) {
  return s.replace(/\s+/g, " ").trim();
}
const RANK_BADGE = {
  P1_GATE: { label: "Prioritaire", tone: "critical" },
  P2_ACCEPTANCE: { label: "À revérifier", tone: "warning" },
  P3_IN_PROGRESS: { label: "En cours", tone: "info" },
  P4_TODO_WSJF: { label: "À planifier", tone: "neutral" },
  P5_FALLBACK: { label: "À examiner", tone: "neutral" }
};
function rankBadgeFr(rank) {
  return RANK_BADGE[rank] ?? { label: "À examiner", tone: "neutral" };
}
const GATE_PHRASE = {
  "decision-pending": "En attente d’une décision",
  "engagement-pending": "En attente d’un partenaire (h2a)",
  "external-dependency": "Bloqué par une dépendance externe",
  "linked-dependency": "Bloqué par une autre tâche",
  "manual-blocker": "Bloqué manuellement",
  "spec-not-ready": "À spécifier avant de démarrer",
  "acceptance-failed": "Vérification en échec",
  "acceptance-stale": "Vérification à refaire",
  "priority-missing": "Priorité à définir"
};
function gatePhraseFr(gate) {
  if (!gate)
    return void 0;
  const phrase = GATE_PHRASE[gate.code] ?? "À examiner";
  if (gate.blockedByTitle && gate.blockedByTitle.trim() !== "") {
    return `${phrase} : « ${cleanText(gate.blockedByTitle)} »`;
  }
  return phrase;
}
const STEP_ACTION = {
  "focus-decision": "Instruire le dossier puis trancher",
  "settle-decision": "Trancher la décision",
  "resume-engagement": "Relancer le partenaire puis intégrer le retour",
  "resolve-external-blocker": "Lever le blocage puis reprendre",
  "amend-spec": "Rédiger la spécification",
  "fix-acceptance": "Corriger puis relancer la vérification",
  "rerun-acceptance": "Relancer la vérification sur le commit courant",
  "finish-increment": "Terminer l’incrément en cours",
  "start-increment": "Démarrer l’incrément (preuve + vérification)",
  "prioritize-backlog": "Prioriser le backlog",
  "inspect-fallback": "Inspecter l’état puis décider la suite"
};
function stepActionFr(step) {
  return STEP_ACTION[step] ?? "Inspecter l’état puis décider la suite";
}
function modeActorFr(mode) {
  switch (mode) {
    case "human-decision":
      return "Vous (décision)";
    case "h2a-engagement":
      return "Partenaire h2a";
    case "subagent":
      return "Sous-agent";
    case "local":
      return "Local";
    default:
      return "À affecter";
  }
}
function adviceNatureFr(kind) {
  return kind === "judgment-required" ? "Décision" : "Action";
}
const KIND_FR = {
  feature: "Fonctionnalité",
  bug: "Correctif",
  chore: "Tâche"
};
function kindFr(k) {
  return KIND_FR[k] ?? k;
}
const SUBJECT_MAX = 90;
function subjectOf(d) {
  const t = cleanText(d.target.title ?? d.target.id);
  return t.length > SUBJECT_MAX ? t.slice(0, 88) + "…" : t;
}
function isLaunchable(d) {
  return d.mode === "subagent" || d.mode === "local";
}
function todoRowFr(d) {
  const gate = gatePhraseFr(d.gate);
  return {
    id: d.id,
    subject: subjectOf(d),
    action: stepActionFr(d.step.code),
    actor: modeActorFr(d.mode),
    nature: adviceNatureFr(d.adviceKind),
    badge: rankBadgeFr(d.rank),
    ...gate !== void 0 ? { gate } : {},
    launchable: isLaunchable(d),
    ...d.scope.wpLabel !== void 0 ? { wp: d.scope.wpLabel } : {},
    ...d.facts.fanIn !== void 0 ? { fanIn: d.facts.fanIn } : {},
    ...d.facts.wsjf !== void 0 ? { wsjf: d.facts.wsjf } : {}
  };
}
function precoRowFr(d) {
  const gate = gatePhraseFr(d.gate);
  const lever = d.facts.fanIn !== void 0 && d.facts.fanIn > 0 ? `Débloque ${d.facts.fanIn} autre(s) tâche(s)` : gate ?? (d.mode === "human-decision" ? "Décision en attente" : "Fait avancer le WP concerné");
  return {
    id: d.id,
    title: subjectOf(d),
    why: lever,
    action: stepActionFr(d.step.code),
    actor: modeActorFr(d.mode),
    badge: rankBadgeFr(d.rank),
    launchable: isLaunchable(d)
  };
}
function shortWorkspace(ws) {
  if (!ws)
    return void 0;
  const body = ws.startsWith("ws:") ? ws.slice(3) : ws;
  return body.length > 10 ? `ws:${body.slice(0, 8)}…` : ws;
}
function decisionRowFr(d, repo) {
  const concerns = subjectOf(d);
  const wp = d.scope.wpLabel;
  const why = gatePhraseFr(d.gate) ?? "Décision d’orientation à trancher";
  const ws = shortWorkspace(d.target.workspace);
  return {
    id: d.id,
    question: d.gate?.blockedByTitle ? cleanText(d.gate.blockedByTitle) : concerns,
    concerns,
    action: stepActionFr(d.step.code),
    actor: modeActorFr(d.mode),
    project: repo,
    ...ws !== void 0 ? { workspace: ws } : {},
    ...wp !== void 0 ? { wp } : {},
    summary: `Concerne « ${concerns} »${wp ? ` · ${wp}` : ""} — ${why}.`
  };
}

export { subjectOf as a, cleanText as c, decisionRowFr as d, isLaunchable as i, kindFr as k, loadReport as l, modeActorFr as m, precoRowFr as p, stepActionFr as s, todoRowFr as t };
//# sourceMappingURL=friendly.js-D4fjovnZ.js.map
