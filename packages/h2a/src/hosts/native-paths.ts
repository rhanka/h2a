import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
export const NATIVE_HOSTS = ['vibe', 'muse', 'agy'] as const;
export type NativeHost = typeof NATIVE_HOSTS[number];
export const isNativeHost = (host: string): host is NativeHost => NATIVE_HOSTS.includes(host as NativeHost);
export function vibeHome(home = homedir(), env = process.env): string {
  const root = env.VIBE_HOME?.trim() || join(home, '.vibe');
  return resolve(root === '~' ? home : root.startsWith('~/') ? join(home, root.slice(2)) : root);
}
export function nativeRoot(host: NativeHost, home = homedir()): string {
  return host === 'vibe' ? vibeHome(home) : host === 'muse' ? join(home, '.config/muse') : join(home, '.gemini');
}
export function stateRoot(host: NativeHost, root = nativeRoot(host)): string {
  return join(root, host === 'agy' ? '.h2a-install-agy' : '.h2a-install');
}
export const REGISTRY_WAITING = 'non migré — bootstrap registre attendu';
export const MISSING_VIBE_MCP = 'Skills installées, outils MCP absents — bootstrap registre attendu';
export const VIBE_RESTART = 'Nouvelle session ou reprise propre (session au repos, journal vide). Une reprise après interruption conserve les anciens bindings.';
export const VIBE_LIFECYCLE_SCOPE = 'Profil dédié à une seule session parente non forkée, sans isolation automatique démontrée. ' +
  'Sous-agent ou fork: aucun record. /branch et fork ACP: copie inactive dès sa reprise; session/fork attache la copie par défaut dès sa création. ' +
  'L’origine continue d’enregistrer. vibe -c peut reprendre la copie la plus récente; utiliser vibe --resume <id-origine> ou une nouvelle session non forkée.';
