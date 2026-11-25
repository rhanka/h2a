// Populate the native toolchain fixture cache (actions/cache payload).
//
// WHY A SEPARATE UNSANDBOXED STEP. The D16 test sandbox bind-mounts the repo
// tmp tree from per-run shadow dirs, so files a sandboxed process writes
// under <repo>/tmp never reach the host path actions/cache saves in post.
// Reads work (the whole host FS is visible read-only), so the sandboxed
// fixture stage (scripts/prepare-mh-test-fixtures.mjs) gets cache HITS, but
// only a step running OUTSIDE the sandbox can POPULATE the cache on host.
// This script is that step: pure network + verified writes, no tests, no
// repo writes outside the cache dir — like `npm ci`, it needs no sandbox.
//
// CONTRACT. H2A_TOOLCHAIN_CACHE_DIR is required and names the
// actions/cache-restored dir (~/.cache-tmp/h2a-test/toolchain-cache in CI).
// Per archive: a present file with matching sha256 is kept untouched (a
// hit never hits the network); otherwise the archive is fetched with
// resumable ranges and its sha256 must match scripts/release/
// native-toolchain.lock.json exactly, or the run fails explicitly.
import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { downloadWithResume } from './mh-l5-artifacts.mjs';

const SAFE_ARCHIVE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isGlobalTmp(dirPath) {
  const norm = resolve(dirPath);
  return norm === '/tmp' || norm.startsWith('/tmp/') || norm === '/var/tmp' || norm.startsWith('/var/tmp/');
}

function resolvesInsideGlobalTmp(dirPath) {
  if (isGlobalTmp(dirPath)) return true;
  let cur = resolve(dirPath);
  while (!fs.existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  try {
    return isGlobalTmp(fs.realpathSync(cur));
  } catch {
    return false;
  }
}

// Normalize a leading ~/ (workflow `env:` values are literal strings: only
// the shell and actions/cache expand ~, node never does). Without this the
// download lands under <cwd>/~/... while restore/save look at $HOME.
const rawCacheDir = process.env.H2A_TOOLCHAIN_CACHE_DIR || null;
const cacheDir = rawCacheDir == null ? null
  : rawCacheDir.startsWith('~/') ? join(homedir(), rawCacheDir.slice(2))
  : rawCacheDir;
if (!cacheDir) {
  process.stderr.write('toolchain-cache: H2A_TOOLCHAIN_CACHE_DIR is required\n');
  process.exitCode = 2;
} else if (resolvesInsideGlobalTmp(cacheDir)) {
  process.stderr.write(`toolchain-cache: refusing global tmp dir: ${cacheDir}\n`);
  process.exitCode = 2;
} else {
  const lock = JSON.parse(fs.readFileSync('scripts/release/native-toolchain.lock.json'));
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  try {
    for (const archive of lock.recipe.archives) {
      if (typeof archive?.name !== 'string' || !SAFE_ARCHIVE_NAME_RE.test(archive.name) || archive.name.includes('..')) {
        throw new Error(`invalid_archive_name:${String(archive?.name)}`);
      }
      const dest = join(cacheDir, archive.name);
      let present = null;
      try {
        const candidate = fs.readFileSync(dest);
        if (sha256(candidate) === archive.sha256) present = candidate;
      } catch {
        // Cache miss: fetch below.
      }
      if (present) {
        process.stderr.write(`toolchain-cache: hit ${archive.name}\n`);
        continue;
      }
      // Resumable ranges: throttled links (ziglang.org ~70 KB/s measured
      // 2026-11-24) abort every 120 s-capped single fetch; 2 MB chunks each
      // fit inside one attempt.
      const bytes = await downloadWithResume(archive.url, { stage: `native-toolchain:${archive.name}` });
      if (sha256(bytes) !== archive.sha256) throw new Error('fixture_integrity_mismatch:' + archive.name);
      const tmpDest = join(cacheDir, `.${archive.name}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
      try {
        fs.writeFileSync(tmpDest, bytes);
        fs.renameSync(tmpDest, dest);
      } catch (writeError) {
        fs.rmSync(tmpDest, { force: true });
        throw writeError;
      }
      process.stderr.write(`toolchain-cache: saved ${archive.name} (${bytes.length} bytes)\n`);
    }
  } catch (error) {
    process.stderr.write((error?.stack ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
