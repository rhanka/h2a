// Agy 1.5.2 keeps CLI completion separately from the four jetski steps.
// Reviewed ELF: AGY_ONBOARDING_REVIEW.binarySha256. Native cache loader
// reads <appDataDir>/cache/onboarding.json and these three boolean keys.
// This local-custodian supplement replays existing completion only. It
// never presses the ToS dialog or calls SetUserInfo (account telemetry).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { AGY_ONBOARDING_REVIEW, SEAT_RECORD_REL_PATH } from './xcli-seat-onboarding.mjs';

export const AGY_CLI_CACHE_PATH = '.gemini/antigravity-cli/cache/onboarding.json';
export const AGY_CLI_CACHE_SIDECAR = '.sentropic-seat/agy-cli-cache.v1.json';
const keys = ['consumerOnboardingComplete', 'enterpriseOnboardingComplete', 'onboardingComplete'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function completed(value) {
  return record(value) && Object.keys(value).length === keys.length &&
    keys.every(key => value[key] === true);
}
function boundedRead(file, cap) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > cap) throw new Error('agy-cli-cache-shape-unverified');
    const bytes = Buffer.alloc(cap + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, count);
      if (!read) break;
      count += read;
    }
    if (count > cap) throw new Error('agy-cli-cache-shape-unverified');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

// Called only after the original stage 1 has validated and materialised
// this enrolled seat. The sidecar is bound to that complete seat record,
// including its account, native version, lineage and onboarding block.
export function captureAgyCliCache({ sourceHome, seatDir, nativeCliVersion }) {
  if (nativeCliVersion !== AGY_ONBOARDING_REVIEW.nativeCliVersion) return false;
  let cache;
  try { cache = JSON.parse(boundedRead(join(sourceHome, AGY_CLI_CACHE_PATH), 1024)); }
  catch { return false; }
  if (!completed(cache)) return false;
  const seatBytes = boundedRead(join(seatDir, SEAT_RECORD_REL_PATH), 65536);
  const seat = JSON.parse(seatBytes);
  if (seat.bundle?.identity?.cli !== 'agy' ||
      seat.bundle.identity.nativeCliVersion !== nativeCliVersion ||
      !seat.onboarding || seat.launchGate?.eligible !== true) return false;
  const projection = Object.fromEntries(keys.map(key => [key, cache[key]]));
  fs.writeFileSync(join(seatDir, AGY_CLI_CACHE_SIDECAR), JSON.stringify({
    version: 1, nativeCliVersion, seatRecordSha256: digest(seatBytes), cache: projection,
  }) + '\n', { mode: 0o600, flag: 'wx' });
  return true;
}

// The published stage 2 must already have succeeded before this function
// runs. Missing evidence leaves the native dialog intact. Invalid present
// evidence refuses before spawn. No completion bit is ever manufactured.
export function replayAgyCliCache({ seatDir, cellHome, expectedNativeCliVersion }) {
  let bytes;
  try { bytes = boundedRead(join(seatDir, AGY_CLI_CACHE_SIDECAR), 2048); }
  catch (error) { if (error.code === 'ENOENT') return false; throw new Error('agy-cli-cache-shape-unverified'); }
  let value;
  try { value = JSON.parse(bytes); } catch { throw new Error('agy-cli-cache-shape-unverified'); }
  if (!record(value) || Object.keys(value).sort().join(',') !== 'cache,nativeCliVersion,seatRecordSha256,version' ||
      value.version !== 1 || !completed(value.cache)) throw new Error('agy-cli-cache-shape-unverified');
  if (value.nativeCliVersion !== AGY_ONBOARDING_REVIEW.nativeCliVersion ||
      value.nativeCliVersion !== expectedNativeCliVersion ||
      value.seatRecordSha256 !== digest(boundedRead(join(seatDir, SEAT_RECORD_REL_PATH), 65536))) {
    throw new Error('agy-cli-cache-binding-mismatch');
  }
  const file = join(cellHome, AGY_CLI_CACHE_PATH);
  fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value.cache) + '\n', { mode: 0o600, flag: 'wx' });
  return true;
}
