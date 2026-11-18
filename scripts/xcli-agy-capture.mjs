// Native textproto permits a colon before a message block. llm-mesh 0.33.0
// understands the equivalent colon-free spelling. Normalize that syntax
// only, then let its original projector enforce the reviewed consent set.
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { AGY_ONBOARDING_REVIEW, CAPTURE_SOURCES, SEAT_ONBOARDING_FILE_CAPS,
  canonicaliseAgyJetski, captureSeatOnboarding } from './xcli-seat-onboarding.mjs';

export async function captureReviewedSeatOnboarding(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      input.cli !== 'agy' || input.nativeCliVersion !== AGY_ONBOARDING_REVIEW.nativeCliVersion ||
      typeof input.accountBinding !== 'string' || !input.accountBinding ||
      typeof input.sourceHome !== 'string' || !input.sourceHome ||
      !input.selector || typeof input.selector !== 'object' || Array.isArray(input.selector) ||
      input.selector?.sourceRelPath !== CAPTURE_SOURCES.agy) return captureSeatOnboarding(input);
  let projectedHome, fd;
  try {
    fd = fs.openSync(join(input.sourceHome, CAPTURE_SOURCES.agy), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd), cap = SEAT_ONBOARDING_FILE_CAPS['agy-jetski'];
    if (!stat.isFile()) throw new Error('onboarding-shape-unverified');
    if (stat.size > cap) throw new Error('onboarding-size-exceeded');
    const bytes = Buffer.alloc(cap + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, count);
      if (!read) break;
      count += read;
    }
    if (count > cap) throw new Error('onboarding-size-exceeded');
    // Quoted strings and comments pass through untouched; their apparent
    // braces/field names must never become evidence of owner consent.
    const normalized = bytes.subarray(0, count).toString('utf8')
      .replace(/"(?:\\.|[^"\\])*"|#[^\n]*|:\s*\{/g, token => token.startsWith(':') ? ' {' : token);
    const canonical = canonicaliseAgyJetski(normalized, input.nativeCliVersion);
    // Only the validated four-step projection is ever written. Source
    // identifiers, migrations and other native state never leave memory.
    projectedHome = fs.mkdtempSync(join(tmpdir(), 'xcli-agy-capture-'));
    const file = join(projectedHome, CAPTURE_SOURCES.agy);
    fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, canonical, { mode: 0o600, flag: 'wx' });
    return await captureSeatOnboarding({ ...input, sourceHome: projectedHome });
  } catch (error) {
    const code = error.code?.startsWith('onboarding-') ? error.code
      : error.message?.startsWith('onboarding-') ? error.message : 'onboarding-shape-unverified';
    return { ok: false, code, detail: 'reviewed Agy source normalization refused' };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (projectedHome) fs.rmSync(projectedHome, { recursive: true, force: true });
  }
}
