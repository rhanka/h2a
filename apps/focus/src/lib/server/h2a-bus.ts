// Shared h2a-bus plumbing for the Focus server routes.
//
// Extracted from `/api/decisions/inject` so that every "hand this back to a live CLI" route in Focus
// resolves its recipient THE SAME WAY. There must be exactly one live-session resolution and one
// instance-prefix validation in this app: a second, slightly-different mechanism is how a decision
// ends up in a dead inbox while the UI claims success.
//
// The resolution ITSELF lives in `./h2a-target.js` — pure, dependency-free, and covered by the repo test
// suite. This module is only the I/O around it: find a usable h2a binary, ask the registry, deposit the
// envelope. Keeping the policy testable and the plumbing thin is deliberate; the previous version buried
// the policy ("the directory basename IS the project name") inside the plumbing, where nothing could
// catch that it made delivery impossible from any worktree.

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { chooseLiveTarget, explainNoTarget, type LiveSession } from './h2a-target.js';

export type { LiveSession };

export function repoRoot(): string {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), '..', '..');
}

/** The project (repo) name a decision belongs to — same derivation as `loadReport().repo`. */
export function projectName(root = repoRoot()): string {
  return path.basename(root);
}

/**
 * The MAIN checkout behind this directory. A git worktree's `--git-common-dir` points at the primary
 * repository, so a Focus served from `…/scratchpad/dossier-fix-wt` still knows it belongs to
 * `/home/antoinefa/src/a2a-cli` — which is exactly the `workspace.path` an h2a session registers.
 * This is the link that makes delivery independent of what the served directory is called.
 */
export function mainWorktreePath(root: string): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!out) return undefined;
    // `<main>/.git` for a real checkout; a bare repo has no working tree to match against.
    return path.basename(out) === '.git' ? path.dirname(out) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every path and name this repository legitimately answers to, deduplicated and order-stable.
 *
 * Paths are resolved through `realpath` because that is what a presence record stores
 * (`workspace.path = realpathSync(cwd)`): comparing a symlinked path to a resolved one silently never
 * matches, which is the same class of bug as comparing basenames, only harder to see.
 */
export function repoIdentity(root: string): { paths: string[]; names: string[] } {
  const main = mainWorktreePath(root);
  const raw = [root, main].filter((p): p is string => Boolean(p));
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

/**
 * A usable h2a entrypoint, or `undefined`.
 *
 * Several layouts are legitimate (installed CLI, monorepo build, runtime package), and "no binary" is a
 * DIFFERENT failure from "no live session": one means we could not ask the question, the other means we
 * asked and the answer was nobody. Conflating them is how an unbuilt checkout gets reported as an empty
 * bus. Callers therefore get `undefined` and say which one it was.
 */
export function h2aBin(root: string): string | undefined {
  const configured = process.env.FOCUS_H2A_BIN?.trim();
  if (configured) return existsSync(configured) ? configured : undefined;
  const candidates = [
    path.join(root, 'packages', 'h2a', 'dist', 'bin.js'),
    path.join(root, 'node_modules', '@sentropic', 'h2a', 'dist', 'bin.js')
  ];
  const main = mainWorktreePath(root);
  if (main && main !== root) {
    candidates.push(path.join(main, 'packages', 'h2a', 'dist', 'bin.js'));
  }
  return candidates.find((c) => existsSync(c));
}

/** The candidate paths we looked at, for an error message that lets someone actually fix it. */
export function h2aBinCandidates(root: string): string {
  const configured = process.env.FOCUS_H2A_BIN?.trim();
  if (configured) return `FOCUS_H2A_BIN=${configured}`;
  const main = mainWorktreePath(root);
  return [
    path.join(root, 'packages', 'h2a', 'dist', 'bin.js'),
    main && main !== root ? path.join(main, 'packages', 'h2a', 'dist', 'bin.js') : null
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The h2a roots to interrogate, in priority order.
 *
 * There is not one bus on a machine, there are as many as there are `--root` choices, and they do not see
 * each other. This host runs two at once: the default `~/h2a-workspace/.h2a`, and the repo directory
 * itself, used as a root by a session launched with `--root /home/antoinefa/src/a2a-cli`. A live
 * `claude:a2a-cli:…` exists in EACH, both working in the same checkout.
 *
 * Querying only one of them is how an injection reports success while landing in a store the recipient
 * never reads — the write happens, `recipientLive` is true, a wake even fires, and the human still sees
 * nothing. `FOCUS_H2A_ROOT` pins a single root when an operator wants exactly one.
 */
export function h2aRoots(root: string): string[] {
  const pinned = process.env.FOCUS_H2A_ROOT?.trim();
  if (pinned) return existsSync(pinned) ? [pinned] : [];

  const identity = repoIdentity(root);
  const candidates = [
    process.env.H2A_ROOT?.trim(),
    path.join(homedir(), 'h2a-workspace', '.h2a'),
    // The repo-local convention, in both its forms: the checkout used directly as a root, and a `.h2a`
    // inside it. Both are observed in the wild.
    ...identity.paths,
    ...identity.paths.map((p) => path.join(p, '.h2a'))
  ].filter((p): p is string => Boolean(p));

  // A directory is an h2a root when it actually stores presences or registrations — not merely because it
  // exists. Without this, the repo checkout itself would always look like a root.
  return [...new Set(candidates)].filter(
    (p) => existsSync(path.join(p, 'presence')) || existsSync(path.join(p, 'registry'))
  );
}

/**
 * Every session the registries currently report, each TAGGED WITH THE ROOT it was found in.
 *
 * We use `h2a sessions` (not `h2a discover`): `discover` lists every registered instance including
 * long-dead ones, so it would hand us a stale inbox nobody reads. `sessions` returns only sessions with a
 * current presence (heartbeat within the TTL) AND the `workspace` block we resolve on.
 */
export function liveSessions(root: string): LiveSession[] {
  const bin = h2aBin(root);
  if (!bin) return [];
  const out: LiveSession[] = [];
  for (const h2aRoot of h2aRoots(root)) {
    try {
      const stdout = execFileSync('node', [bin, 'sessions', '--root', h2aRoot], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      });
      const parsed = JSON.parse(stdout) as unknown;
      const arr = (
        Array.isArray(parsed) ? parsed : ((parsed as { sessions?: unknown[] }).sessions ?? [])
      ) as LiveSession[];
      if (!Array.isArray(arr)) continue;
      // The root travels with the session: it is half of the address.
      for (const session of arr) out.push({ ...session, root: h2aRoot });
    } catch {
      // One unreadable root must not blind us to the others.
      continue;
    }
  }
  return out;
}

export interface TargetResolution {
  target?: string;
  /** The h2a root the target reads from — where the envelope MUST be deposited. */
  targetRoot?: string;
  reason: string;
  /** Every live CLI session, so the UI can offer a choice instead of a dead end. */
  live: LiveSession[];
  /** The subset that matched this repo — what a sane default would pick from. */
  candidates: LiveSession[];
  /** Several live sessions answer for this repo: the choice must be visible, not silent. */
  ambiguous: boolean;
  /** The roots we interrogated, so a human can see the search space rather than infer it. */
  roots: string[];
  /** Present only when there is no target: what would make delivery work. */
  remedy?: string;
  binMissing: boolean;
}

/**
 * The session that should receive what the human just decided. See `./h2a-target.js` for the ladder.
 * When nothing resolves, `remedy` states what would make it work — reporting only the failure leaves the
 * human with a button that does not work and no idea why.
 */
export function resolveTarget(root: string, opts: { requested?: string } = {}): TargetResolution {
  const bin = h2aBin(root);
  const identity = repoIdentity(root);
  const sessions = bin ? liveSessions(root) : [];
  const requested = opts.requested?.trim() || undefined;
  const configured = process.env.FOCUS_H2A_TARGET?.trim() || undefined;
  const emitter = process.env.FOCUS_EMITTER_INSTANCE?.trim() || undefined;

  const resolution = chooseLiveTarget(sessions, {
    repoPaths: identity.paths,
    nameCandidates: identity.names,
    requested,
    configured,
    emitter
  });

  const roots = h2aRoots(root);
  const base: TargetResolution = {
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

/**
 * Deposit a plain envelope in a session's inbox via `h2a inbox put`, IN THE ROOT THAT SESSION READS.
 *
 * `targetRoot` is not optional decoration: without it the deposit goes to whatever root the CLI defaults
 * to, which on a multi-root host is a store the recipient may never open. The delivery would still report
 * success. Passing the root the presence was discovered in is what makes "delivered" mean "readable".
 */
export function putEnvelope(
  root: string,
  target: string,
  envelope: unknown,
  targetRoot?: string
): { recipientLive: boolean } {
  const bin = h2aBin(root);
  if (!bin) throw new Error(`h2a introuvable (${h2aBinCandidates(root)})`);
  const out = execFileSync(
    'node',
    [
      bin,
      'inbox',
      'put',
      '--instance',
      target,
      ...(targetRoot ? ['--root', targetRoot] : []),
      '--json',
      JSON.stringify(envelope)
    ],
    { cwd: root, encoding: 'utf8' }
  );
  try {
    return { recipientLive: Boolean((JSON.parse(out) as { recipientLive?: boolean }).recipientLive) };
  } catch {
    // older CLI without the field — treat as not-confirmed-live
    return { recipientLive: false };
  }
}
