// Which live h2a session receives what the human just decided.
//
// The defect this exists to kill: the previous resolution asked "which live instance has MY DIRECTORY'S
// BASENAME in its id?". Serve the app from a worktree, a copy, a container, a renamed folder — anything
// whose basename is not literally the h2a project name — and the answer was always "none". The button was
// therefore incapable of delivering, and said so politely. A control that reliably says no is not a
// feature, and a well-worded failure is still a failure.
//
// What we do instead: resolve against the LIVE REGISTRY, the way the rest of the system does. Every
// presence record carries `workspace.path` — the checkout the session is actually working in. A git
// worktree knows its main checkout (`git rev-parse --git-common-dir`), so the two can be matched on a
// real identity instead of on a coincidence of naming. The directory may be called anything.
//
// Order of resolution, most explicit first. A name may participate, but only a name that RESOLVES against
// the registry — never one guessed from a path:
//
//   1. `requested`  — the human picked a session in the UI. Explicit beats inferred, always.
//   2. `configured` — FOCUS_H2A_TARGET, an operator's deliberate pin.
//   3. `emitter`    — the session that served this Focus (FOCUS_EMITTER_INSTANCE), if STILL live.
//   4. workspace    — live sessions whose `workspace.path` is this repo (main worktree or this checkout).
//   5. name         — live sessions whose project segment matches a name this repo answers to.
//   6. sole         — exactly one live CLI session exists overall: there is no ambiguity to resolve.
//
// Dependency-free ESM on purpose: imported by the SvelteKit server routes AND run directly by the repo's
// `node --test` suite, so the ladder above is asserted rather than asserted-about.

/** A real CLI host we can hand a decision to — not another agent/service posing as one. */
const CLI_HOST_PREFIX = /^(claude|codex|gemini|agy|hermes|opencode):/;

/**
 * Presence states that can still receive. `h2a sessions` has ALREADY applied the 90s heartbeat TTL, so
 * anything it returns is fresh; re-filtering on `state === 'live'` (as the previous code did) additionally
 * discarded `opening` and `draining` sessions, which are legitimately reachable. Narrowing a protocol in a
 * consumer is how a live agent becomes invisible to one caller and not another.
 */
const RECEIVING_STATES = new Set(['live', 'opening', 'draining']);

/**
 * @typedef {object} LiveSession
 * @property {string} instance
 * @property {string} [name]
 * @property {string} [state]
 * @property {string} [heartbeatAt]
 * @property {{ path?: string, label?: string }} [workspace]
 * @property {string} [root] The h2a root this presence was read from — see below. Carried, never assumed.
 */

// THE ROOT IS PART OF THE ADDRESS.
//
// An instance id alone does not say WHERE its inbox is. This machine runs two live roots at once:
// the default `~/h2a-workspace/.h2a`, and `/home/antoinefa/src/a2a-cli` used directly as a root by a
// session launched with `--root`. Both hold a live `claude:a2a-cli:…` working in the same checkout.
//
// Depositing into the wrong one delivers into a store the recipient never reads: the write succeeds, the
// CLI reports `recipientLive`, a wake even fires — and the human still cannot see their answers. That is a
// silent partial delivery, which is worse than a refusal, because it looks like success from every angle
// except the only one that matters. So every session carries the root it was discovered in, and the
// envelope is deposited into THAT root. Resolution spans roots; delivery never guesses one.

/**
 * @typedef {object} ResolveContext
 * @property {string[]} repoPaths       Absolute paths this repo answers to (this checkout + its main worktree).
 * @property {string[]} nameCandidates  Project names this repo answers to (basenames of the above).
 * @property {string} [requested]       Instance explicitly chosen by the human in the UI.
 * @property {string} [configured]      FOCUS_H2A_TARGET.
 * @property {string} [emitter]         FOCUS_EMITTER_INSTANCE.
 */

/**
 * The middle segment of `host:label:hash`.
 *
 * Be honest about what this is: it is the session's DISPLAY LABEL frozen at mint (the `--name`, else the
 * host-native session title, else `basename(cwd)`) — NOT a project key. Four sessions in the same checkout
 * are `claude:architect:…`, `claude:canevas:…`, `claude:llm-mesh:…`, `claude:sentropic:…`. Matching on it
 * is therefore a last-resort heuristic for legacy presence records with no `workspace` block, never the
 * primary key. Treating it as the project is what made the button undeliverable in the first place.
 */
export function labelOfInstance(/** @type {string | undefined} */ instance) {
  const parts = String(instance ?? '').split(':');
  return parts.length >= 2 ? parts[1] : '';
}

/** Receiving CLI sessions, freshest heartbeat first. Non-CLI and closed/expired rows never reach a caller. */
export function liveCliSessions(/** @type {LiveSession[]} */ sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && RECEIVING_STATES.has(String(s.state)))
    .filter((s) => CLI_HOST_PREFIX.test(s.instance ?? ''))
    .sort((a, b) => String(b.heartbeatAt ?? '').localeCompare(String(a.heartbeatAt ?? '')));
}

/**
 * @typedef {'requested'|'configured'|'emitter'|'workspace'|'name'|'sole'|'requested-not-live'|'configured-not-live'|'none'} ResolveReason
 */

/**
 * @param {LiveSession[]} sessions
 * @param {ResolveContext} ctx
 * @returns {{
 *   target: string | undefined,
 *   targetSession: LiveSession | undefined,
 *   targetRoot: string | undefined,
 *   reason: ResolveReason,
 *   live: LiveSession[],
 *   candidates: LiveSession[],
 *   ambiguous: boolean
 * }}
 */
export function chooseLiveTarget(sessions, ctx) {
  const live = liveCliSessions(sessions);
  const find = (/** @type {string} */ id) => live.find((s) => s.instance === id);

  /**
   * @param {LiveSession[]} candidates
   * @param {ResolveReason} reason
   */
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
  /** @param {ResolveReason} reason */
  const none = (reason) => ({
    target: undefined,
    targetSession: undefined,
    targetRoot: undefined,
    reason,
    live,
    candidates: live,
    ambiguous: false
  });

  // 1 / 2 — explicit. An explicit target that is NOT live is reported as such rather than quietly
  // replaced by something else: silently redirecting a human's choice is how a decision lands in the
  // wrong inbox while the UI says "delivered".
  if (ctx.requested) {
    const found = find(ctx.requested);
    return found ? pick([found], 'requested') : none('requested-not-live');
  }
  if (ctx.configured) {
    const found = find(ctx.configured);
    return found ? pick([found], 'configured') : none('configured-not-live');
  }

  // 3 — whoever served this Focus, if they are still there.
  if (ctx.emitter) {
    const found = find(ctx.emitter);
    if (found) return pick([found], 'emitter');
  }

  // 4 — the identity that survives renaming: the checkout the session works in.
  const repoPaths = new Set((ctx.repoPaths ?? []).filter(Boolean));
  const byWorkspace = live.filter((s) => s.workspace?.path && repoPaths.has(s.workspace.path));
  if (byWorkspace.length > 0) return pick(byWorkspace, 'workspace');

  // 5 — a label, but checked against the registry rather than assumed from a directory. Only reached when
  // no presence record carries a matching `workspace.path` (legacy records predate that block).
  const names = new Set((ctx.nameCandidates ?? []).filter(Boolean));
  const byName = live.filter(
    (s) => names.has(labelOfInstance(s.instance)) || (s.name && names.has(s.name))
  );
  if (byName.length > 0) return pick(byName, 'name');

  // 6 — one live session and nothing to disambiguate. Reported with its own reason so the UI can say
  // WHERE it is about to go: a lone recipient is unambiguous, not automatically the right one.
  if (live.length === 1) return pick([live[0]], 'sole');

  return none('none');
}

/**
 * What would make delivery work — because "no live session" tells the human nothing they can act on.
 * Each branch names the concrete next move, and lists the sessions that ARE live so an operator can pin
 * one instead of guessing why the button is dead.
 *
 * @param {ReturnType<typeof chooseLiveTarget>} resolution
 * @param {{ binMissing?: boolean, binPath?: string, repoPaths: string[], nameCandidates: string[], requested?: string, configured?: string, roots?: string[] }} ctx
 */
export function explainNoTarget(resolution, ctx) {
  if (ctx.binMissing) {
    return (
      `Le binaire h2a est introuvable (${ctx.binPath ?? 'aucun chemin candidat'}) : le focus ne peut interroger ` +
      `aucun registre, donc aucune remise n'est possible — ce n'est pas « aucune session live ». ` +
      `Pour que ça marche : construisez le CLI (npm run build:h2a à la racine du dépôt) ou pointez FOCUS_H2A_BIN ` +
      `sur un binaire h2a déjà construit.`
    );
  }

  const roots = ctx.roots?.length ? ` Racines h2a interrogées : ${ctx.roots.join(', ')}.` : '';
  const liveList = resolution.live.map(
    (s) => `${s.instance}${s.workspace?.path ? ` (${s.workspace.path})` : ''}${s.root ? ` [racine ${s.root}]` : ''}`
  );
  const liveSummary = liveList.length
    ? `Sessions live actuellement visibles (${liveList.length}) : ${liveList.join(', ')}.${roots}`
    : `Aucune session h2a live n'est visible dans le registre, pour aucun projet.${roots}`;

  if (resolution.reason === 'requested-not-live') {
    return (
      `La session choisie (${ctx.requested}) n'est plus live : rien n'a été remis, et surtout rien n'a été ` +
      `redirigé ailleurs sans vous le dire. ${liveSummary} Choisissez une session dans la liste, ou relancez celle-ci.`
    );
  }
  if (resolution.reason === 'configured-not-live') {
    return (
      `FOCUS_H2A_TARGET pointe sur ${ctx.configured}, qui n'est pas live : la cible épinglée par l'opérateur ` +
      `est respectée, jamais contournée en silence. ${liveSummary} Corrigez FOCUS_H2A_TARGET ou relancez cette session.`
    );
  }

  const paths = ctx.repoPaths.join(', ');
  const names = ctx.nameCandidates.join(', ');
  return (
    `Aucune session h2a live ne correspond à ce dépôt. ${liveSummary} ` +
    `La résolution se fait sur le CHEMIN du checkout (${paths}) puis sur le nom de projet (${names}) — ` +
    `jamais sur le nom du dossier servi, précisément pour qu'un worktree fonctionne. ` +
    `Pour que ça marche, au choix : ouvrez une CLI h2a sur ce dépôt ; servez le focus depuis h2a ` +
    `(il transmet alors FOCUS_EMITTER_INSTANCE) ; épinglez une session avec FOCUS_H2A_TARGET ; ` +
    `ou sélectionnez une session live dans la liste ci-dessus.`
  );
}
