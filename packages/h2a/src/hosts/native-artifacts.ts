import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicNativeWrite, assertNativePath, digest, jsonBytes, nativeRelativePath, normalizeNativeManifest, readNativeManifest, snapshot } from './native-files.js';
import type { NativeManifest } from './native-files.js';
import { recoverNativeHooks } from './native-toml.js';
export interface NativeArtifact { path: string; bytes: string | Buffer; source: string; selected?: boolean; historical?: readonly string[]; }
export interface NativeChanges { changed: string[]; adopted: string[]; conflicts: string[]; missing: string[]; planned: string[]; }
export function convergeArtifacts(options: {
  state: string; root: string; host: string; version: string; artifacts: readonly NativeArtifact[];
  repair: boolean; dryRun?: boolean; configure?: (manifest: NativeManifest) => void;
  manifestName?: string; force?: boolean;
  finalize?: () => void;
}): { manifest: NativeManifest; changes: NativeChanges } {
  const { state, root, host, version } = options;
  assertNativePath(state);
  const changes: NativeChanges = { changed: [], adopted: [], conflicts: [], missing: [], planned: [] };
  let locked = false;
  const lockPath = join(state, 'writer.lock');
  if (options.repair && !options.dryRun) {
    mkdirSync(state, { recursive: true, mode: 0o700 });
    try { closeSync(openSync(lockPath, 'wx', 0o600)); locked = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Native writer lock exists: ' + lockPath + '. Confirm that the writer has stopped before manually removing only this lock; pending.json is preserved for recovery.');
      throw error;
    }
  }
  try {
    const manifestPath = join(state, options.manifestName ?? 'manifest.json');
    const original = snapshot(manifestPath);
    const manifest = readNativeManifest(state, host, root, version, options.manifestName);
    const pendingPath = join(state, 'pending.json');
    const pending = snapshot(pendingPath);
    if (pending) {
      const recovery = normalizeNativeManifest(JSON.parse(pending.bytes.toString()), host, root);
      if (host === 'vibe') recoverNativeHooks(manifest, recovery, snapshot(join(root, 'hooks.toml'))?.bytes.toString() ?? '');
      for (const artifact of options.artifacts) {
        const key = nativeRelativePath(root, artifact.path), entry = recovery.files[key];
        if (entry?.sha256 === digest(artifact.bytes) && snapshot(artifact.path)?.bytes.equals(Buffer.from(artifact.bytes)))
          manifest.files[key] = entry;
      }
    }
    const writes: { artifact: NativeArtifact; previous: ReturnType<typeof snapshot> }[] = [];
    for (const artifact of options.artifacts) {
      const key = nativeRelativePath(root, artifact.path);
      const previous = snapshot(artifact.path);
      const owned = manifest.files[key];
      if (artifact.selected === false || owned?.selected === false) continue;
      const hash = previous && digest(previous.bytes);
      if (previous && (owned ? hash !== owned.sha256 && !options.force : !artifact.historical?.includes(hash!))) {
        changes.conflicts.push(artifact.path); continue;
      }
      if (previous && !owned) changes.adopted.push(artifact.path);
      if (!previous && owned) changes.missing.push(artifact.path);
      if (!previous || !previous.bytes.equals(Buffer.from(artifact.bytes))) {
        changes.planned.push(artifact.path); writes.push({ artifact, previous });
      }
      manifest.files[key] = { sha256: digest(artifact.bytes), source: artifact.source, selected: true };
    }
    const desired = new Set(options.artifacts.map(a => nativeRelativePath(root, a.path)));
    const removals: { path: string; previous: ReturnType<typeof snapshot> }[] = [];
    for (const [key, entry] of Object.entries(manifest.files)) {
      if (desired.has(key) || !entry.selected) continue;
      const path = join(root, key), previous = snapshot(path);
      // Force restores desired managed artifacts; it never authorizes deleting custom residues.
      if (previous && digest(previous.bytes) !== entry.sha256) { changes.conflicts.push(path); continue; }
      if (previous) { changes.planned.push(path); removals.push({ path, previous }); }
      delete manifest.files[key];
    }
    options.configure?.(manifest);
    manifest.version = version;
    if (options.repair && !options.dryRun) {
      const needsJournal = writes.length > 0 || removals.length > 0 || !original?.bytes.equals(Buffer.from(jsonBytes(manifest)));
      if (needsJournal) atomicNativeWrite(pendingPath, jsonBytes(manifest), { state });
      for (const { artifact, previous } of writes) {
        atomicNativeWrite(artifact.path, artifact.bytes, { state, expected: previous });
        changes.changed.push(artifact.path);
      }
      for (const { path, previous } of removals) {
        atomicNativeWrite(path, undefined, { state, expected: previous }); changes.changed.push(path);
      }
      options.finalize?.();
      atomicNativeWrite(manifestPath, jsonBytes(manifest), { state, expected: original });
      if (pending || needsJournal) unlinkSync(pendingPath);
    }
    return { manifest, changes };
  } finally { if (locked) unlinkSync(lockPath); }
}
