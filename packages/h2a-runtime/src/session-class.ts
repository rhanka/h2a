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
