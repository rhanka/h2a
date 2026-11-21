/**
 * Secret masking applied at capture BEFORE any byte is written to disk (spec V8, §7.5, plan/07 Lot 1).
 *
 * The pattern list is exported as data so security review (`cyber`, blocking) can inspect every
 * token format and verify one fixture per entry in `secrets.test.ts`.
 */

export interface SecretPattern {
  readonly kind: string
  readonly description: string
  readonly pattern: RegExp
  /**
   * Optional custom replacement returning the masked string while keeping structural framing
   * (e.g. `Authorization: ` or `https://` or `?token=`). When omitted the entire match is
   * replaced by `[secret masqué : <kind>]`.
   */
  readonly replace?: (match: string, ...groups: string[]) => string
}

export function secretPlaceholder(kind: string): string {
  return `[secret masqué : ${kind}]`
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    kind: 'pem-private-key',
    description: 'PEM / OpenSSH private key block',
    pattern:
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gu,
  },
  {
    kind: 'pgp-private-key',
    description: 'PGP armored private key block',
    pattern:
      /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/gu,
  },
  {
    kind: 'jwt',
    description: 'JSON Web Token (three base64url segments starting with eyJ)',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'anthropic-key',
    description: 'Anthropic API key (sk-ant-...)',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'openai-key',
    description: 'OpenAI API key (sk-...)',
    pattern: /\bsk-(?:proj-|svcacct-|live-|test-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'github-token',
    description: 'GitHub classic or fine-grained personal access token',
    pattern: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  },
  {
    kind: 'gitlab-token',
    description: 'GitLab personal access token (glpat-...)',
    pattern: /\bglpat-[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'aws-access-key',
    description: 'AWS access key ID (AKIA/ASIA...)',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  },
  {
    kind: 'google-api-key',
    description: 'Google API key (AIza...)',
    pattern: /\bAIza[0-9A-Za-z_-]{30,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'google-oauth-token',
    description: 'Google OAuth2 access or refresh token (ya29. / 1//0)',
    pattern: /(?:\bya29\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])|\b1\/\/0[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-]))/gu,
  },
  {
    kind: 'slack-token',
    description: 'Slack bot/user/app token (xox...)',
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{16,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'huggingface-token',
    description: 'Hugging Face access token (hf_...)',
    pattern: /\bhf_[A-Za-z0-9]{20,}\b/gu,
  },
  {
    kind: 'npm-token',
    description: 'npm granular/classic automation token (npm_...)',
    pattern: /\bnpm_[A-Za-z0-9]{20,}\b/gu,
  },
  {
    kind: 'stripe-key',
    description: 'Stripe secret/restricted API key (sk_live_/rk_live_/...)',
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/gu,
  },
  {
    kind: 'webhook-secret',
    description: 'Webhook signing secret (whsec_...)',
    pattern: /\bwhsec_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'age-secret-key',
    description: 'age secret key (AGE-SECRET-KEY-1...)',
    pattern: /\bAGE-SECRET-KEY-1[0-9A-Z]{20,}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: 'auth-header',
    description: 'HTTP Authorization / Proxy-Authorization / X-Api-Key / Api-Key / X-Auth-Token header',
    pattern:
      /(\b(?:Authorization|Proxy-Authorization)\s*:\s*)(?:Bearer|Basic|Token|ApiKey)\s+(?!\[secret masqué : )[^\s"'`<>]+|(\b(?:X-Api-Key|Api-Key|X-Auth-Token)\s*:\s*)(?:(?:Bearer|Token)\s+)?(?!\[secret masqué : )[^\s"'`<>]+/giu,
    replace: (_m, prefix) => `${prefix}${secretPlaceholder('auth-header')}`,
  },
  {
    kind: 'cookie-header',
    description: 'HTTP Cookie / Set-Cookie header (full multi-value line)',
    pattern: /(^|[\r\n])([ \t]*(?:Cookie|Set-Cookie)[ \t]*:[ \t]*)(?=\S)(?!\[secret masqué : cookie-header\])[^\r\n]+/giu,
    replace: (_m, lead, prefix) => `${lead}${prefix}${secretPlaceholder('cookie-header')}`,
  },
  {
    kind: 'url-credentials',
    description: 'Embedded user:password or :password credentials in a URL',
    pattern:
      /(\b(?:https?|wss?|ftp|postgres(?:ql)?|mysql|rediss?|amqps?|mongodb(?:\+srv)?):\/\/)(?!\[secret masqué : )([^/\s:@"'`<>]*:[^/\s@"'`<>]+)@/giu,
    replace: (_m, scheme) => `${scheme}${secretPlaceholder('url-credentials')}@`,
  },
  {
    kind: 'url-query-secret',
    description: 'Sensitive URL query parameter (token, api_key, code, secret, password, ...)',
    pattern:
      /([?&](?:token|access_token|refresh_token|api_key|apikey|secret|password|passwd|code|key|sig|signature|auth)=)(?!\[secret masqué : )([^&\s"'`<>#]+)/giu,
    replace: (_m, prefix) => `${prefix}${secretPlaceholder('url-query-secret')}`,
  },
  {
    kind: 'secret-assignment',
    description: 'Key-value or JSON secret assignment (password=, *_TOKEN=, *_SECRET=, apiKey=, "client_secret": "...", ...)',
    pattern:
      /(\b(?:(?:[A-Za-z0-9_-]*[_-])?(?:password|passwd|pwd|secret(?:[-_]?access[-_]?key|[-_]?key)?|api[-_]?key|private[-_]?key|credentials?|token)|[A-Za-z0-9]+(?:password|secret(?:accesskey|key)?|apikey|privatekey|credentials?|token))["']?\s*[:=]\s*["']?)(?!\[secret masqué : )([^\s"',;}\])]{8,})(["']?)/giu,
    replace: (_m, prefix, _val, suffix) => `${prefix}${secretPlaceholder('secret-assignment')}${suffix}`,
  },
] as const

export interface MaskSecretsResult {
  text: string
  maskedCount: number
  kinds: string[]
}

/**
 * Replace every matching secret format with `[secret masqué : <kind>]`.
 * Deterministic, pure and idempotent: running twice produces the same string with `maskedCount: 0`.
 */
export function maskSecrets(input: string): MaskSecretsResult {
  let out = input
  let maskedCount = 0
  const kinds = new Set<string>()

  for (const spec of SECRET_PATTERNS) {
    const re = new RegExp(spec.pattern.source, spec.pattern.flags)
    out = out.replace(re, (...args: unknown[]) => {
      const full = args[0] as string
      const groups = args.slice(1, -2).filter((g): g is string => typeof g === 'string')
      maskedCount += 1
      kinds.add(spec.kind)
      if (spec.replace !== undefined) {
        return spec.replace(full, ...groups)
      }
      return secretPlaceholder(spec.kind)
    })
  }

  return { text: out, maskedCount, kinds: [...kinds] }
}
