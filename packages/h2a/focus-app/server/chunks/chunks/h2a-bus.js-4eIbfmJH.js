import { execFileSync } from 'node:child_process';
import { realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CLI_HOST_PREFIX = /^(claude|codex|gemini|agy|hermes|opencode):/;
const RECEIVING_STATES = /* @__PURE__ */ new Set(["live", "opening", "draining"]);
function labelOfInstance(instance) {
  const parts = String(instance ?? "").split(":");
  return parts.length >= 2 ? parts[1] : "";
}
function liveCliSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).filter((s) => s && RECEIVING_STATES.has(String(s.state))).filter((s) => CLI_HOST_PREFIX.test(s.instance ?? "")).sort((a, b) => String(b.heartbeatAt ?? "").localeCompare(String(a.heartbeatAt ?? "")));
}
function chooseLiveTarget(sessions, ctx) {
  const live = liveCliSessions(sessions);
  const find = (id) => live.find((s) => s.instance === id);
  const pick = (candidates, reason) => ({
    target: candidates[0].instance,
    targetSession: candidates[0],
    targetRoot: candidates[0].root,
    reason,
    live,
    candidates,
    // Several live sessions answer for this repo. We still have to choose one, but the caller MUST be able
    // to say so: quietly picking the freshest heartbeat between two of the human's own sessions is a coin
    // flip, and a coin flip that decides who reads a decision should never be invisible.
    ambiguous: candidates.length > 1
  });
  const none = (reason) => ({
    target: void 0,
    targetSession: void 0,
    targetRoot: void 0,
    reason,
    live,
    candidates: live,
    ambiguous: false
  });
  if (ctx.requested) {
    const found = find(ctx.requested);
    return found ? pick([found], "requested") : none("requested-not-live");
  }
  if (ctx.configured) {
    const found = find(ctx.configured);
    return found ? pick([found], "configured") : none("configured-not-live");
  }
  if (ctx.emitter) {
    const found = find(ctx.emitter);
    if (found) return pick([found], "emitter");
  }
  const repoPaths = new Set((ctx.repoPaths ?? []).filter(Boolean));
  const byWorkspace = live.filter((s) => s.workspace?.path && repoPaths.has(s.workspace.path));
  if (byWorkspace.length > 0) return pick(byWorkspace, "workspace");
  const names = new Set((ctx.nameCandidates ?? []).filter(Boolean));
  const byName = live.filter(
    (s) => names.has(labelOfInstance(s.instance)) || s.name && names.has(s.name)
  );
  if (byName.length > 0) return pick(byName, "name");
  if (live.length === 1) return pick([live[0]], "sole");
  return none("none");
}
function explainNoTarget(resolution, ctx) {
  if (ctx.binMissing) {
    return `Le binaire h2a est introuvable (${ctx.binPath ?? "aucun chemin candidat"}) : le focus ne peut interroger aucun registre, donc aucune remise n'est possible — ce n'est pas « aucune session live ». Pour que ça marche : construisez le CLI (npm run build:h2a à la racine du dépôt) ou pointez FOCUS_H2A_BIN sur un binaire h2a déjà construit.`;
  }
  const roots = ctx.roots?.length ? ` Racines h2a interrogées : ${ctx.roots.join(", ")}.` : "";
  const liveList = resolution.live.map(
    (s) => `${s.instance}${s.workspace?.path ? ` (${s.workspace.path})` : ""}${s.root ? ` [racine ${s.root}]` : ""}`
  );
  const liveSummary = liveList.length ? `Sessions live actuellement visibles (${liveList.length}) : ${liveList.join(", ")}.${roots}` : `Aucune session h2a live n'est visible dans le registre, pour aucun projet.${roots}`;
  if (resolution.reason === "requested-not-live") {
    return `La session choisie (${ctx.requested}) n'est plus live : rien n'a été remis, et surtout rien n'a été redirigé ailleurs sans vous le dire. ${liveSummary} Choisissez une session dans la liste, ou relancez celle-ci.`;
  }
  if (resolution.reason === "configured-not-live") {
    return `FOCUS_H2A_TARGET pointe sur ${ctx.configured}, qui n'est pas live : la cible épinglée par l'opérateur est respectée, jamais contournée en silence. ${liveSummary} Corrigez FOCUS_H2A_TARGET ou relancez cette session.`;
  }
  const paths = ctx.repoPaths.join(", ");
  const names = ctx.nameCandidates.join(", ");
  return `Aucune session h2a live ne correspond à ce dépôt. ${liveSummary} La résolution se fait sur le CHEMIN du checkout (${paths}) puis sur le nom de projet (${names}) — jamais sur le nom du dossier servi, précisément pour qu'un worktree fonctionne. Pour que ça marche, au choix : ouvrez une CLI h2a sur ce dépôt ; servez le focus depuis h2a (il transmet alors FOCUS_EMITTER_INSTANCE) ; épinglez une session avec FOCUS_H2A_TARGET ; ou sélectionnez une session live dans la liste ci-dessus.`;
}
function repoRoot() {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}
function projectName(root = repoRoot()) {
  return path.basename(root);
}
function mainWorktreePath(root) {
  try {
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!out) return void 0;
    return path.basename(out) === ".git" ? path.dirname(out) : void 0;
  } catch {
    return void 0;
  }
}
function repoIdentity(root) {
  const main = mainWorktreePath(root);
  const raw = [root, main].filter((p) => Boolean(p));
  const resolved = raw.flatMap((p) => {
    try {
      return [p, realpathSync(p)];
    } catch {
      return [p];
    }
  });
  const paths = [...new Set(resolved)];
  return { paths, names: [...new Set(paths.map((p) => path.basename(p)))] };
}
function h2aBin(root) {
  const configured = process.env.FOCUS_H2A_BIN?.trim();
  if (configured) return existsSync(configured) ? configured : void 0;
  const candidates = [
    path.join(root, "packages", "h2a", "dist", "bin.js"),
    path.join(root, "node_modules", "@sentropic", "h2a", "dist", "bin.js")
  ];
  const main = mainWorktreePath(root);
  if (main && main !== root) {
    candidates.push(path.join(main, "packages", "h2a", "dist", "bin.js"));
  }
  return candidates.find((c) => existsSync(c));
}
function h2aBinCandidates(root) {
  const configured = process.env.FOCUS_H2A_BIN?.trim();
  if (configured) return `FOCUS_H2A_BIN=${configured}`;
  const main = mainWorktreePath(root);
  return [
    path.join(root, "packages", "h2a", "dist", "bin.js"),
    main && main !== root ? path.join(main, "packages", "h2a", "dist", "bin.js") : null
  ].filter(Boolean).join(", ");
}
function h2aRoots(root) {
  const pinned = process.env.FOCUS_H2A_ROOT?.trim();
  if (pinned) return existsSync(pinned) ? [pinned] : [];
  const identity = repoIdentity(root);
  const candidates = [
    process.env.H2A_ROOT?.trim(),
    path.join(homedir(), "h2a-workspace", ".h2a"),
    // The repo-local convention, in both its forms: the checkout used directly as a root, and a `.h2a`
    // inside it. Both are observed in the wild.
    ...identity.paths,
    ...identity.paths.map((p) => path.join(p, ".h2a"))
  ].filter((p) => Boolean(p));
  return [...new Set(candidates)].filter(
    (p) => existsSync(path.join(p, "presence")) || existsSync(path.join(p, "registry"))
  );
}
function liveSessions(root) {
  const bin = h2aBin(root);
  if (!bin) return [];
  const out = [];
  for (const h2aRoot of h2aRoots(root)) {
    try {
      const stdout = execFileSync("node", [bin, "sessions", "--root", h2aRoot], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
      });
      const parsed = JSON.parse(stdout);
      const arr = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
      if (!Array.isArray(arr)) continue;
      for (const session of arr) out.push({ ...session, root: h2aRoot });
    } catch {
      continue;
    }
  }
  return out;
}
function resolveTarget(root, opts = {}) {
  const bin = h2aBin(root);
  const identity = repoIdentity(root);
  const sessions = bin ? liveSessions(root) : [];
  const requested = opts.requested?.trim() || void 0;
  const configured = process.env.FOCUS_H2A_TARGET?.trim() || void 0;
  const emitter = process.env.FOCUS_EMITTER_INSTANCE?.trim() || void 0;
  const resolution = chooseLiveTarget(sessions, {
    repoPaths: identity.paths,
    nameCandidates: identity.names,
    requested,
    configured,
    emitter
  });
  const roots = h2aRoots(root);
  const base = {
    target: resolution.target,
    targetRoot: resolution.targetRoot,
    reason: resolution.reason,
    live: resolution.live,
    candidates: resolution.candidates,
    ambiguous: resolution.ambiguous,
    roots,
    binMissing: !bin
  };
  if (resolution.target) return base;
  return {
    ...base,
    remedy: explainNoTarget(resolution, {
      binMissing: !bin,
      binPath: h2aBinCandidates(root),
      repoPaths: identity.paths,
      nameCandidates: identity.names,
      requested,
      configured,
      roots
    })
  };
}
function putEnvelope(root, target, envelope, targetRoot) {
  const bin = h2aBin(root);
  if (!bin) throw new Error(`h2a introuvable (${h2aBinCandidates(root)})`);
  const out = execFileSync(
    "node",
    [
      bin,
      "inbox",
      "put",
      "--instance",
      target,
      ...targetRoot ? ["--root", targetRoot] : [],
      "--json",
      JSON.stringify(envelope)
    ],
    { cwd: root, encoding: "utf8" }
  );
  try {
    return { recipientLive: Boolean(JSON.parse(out).recipientLive) };
  } catch {
    return { recipientLive: false };
  }
}

export { repoRoot as a, repoIdentity as b, projectName as c, putEnvelope as p, resolveTarget as r };
//# sourceMappingURL=h2a-bus.js-4eIbfmJH.js.map
