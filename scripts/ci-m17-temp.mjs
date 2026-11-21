// A private, bounded data volume on the disposable GitHub runner only.
// Lot L0 (D16 / N3): setup creates host run root H and mounts exclusive tmpfs
// H/m17, storing receipts in host control directory C outside H. cleanup
// verifies real unmount and deletes H and the active reservation while leaving
// C's cleanup receipt for `ci-m17-proof.mjs finalize`.
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseMountInfo } from './test-sandbox-contract.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || process.platform !== 'linux') {
  throw Error('m17_volume_requires_disposable_github_runner');
}
const base = fs.realpathSync(process.env.RUNNER_TEMP);
const activePointer = join(base, 'h2a-m17-active.json');
const finalizePointer = join(base, 'h2a-m17-finalize.json');
const magic = 0x01021994;

function assertPrivateDir(dir, prefix) {
  const info = fs.lstatSync(dir);
  if (
    !dir.startsWith(prefix) ||
    fs.realpathSync(dir) !== dir ||
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    (info.mode & 0o777) !== 0o700
  ) {
    throw Error('m17_volume_not_owned');
  }
  return info;
}

function isMountedTmpfs(mountPoint) {
  const mounts = parseMountInfo(fs.readFileSync('/proc/self/mountinfo', 'utf8'));
  return mounts.some((m) => resolve(m.mountPoint) === resolve(mountPoint) && m.fsType === 'tmpfs');
}

if (process.argv[2] === 'setup') {
  if (fs.existsSync(activePointer)) throw Error('m17_volume_already_recorded');
  if (!process.env.GITHUB_ENV) throw Error('m17_volume_missing_workflow_environment');
  const nonce = randomBytes(24).toString('hex');
  const controlDir = fs.mkdtempSync(join(base, 'h2a-m17-ctrl-'));
  const hostRoot = fs.mkdtempSync(join(base, 'h2a-m17-host-'));
  fs.chmodSync(controlDir, 0o700);
  fs.chmodSync(hostRoot, 0o700);
  const volumePath = join(hostRoot, 'm17');
  fs.mkdirSync(volumePath, { mode: 0o700 });
  let mounted = false;
  try {
    assertPrivateDir(controlDir, base + '/h2a-m17-ctrl-');
    assertPrivateDir(hostRoot, base + '/h2a-m17-host-');
    assertPrivateDir(volumePath, hostRoot + '/');
    execFileSync(
      'sudo',
      ['mount', '-t', 'tmpfs', '-o', `size=1G,mode=0700,uid=${process.getuid()},gid=${process.getgid()},nodev,nosuid,noexec`, 'tmpfs', volumePath],
      { stdio: 'inherit' },
    );
    mounted = true;
    const info = assertPrivateDir(volumePath, hostRoot + '/');
    const volume = fs.statfsSync(volumePath);
    if (volume.type !== magic || volume.bavail * volume.bsize < 512 * 1024 * 1024 || !isMountedTmpfs(volumePath)) {
      throw Error('m17_volume_not_qualified');
    }
    const witness = {
      version: 1,
      nonce,
      controlDir,
      hostRoot,
      volumePath,
      root: volumePath,
      dev: info.dev,
      ino: info.ino,
      uid: info.uid,
      type: volume.type,
      capacityBytes: volume.blocks * volume.bsize,
      job: process.env.GITHUB_JOB ?? '',
      runId: process.env.GITHUB_RUN_ID ?? '',
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
      node: process.version,
    };
    fs.writeFileSync(join(controlDir, 'setup-receipt.json'), JSON.stringify(witness) + '\n', { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(activePointer, JSON.stringify({ controlDir, hostRoot, volumePath, nonce }) + '\n', { flag: 'wx', mode: 0o600 });
    fs.appendFileSync(process.env.GITHUB_ENV, `H2A_TEST_M17_TMPDIR=${volumePath}\n`);
    console.log('M17 private tmpfs ready: ' + JSON.stringify(witness));
  } catch (error) {
    if (mounted) {
      try { execFileSync('sudo', ['umount', volumePath], { stdio: 'inherit' }); } catch { /* best effort */ }
    }
    fs.rmSync(hostRoot, { recursive: true, force: true });
    fs.rmSync(controlDir, { recursive: true, force: true });
    fs.rmSync(activePointer, { force: true });
    throw error;
  }
} else if (process.argv[2] === 'cleanup') {
  const pointer = JSON.parse(fs.readFileSync(activePointer, 'utf8'));
  const controlDir = pointer.controlDir;
  assertPrivateDir(controlDir, base + '/h2a-m17-ctrl-');
  const witness = JSON.parse(fs.readFileSync(join(controlDir, 'setup-receipt.json'), 'utf8'));
  assertPrivateDir(witness.hostRoot, base + '/h2a-m17-host-');
  const info = assertPrivateDir(witness.volumePath, witness.hostRoot + '/');
  if (
    process.env.H2A_TEST_M17_TMPDIR !== witness.volumePath ||
    info.dev !== witness.dev ||
    info.ino !== witness.ino ||
    fs.statfsSync(witness.volumePath).type !== magic ||
    !isMountedTmpfs(witness.volumePath)
  ) {
    throw Error('m17_volume_identity_changed');
  }
  const hasLeftovers = fs.readdirSync(witness.volumePath).length > 0;
  execFileSync('sudo', ['umount', witness.volumePath], { stdio: 'inherit' });
  if (isMountedTmpfs(witness.volumePath)) {
    throw Error('m17_volume_still_mounted_after_umount');
  }
  fs.rmdirSync(witness.volumePath);
  fs.rmSync(witness.hostRoot, { recursive: true, force: true });
  fs.unlinkSync(activePointer);
  if (hasLeftovers) {
    throw Error('m17_volume_has_unremoved_test_state');
  }
  const cleanupReceipt = {
    version: 1,
    nonce: witness.nonce,
    hostRoot: witness.hostRoot,
    volumePath: witness.volumePath,
    dev: witness.dev,
    ino: witness.ino,
    unmounted: true,
    hostRootRemoved: !fs.existsSync(witness.hostRoot),
  };
  fs.writeFileSync(join(controlDir, 'cleanup-receipt.json'), JSON.stringify(cleanupReceipt) + '\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(finalizePointer, JSON.stringify({ controlDir, nonce: witness.nonce }) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('M17 owned volume unmounted and removed: ' + witness.volumePath);
} else {
  throw Error('usage: node scripts/ci-m17-temp.mjs setup|cleanup');
}
