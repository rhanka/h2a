// Public immutable inputs, private roots, no installation lifecycle scripts.
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyReleaseNative } from './build-release-native.mjs';

const exec = promisify(execFile);
const owned = [];
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`fixture_download_failed:${response.status}:${url}`);
  return Buffer.from(await response.arrayBuffer());
}
try {
  const old = await exec(process.execPath, ['scripts/mh-l5-artifacts.mjs'], {
    timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  });
  const receipt = JSON.parse(old.stdout);
  owned.push(receipt.root);
  const pins = JSON.parse(fs.readFileSync('docs/plan/mh-l6/legacy-integrity.json')).files;
  receipt.verified = [];
  for (const [file, pin] of Object.entries(pins)) {
    const [, name, version] = /^sentropic-(.+)-(0\.98\.[56])\.tgz$/.exec(file);
    const bytes = await download(`https://registry.npmjs.org/@sentropic/${name}/-/${name}-${version}.tgz`);
    if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256 || 'sha512-' + hash(bytes, 'sha512', 'base64') !== pin.integrity) {
      throw new Error('fixture_integrity_mismatch:' + file);
    }
    fs.writeFileSync(join(receipt.root, file), bytes);
    receipt.verified.push({ file, sha256: pin.sha256, bytes: bytes.length });
  }
  fs.writeFileSync(join(receipt.root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  const native = fs.mkdtempSync('/tmp/mh-l6-toolchain-');
  owned.push(native);
  const lock = JSON.parse(fs.readFileSync('scripts/release/native-toolchain.lock.json'));
  for (const archive of lock.recipe.archives) {
    const bytes = await download(archive.url);
    if (hash(bytes) !== archive.sha256) throw new Error('fixture_integrity_mismatch:' + archive.name);
    fs.writeFileSync(join(native, archive.name), bytes);
  }
  const primary = join(native, 'primary'); fs.mkdirSync(primary, { mode: 0o700 });
  const archive = join('scripts/release', lock.archive.path);
  if (hash(fs.readFileSync(archive)) !== lock.archive.sha256) throw new Error('fixture_native_archive_mismatch');
  await exec('/usr/bin/tar', ['-xzf', archive, '--no-same-owner', '-C', primary]);
  verifyReleaseNative(primary);
  process.stdout.write(JSON.stringify({ env: { MH_L5_ARTIFACTS: receipt.root, MH_L6_NATIVE_ASSETS: native }, owned }) + '\n');
} catch (error) {
  for (const root of owned) fs.rmSync(root, { recursive: true, force: true });
  process.stderr.write(error.stack + '\n'); process.exitCode = 1;
}
