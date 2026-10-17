/**
 * Minimal `[[mcp_servers]]` TOML editor for the Vibe host config
 * (`~/.vibe/config.toml`, array-of-tables entries).
 *
 * No new runtime dependency: only the `[[mcp_servers]]` blocks are parsed
 * and spliced line-wise; every other byte (comments, other tables, ordering)
 * is preserved verbatim. Layouts this editor cannot prove safe refuse with
 * `invalid_entry` instead of guessing — the operator then edits by hand.
 */
import { RegistryError } from "./descriptors.js";

function fail(message: string): never {
  throw new RegistryError("invalid_entry", message);
}

export interface VibeServerBlock {
  name: string;
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  startLine: number;
  endLine: number;
}

const TABLE_HEADER = /^\s*\[\[([^\]]+)\]\]\s*(#.*)?$/;
const SINGLE_TABLE = /^\s*\[[^\[].*$/;
const KEY_VALUE = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(#.*)?$/;

function parseStringLiteral(literal: string): string {
  const text = literal.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.startsWith("'")) return text.slice(1, -1);
    try {
      return JSON.parse(text) as string;
    } catch {
      fail(`unreadable TOML string literal ${text}`);
    }
  }
  fail(`expected a TOML string literal, got ${text}`);
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseStringArray(value: string): string[] {
  const text = value.trim();
  if (!text.startsWith("[") || !text.endsWith("]")) fail(`expected a TOML string array, got ${text}`);
  const body = text.slice(1, -1).trim();
  if (body === "") return [];
  return splitTopLevelCommas(body).map((item) => parseStringLiteral(item));
}

interface ParsedBlock {
  headerLine: number;
  lines: string[];
}

function collectBlocks(text: string): { preamble: string[]; blocks: ParsedBlock[]; inlineRefused: string | null } {
  const lines = text.split("\n");
  const preamble: string[] = [];
  const blocks: ParsedBlock[] = [];
  let current: ParsedBlock | null = null;
  let inlineRefused: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const header = TABLE_HEADER.exec(line);
    if (header && (header[1] as string).trim() === "mcp_servers") {
      current = { headerLine: i, lines: [] };
      blocks.push(current);
      continue;
    }
    if (header || SINGLE_TABLE.exec(line)) {
      current = null;
      continue;
    }
    if (current) {
      current.lines.push(line);
      continue;
    }
    preamble.push(line);
    const inline = /^\s*mcp_servers\s*=/.exec(line);
    if (inline) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      if (value !== "[]" && !value.startsWith("#")) inlineRefused = line;
    }
  }
  void preamble;
  return { preamble, blocks, inlineRefused };
}

function blockFields(block: ParsedBlock): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  const lines = block.lines.join("\n");
  void lines;
  for (const line of block.lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const kv = KEY_VALUE.exec(line);
    if (!kv) fail(`unreadable line in [[mcp_servers]] block: ${line}`);
    const key = kv[1] as string;
    const raw = kv[2] as string;
    if (raw.trim().startsWith("[")) fields[key] = parseStringArray(raw);
    else if (/^(true|false|[0-9][0-9_.-]*)$/.test(raw.trim())) fields[key] = raw.trim();
    else fields[key] = parseStringLiteral(raw);
  }
  return fields;
}

export function readVibeServers(text: string): VibeServerBlock[] {
  const { blocks, inlineRefused } = collectBlocks(text);
  if (inlineRefused) fail(`nonempty inline mcp_servers array cannot be safely edited: ${inlineRefused.trim()}`);
  return blocks.map((block) => {
    const fields = blockFields(block);
    const name = fields["name"];
    if (typeof name !== "string") fail("every [[mcp_servers]] block must carry a string name");
    const server: VibeServerBlock = { name, startLine: block.headerLine, endLine: block.headerLine + block.lines.length };
    if (typeof fields["transport"] === "string") server.transport = fields["transport"];
    if (typeof fields["command"] === "string") server.command = fields["command"];
    if (Array.isArray(fields["args"])) server.args = fields["args"];
    if (typeof fields["url"] === "string") server.url = fields["url"];
    return server;
  });
}

const H2A_COMMAND = /(^|[\\/])h2a(\.cmd|\.exe)?$/i;

export function isH2aServerName(name: string): boolean {
  return name === "h2a" || /^h2a(?:[-_.]|$)/i.test(name);
}

export function isLegacyDirectServer(server: VibeServerBlock): boolean {
  if (!isH2aServerName(server.name)) return false;
  if (server.args !== undefined && server.args.includes("registry-bridge")) return false;
  return (
    (server.command !== undefined && H2A_COMMAND.test(server.command) &&
      server.args !== undefined && server.args.includes("mcp-serve")) ||
    (server.command === undefined && server.url === undefined && server.args !== undefined && server.args.includes("mcp-serve"))
  );
}

export function isBridgeServer(server: VibeServerBlock): boolean {
  return isH2aServerName(server.name) && (server.args ?? []).includes("registry-bridge");
}

export function renderVibeBridgeBlock(command: string, args: string[]): string {
  return [
    "[[mcp_servers]]",
    `name = "h2a"`,
    `transport = "stdio"`,
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(args)}`,
    ""
  ].join("\n");
}

/**
 * Replace the owned h2a block(s) or append the bridge block. More than one
 * h2a block is a conflict (never merged silently). Returns the new text.
 */
export function upsertVibeH2a(text: string, command: string, args: string[]): { text: string; changed: boolean; replacedH2a: boolean } {
  const servers = readVibeServers(text);
  const owned = servers.filter((server) => isH2aServerName(server.name));
  if (owned.length > 1) fail("duplicate h2a [[mcp_servers]] blocks: resolve the conflict by hand");
  const wanted = renderVibeBridgeBlock(command, args);
  const lines = text.split("\n");
  if (owned.length === 0) {
    const separator = text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return { text: `${text}${separator}${wanted}`, changed: true, replacedH2a: false };
  }
  const target = owned[0] as VibeServerBlock;
  const current = lines.slice(target.startLine, target.endLine + 1).join("\n");
  if (current.trim() === wanted.trim()) return { text, changed: false, replacedH2a: true };
  lines.splice(target.startLine, target.endLine - target.startLine + 1, ...wanted.trimEnd().split("\n"));
  return { text: lines.join("\n"), changed: true, replacedH2a: true };
}

export function removeVibeH2a(text: string): { text: string; changed: boolean; removed: string[] } {
  const servers = readVibeServers(text);
  const owned = servers.filter((server) => isH2aServerName(server.name));
  if (owned.length === 0) return { text, changed: false, removed: [] };
  const lines = text.split("\n");
  const removed: string[] = [];
  for (let i = owned.length - 1; i >= 0; i--) {
    const target = owned[i] as VibeServerBlock;
    removed.push(target.name);
    let end = target.endLine;
    while (end + 1 < lines.length && (lines[end + 1] as string).trim() === "") end++;
    lines.splice(target.startLine, end - target.startLine + 1);
  }
  return { text: lines.join("\n"), changed: true, removed };
}
