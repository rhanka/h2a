// Shared release-candidate pack for the suites that qualify the packed tree.
//
// WHY. Three rest-bucket suites (registry-packed-layout, registry-plugin-
// declarations, candidate-artifacts) each ran `scripts/pack-candidate.mjs`
// in their own before() hook: three full five-tarball release packs
// (~250 s wall each on a contended CI runner, R3b measurement) of byte-
// identical output from the same tree, overlapping under the file pool and
// starving every neighbour (notably the seam guard and the scope guards).
// This helper packs ONCE per tree state and hands every consumer the same
// verified output directory. Assertions in the consuming suites are
// unchanged; only the producer is deduplicated.
//
// CORRECTNESS. The cache key binds the exact pack inputs: HEAD, the tracked
// tree state (`git status --porcelain`), the producer scripts and the five
// packed package versions. Any change repacks. The cache lives under
// os.tmpdir(), which CI confines to the disposable per-run TMPDIR, so
// entries never leak across runs; a foreign key is repacked, never reused.
// Consumers only read the shared directory (extractions go to their own lab
// dirs). Concurrent processes serialize on an mkdir lock with stale-owner
// takeover; waiters observe completion through complete.json.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
// helpers/ -> test/ -> h2a/ -> packages/ -> repo root.
const REPO = resolve(HERE, '..', '..', '..', '..');
const PACK_SCRIPT = join(REPO, 'scripts', 'pack-candidate.mjs');
const PRODUCER_FILES = [PACK_SCRIPT, join(REPO, 'scripts', 'package-release.mjs')];
const PACKED_PACKAGES = ['h2a', 'h2a-runtime', 'track', 'h2a-cli', 'focus'];

const LOCK_TIMEOUT_MS = 590_000;
const STALE_LOCK_MS = 600_000;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function versions() {
  const out = {};
  for (const name of PACKED_PACKAGES) {
    const file = name === 'focus'
      ? join(REPO, 'packages', 'focus', 'package.json')
      : join(REPO, 'packages', name, 'package.json');
    out[name] = JSON.parse(readFileSync(file, 'utf8')).version;
  }
  return out;
}

export function expectedCandidateTarballs() {
  const v = versions();
  const h2aVersion = v.h2a;
  return [...['h2a', 'h2a-cli', 'h2a-runtime', 'track']
    .map((name) => `sentropic-${name}-${h2aVersion}.tgz`),
  `sentropic-focus-${v.focus}.tgz`].sort();
}

export function keyInputs() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  assert.match(head, /^[a-f0-9]{40}$/, 'shared pack key needs a git HEAD');
  let status;
  try {
    status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    status = null;
  }
  // A dirty tree packs its working-copy bytes, so the key must bind them.
  // `git status` failing (foreign VCS layout) disables sharing: the caller
  // falls back to a private pack, never to a foreign cache entry.
  if (status === null) return null;
  const producers = Object.fromEntries(PRODUCER_FILES.map((file) => [file, sha256File(file)]));
  const v = versions();
  const h = createHash('sha256');
  h.update(`head:${head}\n`);
  h.update(`status:${status}\n`);
  for (const [file, digest] of Object.entries(producers)) h.update(`${file}:${digest}\n`);
  h.update(`versions:${JSON.stringify(v)}\n`);
  return { key: h.digest('hex'), head, status, producers, versions: v };
}

export function cacheKey() {
  return keyInputs()?.key ?? null;
}

function lockIsStale(lockDir) {
  let stat;
  try {
    stat = readFileSync(join(lockDir, 'owner.json'), 'utf8');
  } catch {
    return true;
  }
  try {
    const owner = JSON.parse(stat);
    if (typeof owner.pid !== 'number' || typeof owner.at !== 'number') return true;
    if (Date.now() - owner.at > STALE_LOCK_MS) return true;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

function readComplete(dir, key) {
  try {
    const complete = JSON.parse(readFileSync(join(dir, 'complete.json'), 'utf8'));
    if (complete.key !== key || complete.dir !== dir) return null;
    const names = expectedCandidateTarballs();
    assert.deepEqual([...complete.tarballs].sort(), names, 'shared pack manifest names the exact candidate cohort');
    for (const name of names) assert.ok(existsSync(join(dir, name)), `shared pack tarball present: ${name}`);
    return dir;
  } catch {
    return null;
  }
}

async function runPack(output) {
  const lab = mkdtempSync(join(tmpdir(), 'h2a-shared-pack-'));
  try {
    const env = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
    for (const name of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) {
      env[name] = join(lab, name);
      mkdirSync(env[name], { mode: 0o700 });
    }
    const result = await exec(process.execPath, [PACK_SCRIPT, output], {
      cwd: REPO, env, timeout: 590_000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.stderr, '', 'candidate pack runs warning-free');
  } finally {
    rmSync(lab, { recursive: true, force: true });
  }
}

/**
 * Pack the five release candidates once per tree state and return the
 * directory holding the tarballs. Concurrent callers (separate test-file
 * processes) serialize on the cache lock; the winner packs, the rest wait
 * for complete.json. Returns null when sharing is unavailable (no git
 * state); the caller then packs privately, exactly as before.
 */
export async function sharedPackCandidates() {
  // One frozen key per runner invocation (H2A_SHARED_PACK_KEY, set by
  // scripts/run-tests.mjs): the tree is fixed for the run, so every process
  // must agree on the key even while test outputs land mid-run. A live
  // computation is the fallback for direct `node --test` invocations.
  // Mid-run tree changes are test outputs, never pack inputs.
  const frozen = process.env.H2A_SHARED_PACK_KEY;
  const key = (typeof frozen === 'string' && /^[a-f0-9]{64}$/.test(frozen)) ? frozen : cacheKey();
  if (key === null) return null;
  const root = join(tmpdir(), 'h2a-shared-pack-candidates', key);
  const lockDir = join(root, 'lock');
  const tarballs = join(root, 'tarballs');
  mkdirSync(root, { recursive: true });
  const fast = readComplete(tarballs, key);
  if (fast) {
    process.stderr.write(`shared-pack-candidates: reused ${fast}\n`);
    return fast;
  }
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now() }) + '\n');
      break;
    } catch {
      const waited = readComplete(tarballs, key);
      if (waited) {
        process.stderr.write(`shared-pack-candidates: reused ${waited}\n`);
        return waited;
      }
      if (lockIsStale(lockDir)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error('shared-pack-candidates: lock wait exceeded; pack starved by a stuck owner');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  try {
    if (readComplete(tarballs, key)) return tarballs;
    // A killed packer leaves its staging behind; reclaim it under the lock.
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('tarballs.stage-')) rmSync(join(root, entry), { recursive: true, force: true });
    }
    // Diagnosis: record the exact key inputs with the pack, so a future key
    // change names the files that flipped it instead of guessing.
    try {
      writeFileSync(join(root, 'key-inputs.json'), JSON.stringify(keyInputs(), null, 2) + '\n');
    } catch { /* diagnosis must never break the pack */ }
    const staging = `${tarballs}.stage-${process.pid}`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    await runPack(staging);
    const names = expectedCandidateTarballs();
    assert.deepEqual(readdirSync(staging).sort(), names, 'candidate pack produces the exact five-tarball cohort');
    rmSync(tarballs, { recursive: true, force: true });
    // Same parent directory, so both renames are atomic: readers never see a
    // partial set, and complete.json is written at its final location.
    writeFileSync(join(staging, 'complete.json'), JSON.stringify({ key, dir: tarballs, tarballs: names }) + '\n');
    renameSync(staging, tarballs);
    assert.ok(readComplete(tarballs, key), 'shared pack verifies after promotion');
    process.stderr.write(`shared-pack-candidates: packed ${tarballs}\n`);
    return tarballs;
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
