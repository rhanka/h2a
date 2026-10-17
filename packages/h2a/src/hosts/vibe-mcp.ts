import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { getStaticTOMLValue, parseForESLint } from 'toml-eslint-parser';
import { semanticDigest } from './native-toml.js';

export interface VibeMcpEntry {
  name: string;
  // Mandatory Vibe discriminator (vibe/core/config/models.py: MCPServer is a
  // Pydantic union discriminated on `transport` with no default): `stdio`
  // for a spawned command, `streamable-http` for a remote `url`. An entry
  // without it crashes vibe at startup (union_tag_not_found).
  transport: 'stdio' | 'streamable-http' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}

export const VIBE_MCP_REMOVAL_MARKER = 'vibe-mcp-direct-removed.json';

export const vibeDirectRemovalPath = (state: string): string =>
  ((): string => {
    const sep = state.endsWith('/') ? '' : '/';
    return `${state}${sep}${VIBE_MCP_REMOVAL_MARKER}`;
  })();

export function isVibeDirectRemoved(state: string): boolean {
  try {
    const raw = readFileSync(vibeDirectRemovalPath(state), 'utf8');
    const parsed = JSON.parse(raw) as { removed?: unknown };
    return parsed.removed === true;
  } catch {
    return false;
  }
}

export function setVibeDirectRemoved(state: string): void {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  writeFileSync(
    vibeDirectRemovalPath(state),
    JSON.stringify({ removed: true, at: new Date().toISOString() }, null, 2) + '\n',
    { mode: 0o600 }
  );
}

export function clearVibeDirectRemoved(state: string): void {
  try {
    unlinkSync(vibeDirectRemovalPath(state));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export const VIBE_MCP_NAME = 'h2a';

const isH2aCommand = (command: unknown): boolean =>
  typeof command === 'string' &&
  (command === 'h2a' || /[\\/]h2a(?:\.cmd|\.exe)?$/i.test(command));

export function isVibeH2aServer(server: unknown): boolean {
  if (!server || typeof server !== 'object' || Array.isArray(server)) return false;
  const entry = server as Record<string, unknown>;
  if (entry.name === VIBE_MCP_NAME) return true;
  if (typeof entry.name === 'string' && /^h2a(?:[-_.]|$)/i.test(entry.name)) return true;
  return (
    isH2aCommand(entry.command) &&
    Array.isArray(entry.args) &&
    (entry.args as unknown[]).includes('mcp-serve')
  );
}

export function renderVibeMcpEntry(entry: VibeMcpEntry): string {
  const lines = ['[[mcp_servers]]', `name = ${JSON.stringify(entry.name)}`];
  if (entry.url !== undefined) {
    lines.push(`transport = ${JSON.stringify(entry.transport ?? 'streamable-http')}`);
    lines.push(`url = ${JSON.stringify(entry.url)}`);
  } else {
    lines.push(`transport = ${JSON.stringify(entry.transport ?? 'stdio')}`);
    lines.push(`command = ${JSON.stringify(entry.command ?? 'h2a')}`);
    lines.push(`args = ${JSON.stringify(entry.args ?? ['mcp-serve'])}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Interim direct MCP writer for Vibe (`~/.vibe/config.toml`).
 *
 * Owner decision 16/10 ("Entree directe maintenant") overrides spec-astra-v9
 * section 4 / O7.2 (which forbade any Vibe MCP write) for the interim only.
 * Migration trigger: R5/R7 registry bootstrap ready -> remove this direct
 * entry (`h2a host setup --host vibe --remove`) and migrate to the
 * cluster-mesh registry path. A restored direct entry stays "non migree".
 */
export function editVibeMcpServers(
  text: string,
  wanted: VibeMcpEntry | null
): { text: string; changed: boolean; replacedH2a: boolean; removed: string[] } {
  const source = text;
  const ast = parseForESLint(source, { tomlVersion: '1.0.0' }).ast;
  const value = (
    source.trim().length === 0 ? {} : getStaticTOMLValue(ast)
  ) as Record<string, any>;
  const servers = value.mcp_servers ?? [];
  if (!Array.isArray(servers)) throw new Error('incompatible MCP collection');
  const nodes = (ast.body?.[0]?.body ?? []) as Array<any>;
  const tables = nodes.filter(
    (n) =>
      n.type === 'TOMLTable' &&
      n.kind === 'array' &&
      n.key.keys.length === 1 &&
      getStaticTOMLValue(n.key.keys[0]) === 'mcp_servers'
  );
  const assignment = nodes.find(
    (n) =>
      n.type === 'TOMLKeyValue' &&
      n.key.keys.length === 1 &&
      getStaticTOMLValue(n.key.keys[0]) === 'mcp_servers'
  );
  if (assignment && servers.length > 0) throw new Error('nonempty inline mcp_servers array cannot be safely edited');
  if (tables.length !== servers.length)
    throw new Error('unsupported mcp_servers table layout');

  const edits: { start: number; end: number; bytes: string }[] = [];
  const removed: string[] = [];
  let replacedH2a = false;
  let placed = false;

  // The digest covers the Vibe discriminator (`transport`) and the enabled
  // state (`disabled`): an entry missing `transport` or carrying
  // `disabled = true` never digests like the canonical wanted entry, so the
  // upsert path repairs it instead of keeping it.
  const entryDigest = (server: any): string => {
    const slim: Record<string, unknown> = { name: server.name };
    if (server.transport !== undefined) slim.transport = server.transport;
    if (server.url !== undefined) slim.url = server.url;
    if (server.command !== undefined) slim.command = server.command;
    if (server.args !== undefined) slim.args = server.args;
    if (server.disabled !== undefined) slim.disabled = server.disabled;
    return semanticDigest(slim);
  };

  if (wanted === null) {
    servers.forEach((server: any, index: number) => {
      if (!isVibeH2aServer(server)) return;
      removed.push(typeof server.name === 'string' ? server.name : `mcp_servers[${index}]`);
      replacedH2a = true;
      const node = tables[index];
      if (!node) throw new Error('unsupported mcp_servers table layout');
      const start = source[node.range[0] - 1] === '\n' ? node.range[0] - 1 : node.range[0];
      const end = source[node.range[1]] === '\n' ? node.range[1] + 1 : node.range[1];
      edits.push({ start, end, bytes: '' });
    });
  } else {
    const wantedDigest = semanticDigest(wanted);
    servers.forEach((server: any, index: number) => {
      if (!isVibeH2aServer(server)) return;
      if (!placed) {
        placed = true;
        if (entryDigest(server) !== wantedDigest) {
          replacedH2a = true;
          const node = tables[index];
          if (!node) throw new Error('unsupported mcp_servers table layout');
          edits.push({ start: node.range[0], end: node.range[1], bytes: renderVibeMcpEntry(wanted).trimEnd() });
        }
      } else {
        removed.push(typeof server.name === 'string' ? server.name : `mcp_servers[${index}]`);
        replacedH2a = true;
        const node = tables[index];
        if (!node) throw new Error('unsupported mcp_servers table layout');
        const start = source[node.range[0] - 1] === '\n' ? node.range[0] - 1 : node.range[0];
        const end = source[node.range[1]] === '\n' ? node.range[1] + 1 : node.range[1];
        edits.push({ start, end, bytes: '' });
      }
    });
    if (!placed) {
      if (assignment) edits.push({ start: (assignment as any).range[0], end: (assignment as any).range[1], bytes: '' });
      const prefix = source.length === 0 ? '' : '\n';
      edits.push({ start: source.length, end: source.length, bytes: `${prefix}${renderVibeMcpEntry(wanted).trimEnd()}\n` });
    } else if (assignment) {
      edits.push({ start: (assignment as any).range[0], end: (assignment as any).range[1], bytes: '' });
    }
  }

  if (edits.length === 0) return { text: source, changed: false, replacedH2a: false, removed: [] };
  let rendered = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    rendered = rendered.slice(0, edit.start) + edit.bytes + rendered.slice(edit.end);
  const after = (
    rendered.trim().length === 0 ? {} : getStaticTOMLValue(parseForESLint(rendered, { tomlVersion: '1.0.0' }).ast)
  ) as Record<string, any>;
  const strip = (v: Record<string, any>) => ({
    ...v,
    mcp_servers: ((v.mcp_servers ?? []) as any[]).filter((s: any) => !isVibeH2aServer(s))
  });
  if (semanticDigest(strip(value)) !== semanticDigest(strip(after))) throw new Error('third-party TOML changed');
  return { text: rendered, changed: true, replacedH2a, removed };
}
