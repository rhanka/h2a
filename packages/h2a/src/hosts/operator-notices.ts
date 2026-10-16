import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentCliVersion } from '../runtime/upgrade/index.js';
import { NATIVE_HOSTS, nativeRoot, stateRoot } from './native-paths.js';
import { inspectNativeHost } from './native-inspection.js';
import { digest, readNativeManifest } from './native-files.js';
// Refresh outside tool calls; h2a_identity_status remains an in-memory read.
export const HOST_UPDATE_NOTICE = 'Composants d’hôtes à actualiser : h2a doctor --repair';
export function captureHostOperatorNotices(): string[] {
  for (const host of NATIVE_HOSTS) {
    try {
      if (!inspectNativeHost(host).detected) continue;
      const root = nativeRoot(host);
      const manifests = [readNativeManifest(stateRoot(host, root), host === 'agy' ? 'gemini-commands' : host, root, '', host === 'agy' ? 'shared-owner.json' : 'manifest.json')];
      for (const manifest of manifests) {
      if (manifest.version !== currentCliVersion()) return [HOST_UPDATE_NOTICE];
      for (const [path, entry] of Object.entries(manifest.files ?? {}) as [string, { selected: boolean; sha256: string }][]) {
        if (entry.selected && digest(readFileSync(join(root, path))) !== entry.sha256) return [HOST_UPDATE_NOTICE];
      }
      }
    } catch { return [HOST_UPDATE_NOTICE]; }
  }
  return [];
}
