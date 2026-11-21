import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNativePath, digest, jsonBytes } from './native-files.js';
import type { NativeArtifact } from './native-artifacts.js';
import { historicalSkillHashes, nativeCatalog } from './native-catalog.js';
import { parseNativeToml } from './native-toml.js';
import { HARNESS_SKILLS } from '../vendor/harness/index.js';
export interface NativeSkill {
  installName: string; raw: string; source: string; resourceDir: string;
  parsed: { name: string; description: string; body: string };
  producer?: { package: string; version: string; path: string; sha256: string };
}

const TRACK_BIN_BOOTSTRAP_SH = `min_track_version="0.98.11"
track_bin=""
npm_global_root="$(npm root -g 2>/dev/null || true)"
track_version_ge() {
  case "$1" in [0-9]*.[0-9]*.[0-9]*) ;; *) return 1 ;; esac
  _cur="\${1%%-*}"
  _c1="\${_cur%%.*}"; _rest="\${_cur#*.}"; _c2="\${_rest%%.*}"; _c3="\${_rest#*.}"; _c3="\${_c3%%.*}"
  _m1="\${2%%.*}"; _mrest="\${2#*.}"; _m2="\${_mrest%%.*}"; _m3="\${_mrest#*.}"
  case "$_c1$_c2$_c3" in *[!0-9]*) return 1 ;; esac
  [ "$_c1" -gt "$_m1" ] && return 0
  [ "$_c1" -lt "$_m1" ] && return 1
  [ "$_c2" -gt "$_m2" ] && return 0
  [ "$_c2" -lt "$_m2" ] && return 1
  [ "$_c3" -ge "$_m3" ]
}
try_track_bin() {
  [ -n "$track_bin" ] && return 0
  [ -n "$1" ] && [ -f "$1" ] || return 1
  _abs="$(cd "$(dirname "$1")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$(basename "$1")")" || return 1
  _ver="$(node "$_abs" --version 2>/dev/null | head -n 1 | tr -d '\\r')" || return 1
  track_version_ge "$_ver" "$min_track_version" || return 1
  node "$_abs" report --help 2>/dev/null | grep -q -- '--owner-table' || return 1
  track_bin="$_abs"
}
cwd_abs="$(pwd -P)"
try_track_bin "\${TRACK_BIN:-}" || true
try_track_bin "$cwd_abs/packages/track/dist/cli/bin.js" || true
try_track_bin "$cwd_abs/node_modules/@sentropic/track/dist/cli/bin.js" || true
if [ -n "$npm_global_root" ]; then
  try_track_bin "$npm_global_root/@sentropic/track/dist/cli/bin.js" || true
fi
if [ -n "\${HOME:-}" ]; then
  try_track_bin "$HOME/.npm-global/lib/node_modules/@sentropic/track/dist/cli/bin.js" || true
  try_track_bin "$HOME/.local/lib/node_modules/@sentropic/track/dist/cli/bin.js" || true
  try_track_bin "$HOME/.local/share/h2a/upgrade/current/lib/node_modules/@sentropic/track/dist/cli/bin.js" || true
fi
if [ -n "$npm_global_root" ]; then
  try_track_bin "$npm_global_root/@sentropic/h2a/node_modules/@sentropic/track/dist/cli/bin.js" || true
fi
if [ -n "\${HOME:-}" ]; then
  try_track_bin "$HOME/.npm-global/lib/node_modules/@sentropic/h2a/node_modules/@sentropic/track/dist/cli/bin.js" || true
  try_track_bin "$HOME/.local/lib/node_modules/@sentropic/h2a/node_modules/@sentropic/track/dist/cli/bin.js" || true
  try_track_bin "$HOME/.local/share/h2a/upgrade/current/lib/node_modules/@sentropic/h2a/node_modules/@sentropic/track/dist/cli/bin.js" || true
fi
if [ -z "$track_bin" ]; then
  printf 'track binary >= %s with --owner-table not found (tried TRACK_BIN, packages/track/dist/cli/bin.js, node_modules/@sentropic/track/dist/cli/bin.js, global npm prefix, per-user home prefix, and @sentropic/track nested in global @sentropic/h2a; never falls back to bare track on PATH).\\n' "$min_track_version" >&2
  exit 1
fi`;

export const EXPECTED_TRACK_SLASH_COMMAND_MD = `---
description: Run Track commands from the repo root; serves the owner status table through a verified track binary and keeps contextual prose advisory.
argument-hint: report [--commit <ref>] | <track args...>
---

You are the Track slash command.

First resolve a verified \`track\` binary (\`>= 0.98.11\` with \`--owner-table\`) from the repository root without falling back to a bare \`track\` on \`PATH\`:

\`\`\`sh
${TRACK_BIN_BOOTSTRAP_SH}
\`\`\`

If \`$ARGUMENTS\` is empty or starts with \`report\`, serve the owner table from the repository root:

\`\`\`sh
node "$track_bin" report --owner-table --format md
\`\`\`

If the user supplied \`report --commit <ref>\`, pass \`--commit <ref>\`. For any other
arguments, run \`node "$track_bin" $ARGUMENTS\` from the repository root.

When returning a report/status, paste the deterministic output verbatim inside a fenced \`text\` code block.
Do not claim it is AI-prepared or adapter-backed. A contextual summary is advisory agent behaviour: state its
period, focus, and lane/model inputs, and say when any of those inputs are unavailable.
`;

export const EXPECTED_TRACK_SLASH_COMMAND_TOML = `description = "Run Track commands from the repo root; serves the owner status table through a verified track binary and keeps contextual prose advisory"
prompt = '''
You are the Track custom command.

First resolve a verified \`track\` binary (\`>= 0.98.11\` with \`--owner-table\`) from the repository root without falling back to a bare \`track\` on \`PATH\`:

\`\`\`sh
${TRACK_BIN_BOOTSTRAP_SH}
\`\`\`

If the argument is empty or starts with \`report\`, serve the owner table from the repository root:

\`\`\`sh
node "$track_bin" report --owner-table --format md
\`\`\`

If the user supplied \`report --commit <ref>\`, pass \`--commit <ref>\`. For any other
arguments, run \`node "$track_bin" <arguments>\` from the repository root.

When returning a report/status, paste the deterministic output verbatim inside a fenced \`text\` code block.
Do not claim it is AI-prepared or adapter-backed. A contextual summary is advisory agent behaviour: state its
period, focus, and lane/model inputs, and say when any of those inputs are unavailable.
'''
`;

export interface TrackSlashCommandTarget {
  readonly path: string;
  readonly relPath: string;
  readonly expected: string;
}

export function trackSlashCommandTarget(host: string, root: string): TrackSlashCommandTarget | undefined {
  if (host === 'claude') return { path: join(root, 'commands', 'track.md'), relPath: 'commands/track.md', expected: EXPECTED_TRACK_SLASH_COMMAND_MD };
  if (host === 'codex') return { path: join(root, 'prompts', 'track.md'), relPath: 'prompts/track.md', expected: EXPECTED_TRACK_SLASH_COMMAND_MD };
  if (host === 'gemini' || host === 'agy') return { path: join(root, 'commands', 'track.toml'), relPath: 'commands/track.toml', expected: EXPECTED_TRACK_SLASH_COMMAND_TOML };
  return undefined;
}

export function historicalHashesForHostSkill(host: string, skillName: string): readonly string[] {
  if (host === 'claude' || host === 'codex') {
    const entries = nativeCatalog().entries.filter(
      (e) => (e.host === 'muse' || e.host === 'vibe') && e.name === skillName
    );
    return [...new Set(entries.map((e) => e.sha256))];
  }
  return historicalSkillHashes(host, skillName);
}

export function historicalTrackCommandHashes(host: string, relPath: string): readonly string[] {
  const entries = nativeCatalog().entries.filter(
    (e) => (e.name === 'track' || e.name === relPath) && (e.host === host || (host === 'claude' || host === 'codex') && (e.host === 'claude' || e.host === 'codex'))
  );
  return [...new Set(entries.map((e) => e.sha256))];
}

/**
 * Earlier track-report skill names recorded in the historical catalogue, read
 * dynamically from the catalogue rather than hand-written.
 */
export function historicalTrackReportLegacyNames(): readonly string[] {
  const names = new Set<string>();
  for (const entry of nativeCatalog().entries) {
    if (entry.name.includes('track-report') && entry.name !== 'harness-track-report') {
      names.add(entry.name);
    }
  }
  return [...names].sort();
}

function parseRawSkill(raw: string): { name: string; description: string; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(raw);
  if (!match) return undefined;
  const fm: Record<string, string> = {};
  let currentKey: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      fm[currentKey] = kv[2].trim().replace(/^["']|["']$/g, '');
    } else if (currentKey && /^\s+/.test(line)) {
      fm[currentKey] = `${fm[currentKey]} ${line.trim()}`;
    }
  }
  if (!fm.name || !fm.description) return undefined;
  return { name: fm.name, description: fm.description, body: match[2].trimStart() };
}

function resolvePkgSkillsDir(pkgName: string): { dir?: string; version?: string } {
  const resolver = (import.meta as unknown as { resolve?: (specifier: string) => string }).resolve;
  let mainFile: string | undefined;
  if (typeof resolver === 'function') {
    try { mainFile = fileURLToPath(resolver(pkgName)); } catch { mainFile = undefined; }
  }
  if (!mainFile) {
    try { mainFile = createRequire(import.meta.url).resolve(pkgName); } catch { return {}; }
  }
  let dir = dirname(mainFile);
  for (let depth = 0; depth < 8; depth++) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        const pkg = JSON.parse(readFileSync(pj, 'utf8'));
        if (pkg.name === pkgName) {
          const skillsDir = join(dir, 'skills');
          return { dir: existsSync(skillsDir) ? skillsDir : undefined, version: typeof pkg.version === 'string' ? pkg.version : undefined };
        }
      } catch { /* keep walking */ }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

/**
 * Collect the current raw SKILL.md bundle (`h2a`, `track`, `harness`, optional `engram`)
 * for direct-root hosts (`claude`, `codex`) so doctor inspection and repair share the
 * exact same expected bytes as `install-skills`.
 */
export function collectExpectedDirectHostSkills(): NativeSkill[] {
  const skillsRoot = fileURLToPath(new URL('../../skills', import.meta.url));
  const result: NativeSkill[] = [];
  const addFromDir = (dir: string | undefined, source: string, names?: readonly string[], rename?: (n: string) => string) => {
    if (!dir || !existsSync(dir)) return;
    const list = names ?? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    for (const dirName of list) {
      const file = join(dir, dirName, 'SKILL.md');
      if (!existsSync(file)) continue;
      let raw = readFileSync(file, 'utf8');
      const parsed = parseRawSkill(raw);
      if (!parsed) continue;
      const installName = rename ? rename(dirName) : parsed.name;
      if (installName !== parsed.name) {
        raw = raw.replace(/^(name:[ \t]*).*$/m, `$1${installName}`);
      }
      result.push({
        installName,
        raw,
        source,
        resourceDir: join(dir, dirName),
        parsed: { ...parsed, name: installName }
      });
    }
  };
  addFromDir(skillsRoot, 'h2a');
  addFromDir(resolvePkgSkillsDir('@sentropic/track').dir, 'track');
  addFromDir(join(skillsRoot, 'harness'), 'harness', HARNESS_SKILLS.map((s) => s.name), (n) => `harness-${n}`);
  const engram = resolvePkgSkillsDir('@sentropic/engram');
  if (engram.dir && engram.version) {
    const file = join(engram.dir, 'engram-memory', 'SKILL.md');
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8');
      const parsed = parseRawSkill(raw);
      if (parsed && parsed.name === 'engram-memory') {
        result.push({
          installName: 'engram-memory',
          raw,
          source: 'engram',
          resourceDir: join(engram.dir, 'engram-memory'),
          parsed,
          producer: { package: '@sentropic/engram', version: engram.version, path: 'skills/engram-memory/SKILL.md', sha256: digest(raw) }
        });
      }
    }
  }
  return result;
}

export interface DirectHostConvergenceResult {
  readonly installed: string[];
  readonly skipped: Array<{ name: string; path?: string; reason: string }>;
  readonly prunedCommands: Array<{ name: string; path: string }>;
}

/**
 * Shared convergence helper for direct-root hosts (`claude`, `codex`):
 * writes missing/historical skills, preserves unknown content, and purges
 * stale `/track` commands only when their digest is in the historical catalogue.
 */
export function convergeDirectHostSkillsAndCommand(options: {
  host: string;
  root: string;
  project?: boolean;
  version: string;
  skills: readonly NativeSkill[];
  renderGemini: (skill: NativeSkill['parsed']) => string;
  force?: boolean;
  dryRun?: boolean;
  checkTrackCommand?: boolean;
}): DirectHostConvergenceResult {
  const installed: string[] = [];
  const skipped: Array<{ name: string; path?: string; reason: string }> = [];
  const prunedCommands: Array<{ name: string; path: string }> = [];
  for (const skill of options.skills) {
    const skillName = skill.installName;
    const artifacts = nativeSkillArtifacts({
      host: options.host,
      root: options.root,
      project: options.project,
      version: options.version,
      skills: [skill],
      renderGemini: options.renderGemini,
      historicalHashes: (h, name) => historicalHashesForHostSkill(h, name)
    });
    const isConflict = (artifact: NativeArtifact): boolean => {
      assertNativePath(artifact.path);
      if (!existsSync(artifact.path)) return false;
      const current = readFileSync(artifact.path);
      if (current.equals(Buffer.from(artifact.bytes))) return false;
      if (artifact.historical?.includes(digest(current))) return false;
      return options.force !== true;
    };
    const producerConflicts = skill.producer ? artifacts.filter(isConflict) : [];
    if (producerConflicts.length) {
      for (const artifact of producerConflicts) {
        skipped.push({ name: skillName, path: artifact.path, reason: `${artifact.path} already exists (use --force to overwrite)` });
      }
      continue;
    }
    for (const artifact of artifacts) {
      assertNativePath(artifact.path);
      if (existsSync(artifact.path)) {
        const current = readFileSync(artifact.path);
        if (current.equals(Buffer.from(artifact.bytes))) continue;
        const knownHistorical = artifact.historical?.includes(digest(current)) === true;
        if (!knownHistorical && options.force !== true) {
          skipped.push({ name: skillName, path: artifact.path, reason: `${artifact.path} already exists (use --force to overwrite)` });
          if (skill.producer) break;
          continue;
        }
      }
      if (!options.dryRun) {
        mkdirSync(dirname(artifact.path), { recursive: true });
        writeFileSync(artifact.path, artifact.bytes);
        if (skill.producer && !readFileSync(artifact.path).equals(Buffer.from(artifact.bytes))) {
          throw new Error(`installed bytes differ: ${artifact.path}`);
        }
      }
      installed.push(artifact.path);
    }
  }
  if (options.checkTrackCommand !== false) {
    const cmdTarget = trackSlashCommandTarget(options.host, options.root);
    if (cmdTarget && existsSync(cmdTarget.path)) {
      assertNativePath(cmdTarget.path);
      const current = readFileSync(cmdTarget.path);
      if (!current.equals(Buffer.from(cmdTarget.expected))) {
        const currentHash = digest(current);
        const knownHistorical = historicalTrackCommandHashes(options.host, cmdTarget.relPath).includes(currentHash);
        if (knownHistorical) {
          if (!options.dryRun) unlinkSync(cmdTarget.path);
          prunedCommands.push({ name: 'track', path: cmdTarget.path });
        } else {
          skipped.push({
            name: 'track',
            path: cmdTarget.path,
            reason: `${cmdTarget.path} is a stale /track command whose digest is not in the historical catalogue; preserved`
          });
        }
      }
    }
  }
  return { installed, skipped, prunedCommands };
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
    const version = skill.producer?.version ?? options.version;
    const source = `${skill.producer?.package ?? skill.source}@${version}/${skill.installName}`;
    const target = gemini ? join(options.root, 'commands', `${skill.installName}.toml`) : join(options.root, 'skills', skill.installName, 'SKILL.md');
    const resources = gemini ? join(options.root, options.project ? 'skill-resources' : '.h2a-install/skill-resources', skill.source, version, skill.installName) : join(options.root, 'skills', skill.installName);
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
        else if (entry.isFile()) result.push({ path: join(resources, rel), bytes: readFileSync(path), source: `${source}/${rel}`, selected, skillTarget: target });
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
        if (Object.keys(value).sort().join(',') !== 'description,prompt' || value.description !== parsed.description || value.prompt !== expected) throw new Error('unsafe literal');
      } catch {
        // Native resource paths can contain triple apostrophes. Keep the
        // historical renderer/catalog intact; use a validated basic string.
        rendered = `description = ${JSON.stringify(parsed.description)}\nprompt = ${JSON.stringify(expected)}\n`;
        parseNativeToml(rendered);
      }
    }
    result.push({ path: target, bytes: rendered, source, selected, historical: options.historicalHashes(options.host, skill.installName), skillTarget: target });
    if (skill.producer) result.push({ path: join(resources, '.h2a-source.json'),
      bytes: jsonBytes({ ...skill.producer, renderedSha256: digest(rendered) }), source: `${source}/.h2a-source.json`, selected, skillTarget: target });
  }
  return result;
}
