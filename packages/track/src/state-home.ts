import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Resolve the user state directory for Track without creating any directory or file (V4).
 * Precedence:
 *   1. `TRACK_STATE_HOME`
 *   2. `<XDG_STATE_HOME>/sentropic/track`
 *   3. `<HOME>/.local/state/sentropic/track`
 */
export function trackStateHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['TRACK_STATE_HOME']?.trim()
  if (explicit !== undefined && explicit !== '') {
    return resolve(explicit)
  }
  const xdg = env['XDG_STATE_HOME']?.trim()
  if (xdg !== undefined && xdg !== '') {
    return join(resolve(xdg), 'sentropic', 'track')
  }
  const home = env['HOME']?.trim()
  const baseHome = home !== undefined && home !== '' ? resolve(home) : homedir()
  return join(baseHome, '.local', 'state', 'sentropic', 'track')
}

export const OWNER_REPORT_POLICY_FILENAME = 'owner-report-policy.json'

/**
 * Resolve the private-term policy file path for the owner table in exact spec order:
 *   1. explicit `--policy` flag
 *   2. `TRACK_OWNER_POLICY_FILE`
 *   3. `TRACK_OWNER_REPORT_POLICY`
 *   4. `owner-report-policy.json` beside the journal (`trackDir`)
 *   5. `owner-report-policy.json` in `trackStateHome(env)`
 * Never creates any directory or file.
 */
export function resolveOwnerTablePolicyFile(options: {
  flagPolicyPath?: string | undefined
  trackDir?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
}): { policyPath?: string; defaultPolicyPath?: string; statePolicyPath: string } {
  const env = options.env ?? process.env
  const statePolicyPath = join(trackStateHome(env), OWNER_REPORT_POLICY_FILENAME)
  const defaultPolicyPath =
    options.trackDir !== undefined ? join(options.trackDir, OWNER_REPORT_POLICY_FILENAME) : undefined

  const explicit =
    options.flagPolicyPath?.trim() ||
    env['TRACK_OWNER_POLICY_FILE']?.trim() ||
    env['TRACK_OWNER_REPORT_POLICY']?.trim()
  if (explicit !== undefined && explicit !== '') {
    return {
      policyPath: explicit,
      ...(defaultPolicyPath !== undefined ? { defaultPolicyPath } : {}),
      statePolicyPath,
    }
  }
  if (defaultPolicyPath !== undefined && existsSync(defaultPolicyPath)) {
    return { policyPath: defaultPolicyPath, defaultPolicyPath, statePolicyPath }
  }
  if (existsSync(statePolicyPath)) {
    return {
      policyPath: statePolicyPath,
      ...(defaultPolicyPath !== undefined ? { defaultPolicyPath } : {}),
      statePolicyPath,
    }
  }
  return {
    ...(defaultPolicyPath !== undefined ? { defaultPolicyPath } : {}),
    statePolicyPath,
  }
}
