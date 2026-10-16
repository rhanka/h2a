import { homedir } from 'node:os';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { snapshot } from './native-files.js';
import { parseNativeToml } from './native-toml.js';
export function inspectVibeDiscovery(root: string, cwd: string, config: Record<string, any>) {
  const expand = (path: string) => resolve(cwd, path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
  const paths = [...new Set([join(root, 'skills'), join(homedir(), '.agents/skills'), join(cwd, '.vibe/skills'), join(cwd, '.agents/skills'),
    ...(Array.isArray(config.skill_paths) ? config.skill_paths.filter((p: unknown): p is string => typeof p === 'string').map(expand) : [])])];
  const sources: Record<string, string[]> = {};
  const unavailable: string[] = [];
  for (const path of paths) {
    try {
      for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) {
        const file = join(path, entry.name, 'SKILL.md');
        if (snapshot(file)) (sources[entry.name] ??= []).push(file);
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') unavailable.push(path); }
  }
  const projectHooks = join(cwd, '.vibe/hooks.toml');
  const managedNames = ['sentropic-h2a-deny-manual-cli', 'h2a-drumbeat-record'];
  const file = resolve(projectHooks) === resolve(root, 'hooks.toml') ? undefined : snapshot(projectHooks);
  const maskingHooks = file ? (parseNativeToml(file.bytes.toString()).hooks ?? []).filter((h: any) => managedNames.includes(h.name)).map((h: any) => h.name) : [];
  return { paths, collisions: Object.entries(sources).filter(([, files]) => files.length > 1).map(([name, files]) => ({ name, files })),
    maskingHooks, unavailable, plugins: 'Plugin skill resolution requires native skills/list; configuration inspection is not qualification.' };
}
