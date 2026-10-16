import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicNativeWrite, assertNativePath, digest, jsonBytes, readNativeManifest, snapshot } from './native-files.js';
import type { NativeManifest } from './native-files.js';
import { recoverNativeHooks } from './native-toml.js';
export interface NativeArtifact { path: string; bytes: string | Buffer; source: string; selected?: boolean; historical?: readonly string[]; }
export interface NativeChanges { changed: string[]; adopted: string[]; conflicts: string[]; missing: string[]; planned: string[]; }
export function convergeArtifacts(options: {
  state: string; root: string; host: string; version: string; artifacts: readonly NativeArtifact[];
  repair: boolean; dryRun?: boolean; configure?: (manifest: NativeManifest) => void;
  manifestName?: string;
  finalize?: () => void;
}): { manifest: NativeManifest; changes: NativeChanges } {
  const { state, root, host, version } = options;
  assertNativePath(state);
  const changes: NativeChanges = { changed: [], adopted: [], conflicts: [], missing: [], planned: [] };
  let locked = false;
  const lockPath = join(state, 'writer.lock');
  if (options.repair && !options.dryRun) {
    mkdirSync(state, { recursive: true, mode: 0o700 });
    closeSync(openSync(lockPath, 'wx', 0o600)); locked = true;
  }
  try {
    const manifestPath = join(state, options.manifestName ?? 'manifest.json');
    const original = snapshot(manifestPath);
    const manifest = readNativeManifest(state, host, root, version, options.manifestName);
    const pendingPath = join(state, 'pending.json');
    const pending = snapshot(pendingPath);
    if (pending) {
      const recovery = JSON.parse(pending.bytes.toString()) as NativeManifest;
      if (recovery.schema !== 1 || recovery.host !== host || recovery.root !== root || !recovery.files)
        throw new Error('incompatible interrupted installation; inspect pending.json');
      if (host === 'vibe') recoverNativeHooks(manifest, recovery, snapshot(join(root, 'hooks.toml'))?.bytes.toString() ?? '');
      for (const artifact of options.artifacts) {
        const entry = recovery.files[artifact.path];
        if (entry?.sha256 === digest(artifact.bytes) && snapshot(artifact.path)?.bytes.equals(Buffer.from(artifact.bytes)))
          manifest.files[artifact.path] = entry;
      }
    }
    const writes: { artifact: NativeArtifact; previous: ReturnType<typeof snapshot> }[] = [];
    for (const artifact of options.artifacts) {
      const previous = snapshot(artifact.path);
      const owned = manifest.files[artifact.path];
      if (artifact.selected === false || owned?.selected === false) continue;
      const hash = previous && digest(previous.bytes);
      if (previous && (owned ? hash !== owned.sha256 : !artifact.historical?.includes(hash!))) {
        changes.conflicts.push(artifact.path); continue;
      }
      if (previous && !owned) changes.adopted.push(artifact.path);
      if (!previous && owned) changes.missing.push(artifact.path);
      if (!previous || !previous.bytes.equals(Buffer.from(artifact.bytes))) {
        changes.planned.push(artifact.path); writes.push({ artifact, previous });
      }
      manifest.files[artifact.path] = { sha256: digest(artifact.bytes), source: artifact.source, selected: true };
    }
    options.configure?.(manifest);
    manifest.version = version;
    if (options.repair && !options.dryRun) {
      const needsJournal = writes.length > 0 || !original?.bytes.equals(Buffer.from(jsonBytes(manifest)));
      if (needsJournal) atomicNativeWrite(pendingPath, jsonBytes(manifest), { state });
      for (const { artifact, previous } of writes) {
        atomicNativeWrite(artifact.path, artifact.bytes, { state, expected: previous });
        changes.changed.push(artifact.path);
      }
      options.finalize?.();
      atomicNativeWrite(manifestPath, jsonBytes(manifest), { state, expected: original });
      if (pending || needsJournal) unlinkSync(pendingPath);
    }
    return { manifest, changes };
  } finally { if (locked) unlinkSync(lockPath); }
}
