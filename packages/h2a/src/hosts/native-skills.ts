import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertNativePath } from './native-files.js';
import type { NativeArtifact } from './native-artifacts.js';
import { parseNativeToml } from './native-toml.js';
export interface NativeSkill {
  installName: string; raw: string; source: string; resourceDir: string;
  parsed: { name: string; description: string; body: string };
}
export function nativeSkillArtifacts(options: {
  host: string; root: string; version: string; skills: readonly NativeSkill[];
  enabled?: readonly string[]; disabled?: readonly string[]; project?: boolean;
  renderGemini: (skill: NativeSkill['parsed']) => string;
  historicalHashes: (host: string, name: string) => readonly string[];
}): NativeArtifact[] {
  const result: NativeArtifact[] = [];
  for (const skill of options.skills) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(skill.installName)) throw new Error('unsafe skill name');
    const selected = !options.disabled?.includes(skill.installName) && (!options.enabled?.length || options.enabled.includes(skill.installName));
    const gemini = options.host === 'agy' || options.host === 'gemini';
    const target = gemini ? join(options.root, 'commands', `${skill.installName}.toml`) : join(options.root, 'skills', skill.installName, 'SKILL.md');
    const resources = gemini ? join(options.root, options.project ? 'skill-resources' : '.h2a-install/skill-resources', skill.source, options.version, skill.installName) : join(options.root, 'skills', skill.installName);
    for (const reference of skill.raw.match(/\bassets\/[\w./-]+/g) ?? []) {
      if (reference.split('/').includes('..') || !existsSync(join(skill.resourceDir, reference))) throw new Error(`required skill resource missing: ${skill.installName}/${reference}`);
    }
    const walk = (dir: string, relative = '') => {
      assertNativePath(dir);
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'SKILL.md' && !relative) continue;
        const rel = join(relative, entry.name), path = join(dir, entry.name);
        assertNativePath(path);
        if (entry.isDirectory()) walk(path, rel);
        else if (entry.isFile()) result.push({ path: join(resources, rel), bytes: readFileSync(path), source: `${skill.source}@${options.version}/${skill.installName}/${rel}`, selected });
        else throw new Error(`unsupported skill resource: ${path}`);
      }
    };
    walk(skill.resourceDir);
    let parsed = skill.parsed;
    if (gemini) parsed = { ...parsed, body: parsed.body.replace(/\bassets\//g, `${resources}/assets/`) };
    let rendered = gemini ? options.renderGemini(parsed) : skill.raw;
    if (gemini) {
      const expected = `You are the ${parsed.name} custom command for Gemini CLI.\n\n${parsed.body}`;
      try {
        const value = parseNativeToml(rendered);
        if (Object.keys(value).sort().join(',') !== 'description,prompt' || value.description !== parsed.description || value.prompt?.trimEnd() !== expected.trimEnd()) throw new Error('unsafe literal');
      } catch {
        // Native resource paths can contain triple apostrophes. Keep the
        // historical renderer/catalog intact; use a validated basic string.
        rendered = `description = ${JSON.stringify(parsed.description)}\nprompt = ${JSON.stringify(expected)}\n`;
        parseNativeToml(rendered);
      }
    }
    result.push({ path: target, bytes: rendered, source: `${skill.source}@${options.version}/${skill.installName}`, selected, historical: options.historicalHashes(options.host, skill.installName) });
  }
  return result;
}
