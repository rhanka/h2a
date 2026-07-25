// Shared h2a-bus plumbing for the Focus server routes.
//
// Extracted from `/api/decisions/inject` so that every "hand this back to a live CLI" route in Focus
// resolves its recipient THE SAME WAY. There must be exactly one live-session resolution and one
// instance-prefix validation in this app: a second, slightly-different mechanism is how a decision
// ends up in a dead inbox while the UI claims success.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function repoRoot(): string {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), '..', '..');
}

/** The project (repo) name a decision belongs to — same derivation as `loadReport().repo`. */
export function projectName(root = repoRoot()): string {
  return path.basename(root);
}

export function h2aBin(root: string): string {
  const installed = process.env.FOCUS_H2A_BIN?.trim();
  if (installed) return installed;
  return path.join(root, 'packages', 'h2a', 'dist', 'bin.js');
}

/** A real CLI host we can hand a decision to — not another agent/service posing as one. */
const CLI_HOST_PREFIX = /^(claude|codex|gemini|agy|hermes|opencode):/;

/**
 * LIVE h2a sessions of the given project, freshest first. We use `h2a sessions` (not `h2a discover`):
 * `discover` lists every registered instance including long-dead ones, so it would hand us a stale inbox
 * nobody reads. `sessions` returns only sessions with a current presence (`state:"live"` + heartbeat), which
 * is exactly what we need — a choice must land where someone is actually working.
 */
export function liveSessionsForProject(root: string, project: string): string[] {
  const bin = h2aBin(root);
  if (!existsSync(bin)) return [];
  try {
    const out = execFileSync('node', [bin, 'sessions'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    const parsed = JSON.parse(out) as unknown;
    const arr = (Array.isArray(parsed) ? parsed : ((parsed as { sessions?: unknown[] }).sessions ?? [])) as {
      instance?: string;
      state?: string;
      heartbeatAt?: string;
    }[];
    return arr
      .filter((x) => x.state === 'live')
      .filter((x) => (x.instance ?? '').includes(`:${project}:`))
      .filter((x) => CLI_HOST_PREFIX.test(x.instance ?? ''))
      .sort((a, b) => (b.heartbeatAt ?? '').localeCompare(a.heartbeatAt ?? ''))
      .map((x) => x.instance as string);
  } catch {
    return [];
  }
}

/**
 * The session that should receive what the human just decided: WHOEVER EMITTED THIS FOCUS when h2a serves
 * the app (it passes its own instance as FOCUS_EMITTER_INSTANCE), but only if that emitter is STILL LIVE.
 * Otherwise the freshest live session of the project. Undefined when nobody is live — callers must say so
 * honestly rather than fake a delivery.
 */
export function resolveLiveTarget(root: string, project: string): string | undefined {
  const live = liveSessionsForProject(root, project);
  const emitter = process.env.FOCUS_EMITTER_INSTANCE?.trim();
  return emitter && live.includes(emitter) ? emitter : live[0];
}

/**
 * Deposit a plain envelope in a session's inbox via `h2a inbox put`. Returns whether the recipient was live
 * at deposit time, so the UI can distinguish "picked up now" from "sits in an inbox for later".
 */
export function putEnvelope(root: string, target: string, envelope: unknown): { recipientLive: boolean } {
  const out = execFileSync(
    'node',
    [h2aBin(root), 'inbox', 'put', '--instance', target, '--json', JSON.stringify(envelope)],
    { cwd: root, encoding: 'utf8' }
  );
  try {
    return { recipientLive: Boolean((JSON.parse(out) as { recipientLive?: boolean }).recipientLive) };
  } catch {
    // older CLI without the field — treat as not-confirmed-live
    return { recipientLive: false };
  }
}
