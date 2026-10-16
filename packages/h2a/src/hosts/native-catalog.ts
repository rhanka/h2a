import { readFileSync } from 'node:fs';
export interface CatalogEntry { host: string; name: string; sha256: string; package: string; version: string; integrity: string; renderer: string; }
export interface NativeCatalog { schema: 1; through: string; unavailable: string[]; coverage: Record<string, string[]>; entries: CatalogEntry[]; }
let cached: NativeCatalog | undefined;
export function nativeCatalog(): NativeCatalog {
  if (!cached) {
    cached = JSON.parse(readFileSync(new URL('../../fixtures/native-host-catalog.json', import.meta.url), 'utf8')) as NativeCatalog;
    if (cached.schema !== 1 || !Array.isArray(cached.entries)) throw new Error('native adoption catalog incompatible');
  }
  return cached;
}
export function historicalSkillHashes(host: string, name: string): readonly string[] {
  return nativeCatalog().entries.filter(e => e.host === host && e.name === name).map(e => e.sha256);
}
