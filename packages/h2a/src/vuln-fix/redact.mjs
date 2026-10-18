// Redact secrets from command output before persistence or transmission.
// File outputs, reports, state and review evidence must never contain raw
// tokens even when a scanner, test or registry prints them.
export function redactSecretsText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9\-._~+/=]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/=]{8,}/gi, '$1[REDACTED]')
    .replace(/(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, '$1[REDACTED]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|npm_[A-Za-z0-9]{8,}|xox[bpas]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{8,}|dop_v1_[a-f0-9]{32,})\b/g, '[REDACTED]')
    .replace(/((?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?token|auth[-_]?token)\s*[:=]\s*['"]?)([^'"\s;}]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^/\s@]+:)([^@\s/]+)(@)/g, '$1[REDACTED]$3');
}

export function redactOutput(output) {
  if (!output || typeof output !== 'object') return output;
  const redacted = { ...output };
  if (typeof redacted.stdout === 'string') redacted.stdout = redactSecretsText(redacted.stdout);
  if (typeof redacted.stderr === 'string') redacted.stderr = redactSecretsText(redacted.stderr);
  return redacted;
}

export function redactDeep(value) {
  if (typeof value === 'string') return redactSecretsText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = redactDeep(entry);
    return out;
  }
  return value;
}
