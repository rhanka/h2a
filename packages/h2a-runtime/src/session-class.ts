/**
 * Environment marker propagated through tmux into an agent and its hook
 * children.  It deliberately has a narrow vocabulary: restore admits only
 * explicitly human sessions and background launches must never be upgraded by
 * a later hook event.
 */
export const SESSION_CLASS_ENV = "H2A_SESSION_CLASS";

export type SessionClass = "human" | "background";

export function sessionClassFromEnv(
  value: string | undefined,
): SessionClass | undefined {
  return value === "human" || value === "background" ? value : undefined;
}
