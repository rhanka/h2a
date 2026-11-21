// Public immutable inputs, private roots, no installation lifecycle scripts.
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyReleaseNative } from './build-release-native.mjs';
import { downloadWithRetry } from './mh-l5-artifacts.mjs';

const exec = promisify(execFile);
const owned = [];
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

function matchesLegacyPin(bytes, pin) {
  return bytes.length === pin.bytes
    && hash(bytes) === pin.sha256
    && 'sha512-' + hash(bytes, 'sha512', 'base64') === pin.integrity;
}

try {
  const artifactsStart = performance.now();
  let old;
  try {
    old = await exec(process.execPath, ['scripts/mh-l5-artifacts.mjs'], {
      timeout: 420_000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - artifactsStart);
    const detail = [
      error.stderr?.trim(),
      error.signal ? `signal=${error.signal}` : '',
      error.code ? `code=${error.code}` : '',
      error.message,
    ].filter(Boolean).join(' | ');
    throw new Error(`fixture_stage_failed:mh-l5-artifacts (${elapsedMs}ms): ${detail}`, { cause: error });
  }
  const receipt = JSON.parse(old.stdout);
  owned.push(receipt.root);
  const pins = JSON.parse(fs.readFileSync('docs/plan/mh-l6/legacy-integrity.json')).files;
  receipt.verified = [];
  for (const [file, pin] of Object.entries(pins)) {
    const [, name, version] = /^sentropic-(.+)-(0\.98\.[56])\.tgz$/.exec(file);
    // Reuse the identical tarball already downloaded & verified by
    // scripts/mh-l5-artifacts.mjs when present and matching the exact pin.
    const existingPath = join(receipt.root, version, `${name}.tgz`);
    let bytes = null;
    if (fs.existsSync(existingPath)) {
      const candidate = fs.readFileSync(existingPath);
      if (matchesLegacyPin(candidate, pin)) bytes = candidate;
    }
    if (!bytes) {
      bytes = await downloadWithRetry(
        `https://registry.npmjs.org/@sentropic/${name}/-/${name}-${version}.tgz`,
        { stage: `legacy-pin:${file}` },
      );
      if (!matchesLegacyPin(bytes, pin)) {
        throw new Error('fixture_integrity_mismatch:' + file);
      }
    }
    fs.writeFileSync(join(receipt.root, file), bytes);
    receipt.verified.push({ file, sha256: pin.sha256, bytes: bytes.length });
  }
  fs.writeFileSync(join(receipt.root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  // MH_L6_NATIVE_ASSETS_ROOT overrides the private root (owner rule: never the
  // real /tmp); unset keeps the historical /tmp prefix.
  const native = process.env.MH_L6_NATIVE_ASSETS_ROOT
    ? fs.mkdtempSync(join(process.env.MH_L6_NATIVE_ASSETS_ROOT, 'mh-l6-toolchain-'))
    : fs.mkdtempSync('/tmp/mh-l6-toolchain-');
  owned.push(native);
  const lock = JSON.parse(fs.readFileSync('scripts/release/native-toolchain.lock.json'));
  for (const archive of lock.recipe.archives) {
    const bytes = await downloadWithRetry(archive.url, { stage: `native-toolchain:${archive.name}` });
    if (hash(bytes) !== archive.sha256) throw new Error('fixture_integrity_mismatch:' + archive.name);
    fs.writeFileSync(join(native, archive.name), bytes);
  }
  const primary = join(native, 'primary'); fs.mkdirSync(primary, { mode: 0o700 });
  const archive = join('scripts/release', lock.archive.path);
  if (hash(fs.readFileSync(archive)) !== lock.archive.sha256) throw new Error('fixture_native_archive_mismatch');
  await exec('/usr/bin/tar', ['-xzf', archive, '--no-same-owner', '-C', primary], { timeout: 60_000 });
  verifyReleaseNative(primary);
  process.stdout.write(JSON.stringify({ env: { MH_L5_ARTIFACTS: receipt.root, MH_L6_NATIVE_ASSETS: native }, owned }) + '\n');
} catch (error) {
  for (const root of owned) fs.rmSync(root, { recursive: true, force: true });
  process.stderr.write((error?.stack ?? String(error)) + '\n'); process.exitCode = 1;
}
