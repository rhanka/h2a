import { getStaticTOMLValue, parseForESLint } from 'toml-eslint-parser';
import { digest } from './native-files.js';
import type { NativeManifest } from './native-files.js';
export type VibeHook = { name: string; type: string; command: string; timeout: number; match?: string; strict?: boolean };
export function parseNativeToml(text: string): Record<string, any> {
  return getStaticTOMLValue(parseForESLint(text, { tomlVersion: '1.0.0' }).ast) as Record<string, any>;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
};
export const semanticDigest = (value: unknown): string => digest(canonical(value));
export function recoverNativeHooks(manifest: NativeManifest, pending: NativeManifest, text: string): void {
  const actual = parseNativeToml(text).hooks ?? [];
  for (const hook of actual) if (pending.hooks?.[hook.name] === semanticDigest(hook)) {
    manifest.hooks = { ...manifest.hooks, [hook.name]: pending.hooks[hook.name] };
    if (hook.name === 'sentropic-h2a-deny-manual-cli') manifest.guard = pending.guard;
  }
  if (pending.lifecycle) manifest.lifecycle = { ...pending.lifecycle };
}
export function renderVibeHook(hook: VibeHook): string {
  return '[[hooks]]\n' + Object.entries(hook).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n') + '\n';
}
// Use parser ranges, never a regex approximation of TOML or rendered-TOML validation.
export function editVibeHooks(text: string, wanted: readonly VibeHook[], owned: Record<string, string>): { text: string; owned: Record<string, string> } {
  const ast = parseForESLint(text, { tomlVersion: '1.0.0' }).ast;
  const value = getStaticTOMLValue(ast) as Record<string, any>;
  const hooks = value.hooks ?? [];
  if (!Array.isArray(hooks)) throw new Error('incompatible hooks collection');
  const nodes = ast.body[0].body;
  const tables = nodes.filter(n => n.type === 'TOMLTable' && n.kind === 'array' && n.key.keys.length === 1 && getStaticTOMLValue(n.key.keys[0]) === 'hooks');
  const assignment = nodes.find(n => n.type === 'TOMLKeyValue' && n.key.keys.length === 1 && getStaticTOMLValue(n.key.keys[0]) === 'hooks');
  if (assignment && hooks.length) throw new Error('nonempty inline hooks array cannot be safely edited');
  const names = new Set([...Object.keys(owned), ...wanted.map(h => h.name)]);
  const edits: { start: number; end: number; bytes: string }[] = [];
  const nextOwned: Record<string, string> = {};
  const seen = new Set<string>();
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    if (!names.has(hook.name)) continue;
    if (seen.has(hook.name)) throw new Error(`duplicate hook: ${hook.name}`);
    seen.add(hook.name);
    if (!owned[hook.name]) throw new Error(`unknown hook ownership: ${hook.name}`);
    if (owned[hook.name] !== semanticDigest(hook)) throw new Error(`customized hook preserved: ${hook.name}`);
    const desired = wanted.find(h => h.name === hook.name);
    if (desired) nextOwned[hook.name] = semanticDigest(desired);
    if (!desired || semanticDigest(desired) !== semanticDigest(hook)) {
      const node = tables[i];
      if (!node) throw new Error('unsupported hook table layout');
      edits.push({ start: node.range[0], end: node.range[1], bytes: desired ? renderVibeHook(desired).trimEnd() : '' });
    }
  }
  for (const hook of wanted) {
    nextOwned[hook.name] = semanticDigest(hook);
    if (!seen.has(hook.name)) edits.push({ start: text.length, end: text.length, bytes: '\n' + renderVibeHook(hook) });
  }
  if (assignment && wanted.length) edits.push({ start: assignment.range[0], end: assignment.range[1], bytes: '' });
  let rendered = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) rendered = rendered.slice(0, edit.start) + edit.bytes + rendered.slice(edit.end);
  const after = parseNativeToml(rendered);
  const thirds = (v: Record<string, any>) => ({ ...v, hooks: (v.hooks ?? []).filter((h: any) => !names.has(h.name)) });
  if (canonical(thirds(value)) !== canonical(thirds(after))) throw new Error('third-party TOML changed');
  return { text: rendered, owned: nextOwned };
}
