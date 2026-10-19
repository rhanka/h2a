import fs from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

// npm command assessment (§8.7 diagnostics): classify the current command
// path without mutating anything. A missing link reports an uninstall, a
// managed or legacy link reports its owner, a foreign or dangling link
// reports diagnosis with its actual target, and a plain-file occupant
// reports force-required (npm EEXIST semantics: never silently replaced).
// The installer (C2b-2b) and unmanage (D-1) consume this classification.
export function assessNpmCommand(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('npm_command_invalid');
  const { commandPath, managedLauncher, legacyEntry } = envelope;
  for (const path of [commandPath, managedLauncher, legacyEntry]) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('npm_command_invalid');
  }
  let stat;
  try { stat = fs.lstatSync(commandPath); } catch { return Object.freeze({ state: 'missing', action: 'install' }); }
  if (stat.isSymbolicLink()) {
    const actual = resolve(dirname(commandPath), fs.readlinkSync(commandPath));
    if (actual === managedLauncher) return Object.freeze({ state: 'managed', action: 'none' });
    if (actual === legacyEntry) return Object.freeze({ state: 'legacy', action: 'adopt' });
    let dangling = false;
    try { fs.statSync(commandPath); } catch { dangling = true; }
    if (dangling) return Object.freeze({ state: 'dangling', action: 'diagnose', actual });
    return Object.freeze({ state: 'foreign', action: 'diagnose', actual });
  }
  if (stat.isFile()) return Object.freeze({ state: 'occupied', action: 'force-required', kind: 'file' });
  if (stat.isDirectory()) return Object.freeze({ state: 'occupied', action: 'force-required', kind: 'dir' });
  return Object.freeze({ state: 'occupied', action: 'force-required', kind: 'other' });
}
