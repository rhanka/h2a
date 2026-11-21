/**
 * LH-00 flag — the single off-by-default gate for every later remote-control
 * path.
 *
 * Most reversible choice: `H2A_REMOTE_CONTROL=1` is the ONLY value that
 * enables anything. Unset, empty, `0`, `true` or any other string means
 * disabled. Changing the flag never changes existing verbs, because no verb
 * reads this module until LH-02 wires it behind the verb dispatch.
 *
 * Q-07 (human boundary): the refusal text names the site-side approval as the
 * human boundary, so later lots reuse the same wording instead of inventing a
 * second boundary story. Q-15 (kill switch): the spec environment kill switch
 * `H2A_REMOTE_OFF` and the local kill flag land in LH-10 and will override
 * this enable flag there; LH-00 deliberately ships the enable flag alone.
 */

export const REMOTE_CONTROL_ENV = "H2A_REMOTE_CONTROL" as const;
export const REMOTE_CONTROL_OFF_ENV = "H2A_REMOTE_OFF" as const;
export const REMOTE_CONTROL_DISABLED_REASON = "remote-control-disabled" as const;
export const REMOTE_CONTROL_DISABLED_MESSAGE =
  "remote control is disabled (H2A_REMOTE_CONTROL is not 1); site-side approval is the human boundary" as const;

export function isRemoteControlEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return (env[REMOTE_CONTROL_ENV] ?? "") === "1";
}

export function isRemoteControlKilledByEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const v = env[REMOTE_CONTROL_OFF_ENV];
  if (v === undefined) return false;
  const norm = v.trim().toLowerCase();
  return norm !== "" && norm !== "0" && norm !== "false";
}

export function assertRemoteControlEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): void {
  if (!isRemoteControlEnabled(env)) {
    throw new Error(REMOTE_CONTROL_DISABLED_MESSAGE);
  }
}
