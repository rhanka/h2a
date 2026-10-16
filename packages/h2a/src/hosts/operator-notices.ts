import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentCliVersion } from '../runtime/upgrade/index.js';
import { NATIVE_HOSTS, nativeRoot, stateRoot } from './native-paths.js';
import { inspectNativeHost } from './native-inspection.js';
// Refresh outside tool calls; h2a_identity_status remains an in-memory read.
export const HOST_UPDATE_NOTICE = 'Composants d’hôtes à actualiser : h2a doctor --repair';
export function captureHostOperatorNotices(): string[] {
  for (const host of NATIVE_HOSTS) {
    try {
      if (!inspectNativeHost(host).detected) continue;
      const manifest = JSON.parse(readFileSync(join(stateRoot(host, nativeRoot(host)), 'manifest.json'), 'utf8'));
      if (manifest.version !== currentCliVersion()) return [HOST_UPDATE_NOTICE];
    } catch { return [HOST_UPDATE_NOTICE]; }
  }
  return [];
}
