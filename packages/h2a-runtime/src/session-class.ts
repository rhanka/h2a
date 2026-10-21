/**
 * Environment marker propagated through tmux into an agent and its hook
 * children.  It deliberately has a narrow vocabulary: restore admits only
 * explicitly human sessions and background launches must never be upgraded by
 * a later hook event.
 */
export const SESSION_CLASS_ENV = "H2A_SESSION_CLASS";

export type SessionClass = "human" | "background";

/**
 * Classify a local launch from the evidence available at launch time.
 *
 * A session is human only when it is neither a background/headless launch nor
 * missing proof of a terminal a human will use. Unknown evidence deliberately
 * resolves to background: callers must opt into the human classification.
 */
export function deriveSessionClass(options: {
  readonly background?: boolean;
  readonly headless?: boolean;
  readonly humanTerminal?: boolean;
}): SessionClass {
  if (
    options.background === true ||
    options.headless === true ||
    options.humanTerminal !== true
  ) {
    return "background";
  }
  return "human";
}

export function sessionClassFromEnv(
  value: string | undefined,
): SessionClass | undefined {
  return value === "human" || value === "background" ? value : undefined;
}

/**
 * Round-3 P1 (reviews pr382-r3, owner verbatim): WHO launched the session.
 * Recorded at launch and kept across hooks/resumes — an attached terminal
 * is NOT proof of a human initiator, so an undetermined origin is never
 * promoted to a human intention. `undefined` = unknown (legacy rows and
 * launches without positive evidence stay unclassified, never human by
 * default). No name/path filter participates in this decision.
 */
export type LaunchInitiator = "human" | "agent";

/**
 * Derive the launch initiator from the evidence available at launch time.
 * Pure (no I/O): the caller passes its observed stdio/env/flags.
 *
 * - an explicit `--secondary`, a background/headless launch, or any managed
 *   agent marker in the invoker's environment (`REMOTE_JOB_ID`, a
 *   `H2A_SESSION_CLASS=background` stamp inherited from a delegating PTY)
 *   ⇒ `agent` (fail closed: a managed context launching is never human);
 * - an explicit `--primary` with no agent marker ⇒ `human` (an auditable,
 *   explicit declaration — the only path that opts into human);
 * - a real TTY on both stdio streams with no agent marker ⇒ `human` (the
 *   invoker types in a live terminal; pipe-driven invocations stay unknown).
 *   Launch modality (`--attach`/`--no-attach`) is tracked separately by
 *   `sessionClass` and never changes WHO launched;
 * - anything else ⇒ `undefined` (unknown — never default human).
 */
export function deriveLaunchInitiator(options: {
  readonly background?: boolean;
  readonly headless?: boolean;
  readonly secondary?: boolean;
  readonly primary?: boolean;
  readonly envJobId?: string | undefined;
  readonly envSessionClass?: SessionClass | undefined;
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
}): LaunchInitiator | undefined {
  if (options.secondary === true) return "agent";
  if (
    options.background === true ||
    options.headless === true ||
    (options.envJobId !== undefined && options.envJobId.length > 0) ||
    options.envSessionClass === "background"
  ) {
    return "agent";
  }
  if (options.primary === true) return "human";
  if (options.stdinIsTTY === true && options.stdoutIsTTY === true) {
    return "human";
  }
  return undefined;
}
