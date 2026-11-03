import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { assertBootstrapSessionUnchanged } from './bootstrap-session.js';
import { assessNpmCommand } from './npm-command.js';

// Conditional launcher installation (§8.6.5–6, §8.2): under the held
// bootstrap session, write the managed launcher with fixed modes, fsync
// file and directories, then swap the command link atomically (tmp symlink
// + rename) and verify the result. Any drift refuses before writing
// anything; the npm tree is never modified. An occupied, dangling or
// foreign command link refuses unless the operator explicitly overrides
// (`explicit: true`, recorded as `forced`); nothing else bypasses.
function syncDirectory(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function installManagedLauncher(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('bootstrap_launcher_install_invalid');
  const { session, launcherSource, managedDir, commandPath, explicit } = envelope;
  for (const path of [launcherSource, managedDir, commandPath]) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('bootstrap_launcher_install_invalid');
  }
  if (!session || typeof session !== 'object') throw new Error('bootstrap_launcher_install_invalid');
  if (explicit !== undefined && typeof explicit !== 'boolean') throw new Error('bootstrap_launcher_install_invalid');
  let parent;
  try {
    parent = dirname(commandPath);
    if (!fs.lstatSync(parent).isDirectory()) throw new Error('unusable');
  } catch { throw new Error('bootstrap_launcher_command_unusable'); }
  assertBootstrapSessionUnchanged(session);
  const launcherPath = join(managedDir, 'launcher', 'h2a.mjs');
  // The classifier compares the command link's target against the legacy
  // ENTRY (dist/bin.js), like every other assessNpmCommand caller (observers,
  // unmanage, mh-l6-npm fixtures). The link path itself can never equal its
  // own target, so passing evidence.commandPath made 'legacy' unreachable
  // and every non-explicit adoption threw foreign (LOT-1 amendment: the
  // automatic trigger could never converge).
  const legacyEntry = session.evidence?.entrypoint;
  if (typeof legacyEntry !== 'string' || !isAbsolute(legacyEntry)) throw new Error('bootstrap_launcher_install_invalid');
  const verdict = assessNpmCommand({ commandPath, managedLauncher: launcherPath, legacyEntry });
  const forced = explicit === true;
  if (!forced && verdict.state === 'occupied') throw new Error('bootstrap_launcher_command_occupied');
  if (!forced && verdict.state === 'dangling') throw new Error('bootstrap_launcher_command_dangling');
  if (!forced && verdict.state === 'foreign') throw new Error('bootstrap_launcher_command_foreign');
  let bytes;
  try {
    if (!fs.lstatSync(launcherSource).isFile()) throw new Error('unreadable');
    bytes = fs.readFileSync(launcherSource);
  } catch { throw new Error('bootstrap_launcher_source_invalid'); }
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const launcherDir = join(managedDir, 'launcher');
  fs.mkdirSync(launcherDir, { recursive: true, mode: 0o700 });
  syncDirectory(managedDir);
  fs.writeFileSync(launcherPath, bytes, { mode: 0o755 });
  const fd = fs.openSync(launcherPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(launcherDir);
  const tmp = join(parent, `.h2a-command-${process.pid}.tmp`);
  try { fs.unlinkSync(tmp); } catch {}
  fs.symlinkSync(launcherPath, tmp);
  fs.renameSync(tmp, commandPath);
  syncDirectory(parent);
  if (fs.readlinkSync(commandPath) !== launcherPath) throw new Error('bootstrap_launcher_link_unverified');
  return Object.freeze({ launcherPath, commandPath, digest, forced });
}
