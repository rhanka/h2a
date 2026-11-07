import fs from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyLogin, environment } from './xcli-lab.mjs';

export const MUSE_NOAUTH_PATTERN = /not.*(logged|signed).?in|no .*auth|unauthenticated|missing.*(login|credential)|no_allowance|server_sent_no_usage|no subscription allowance|subscription allowance unavailable/i;
export function classifyMuseUsageProbe({ status, text }) {
  const body = `${text ?? ''}`;
  return { authed: status === 0 && body.trim().length > 0 && !MUSE_NOAUTH_PATTERN.test(body) };
}

export async function runMuseAuthPrecheck({ seat, executable, root, modelCalls = 0 }) {
  const probe = (withFiles, args) => {
    const home = fs.mkdtempSync(join(root, 'pre-'));
    try {
      const env = environment(home);
      if (withFiles) copyLogin(seat.family, seat.authSource, home, env);
      const out = spawnSync(executable, args,
        { env, cwd: home, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 });
      return { status: out.status, stdout: out.stdout ?? '', text: `${out.stdout ?? ''}\n${out.stderr ?? ''}` };
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  };
  const control = probe(false, ['usage']);
  // Infrastructure failure is not a valid negative-auth control.
  if (control.status !== 1 || !/not.*(logged|signed).?in/i.test(control.text)) {
    return { ok: false, reason: 'preflight-control-untrusted', modelCalls };
  }
  const seated = probe(true, ['usage']);
  if (classifyMuseUsageProbe(seated).authed) return { ok: true, modelCalls, detail: 'usage-accepted' };
  // No usage data is not auth proof. Only this measured successful command
  // shape may fall back to a bounded provider turn; login errors stay closed.
  if (seated.status !== 0 || !/no_allowance|server_sent_no_usage|no subscription allowance|subscription allowance unavailable/i.test(seated.text)) {
    return { ok: false, reason: 'preflight-auth-unproven', modelCalls };
  }
  const marker = `H2A_AUTH_PROOF_${randomBytes(16).toString('hex')}`;
  const response = probe(true, ['exec', '--preset', 'empty', '--max-model-steps', '1',
    '--disable-reminders', '--no-foreign-personal-context', '--no-session-log',
    `Reply with exactly ${marker} and nothing else. Do not use tools.`]);
  const spent = Math.max(1, modelCalls);
  if (response.status === 0 && response.stdout.trim() === marker) {
    return { ok: true, modelCalls: spent, detail: 'model-response-accepted' };
  }
  const quota = /quota exceeded|usage limit|rate.?limit|credits exhausted|insufficient credits|limit reached|\b429\b/i.test(response.text);
  // Preserve only typed, non-secret provider facts. Never retain the raw
  // provider output, which may be credential-adjacent.
  const reset = response.text.match(/reset(?:s|ting)?(?:\s+(?:time|at|on))?\s*[:=]?\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)/i)?.[1];
  return { ok: false, modelCalls: spent,
    reason: quota ? 'provider-quota' : 'preflight-auth-unproven',
    ...(quota ? { providerQuota: { observed: true,
      ...(/\b429\b/.test(response.text) ? { httpStatus: 429 } : {}),
      ...(reset && Number.isFinite(Date.parse(reset)) ? { resetAt: new Date(reset).toISOString() } : {}) } } : {}) };
}
