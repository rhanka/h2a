/**
 * Registered injection markers recognised by Track alone (spec §7.6, DS-9, plan/07 Lot 1).
 *
 * A message whose trimmed start matches one of these prefixes is ALWAYS attributed to `injected`
 * (regardless of any declared `--origin`) and can never become a demand, follow-up or decision
 * answer. Any other undeclared message becomes `doubtful` — Track alone never concludes `owner`.
 */
export const INJECTION_MARKERS: readonly string[] = [
  '[h2a ',
  '[H2A ',
  '[h2a:',
  '[H2A:',
  '[h2a-',
  '[H2A-',
  '<system-reminder>',
  '<SYSTEM_MESSAGE>',
  '<h2a-',
  '<!-- h2a:',
] as const

export function hasInjectionMarker(text: string): boolean {
  const trimmed = text.trimStart()
  if (trimmed.length === 0) return false
  return INJECTION_MARKERS.some((marker) => trimmed.startsWith(marker))
}
