/**
 * Minimal `[mcp_servers.<name>]` TOML editor for the Codex host config
 * (`config.toml`, dotted-table entries).
 *
 * Same discipline as `./vibe-toml.ts`: only the owned `h2a` table is
 * spliced line-wise; every other byte (comments, other tables, ordering)
 * is preserved verbatim. Layouts this editor cannot prove safe refuse with
 * `invalid_entry` instead of guessing — the operator then edits by hand.
 * Candidate bytes are always re-parsed as TOML before publication, so JSON
 * bytes can never land in a `.toml` target.
 */
import { getStaticTOMLValue, parseForESLint } from "toml-eslint-parser";
import { RegistryError } from "./descriptors.js";

function fail(message: string): never {
  throw new RegistryError("invalid_entry", message);
}

/** Parse TOML or refuse with `invalid_entry` (never a raw parser stack). */
export function parseCodexToml(text: string): Record<string, unknown> {
  try {
    return getStaticTOMLValue(parseForESLint(text, { tomlVersion: "1.0.0" }).ast) as Record<string, unknown>;
  } catch (error) {
    fail(`codex config is not valid TOML: ${(error as Error)?.message ?? String(error)}`);
  }
}

export interface CodexServer {
  name: string;
  command?: string;
  args?: string[];
  startLine: number;
  endLine: number;
}

const DOTTED_TABLE = /^\s*\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*(#.*)?$/;
const ANY_TABLE = /^\s*\[[^\[].*$/;
const ARRAY_TABLE = /^\s*\[\[[^\]]+\]\]\s*(#.*)?$/;
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

interface ParsedTable {
  name: string;
  headerLine: number;
  lines: string[];
}

/** Line spans of `[mcp_servers.<name>]` tables; every other line is preserved verbatim. */
function collectTables(text: string): { tables: ParsedTable[]; inlineRefused: string | null } {
  const lines = text.split("\n");
  const tables: ParsedTable[] = [];
  let current: ParsedTable | null = null;
  let inlineRefused: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const dotted = DOTTED_TABLE.exec(line);
    if (dotted) {
      current = { name: dotted[1] as string, headerLine: i, lines: [] };
      tables.push(current);
      continue;
    }
    if (ARRAY_TABLE.exec(line) || ANY_TABLE.exec(line)) {
      current = null;
      continue;
    }
    if (current) {
      current.lines.push(line);
      continue;
    }
    const inline = /^\s*mcp_servers\s*=/.exec(line);
    if (inline) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      if (value !== "[]" && !value.startsWith("#")) inlineRefused = line;
    }
  }
  return { tables, inlineRefused };
}

function tableFields(table: ParsedTable): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  for (const line of table.lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const kv = KEY_VALUE.exec(line);
    if (!kv) fail(`unreadable line in [mcp_servers.${table.name}] table: ${line}`);
    const key = kv[1] as string;
    const raw = kv[2] as string;
    if (raw.trim().startsWith("[")) fields[key] = parseStringArray(raw);
    else if (/^(true|false|[0-9][0-9_.-]*)$/.test(raw.trim())) fields[key] = raw.trim();
    else fields[key] = parseStringLiteral(raw);
  }
  return fields;
}

export function readCodexServers(text: string): CodexServer[] {
  // Full-document validation first: a JSON-shaped config.toml is refused
  // here, before any edit is considered.
  parseCodexToml(text);
  const { tables, inlineRefused } = collectTables(text);
  if (inlineRefused) fail(`nonempty inline mcp_servers value cannot be safely edited: ${inlineRefused.trim()}`);
  return tables.map((table) => {
    const fields = tableFields(table);
    const server: CodexServer = { name: table.name, startLine: table.headerLine, endLine: table.headerLine + table.lines.length };
    if (typeof fields["command"] === "string") server.command = fields["command"];
    if (Array.isArray(fields["args"])) server.args = fields["args"];
    return server;
  });
}

const H2A_COMMAND = /(^|[\\/])h2a(\.cmd|\.exe)?$/i;

export function isH2aServerName(name: string): boolean {
  return name === "h2a" || /^h2a(?:[-_.]|$)/i.test(name);
}

/** Flags that mark a legacy direct entry as hand-owned (never normalized silently). */
const NON_DEFAULT_ARGS = ["--no-wake", "--name", "--instance", "--backend"];

export function legacyCodexDeviation(server: CodexServer): string | null {
  if (server.command === undefined || !H2A_COMMAND.test(server.command)) return "not an h2a-owned command";
  if (server.args === undefined || !server.args.includes("mcp-serve")) return "not a legacy direct entry";
  const foreign = server.args.filter((arg) => NON_DEFAULT_ARGS.includes(arg));
  if (foreign.length > 0) return `legacy h2a entry carries non-default flags ${foreign.join(", ")}`;
  return null;
}

export function isLegacyDirectServer(server: CodexServer): boolean {
  return legacyCodexDeviation(server) === null && (server.args ?? []).includes("mcp-serve");
}

export function isBridgeServer(server: CodexServer): boolean {
  return isH2aServerName(server.name) && (server.args ?? []).includes("registry-bridge");
}

export function renderCodexBridgeTable(command: string, args: string[]): string {
  return [
    "[mcp_servers.h2a]",
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(args)}`,
    ""
  ].join("\n");
}

/**
 * Replace the owned h2a table or append the bridge table. More than one
 * h2a table is a conflict (never merged silently). Returns the new text.
 */
export function upsertCodexH2a(text: string, command: string, args: string[]): { text: string; changed: boolean } {
  const servers = readCodexServers(text);
  const owned = servers.filter((server) => isH2aServerName(server.name));
  if (owned.length > 1) fail("duplicate h2a [mcp_servers.*] tables: resolve the conflict by hand");
  const wanted = renderCodexBridgeTable(command, args);
  const lines = text.split("\n");
  let candidate: string;
  if (owned.length === 0) {
    const separator = text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    candidate = `${text}${separator}${wanted}`;
  } else {
    const target = owned[0] as CodexServer;
    const current = lines.slice(target.startLine, target.endLine + 1).join("\n");
    if (current.trim() === wanted.trim()) return { text, changed: false };
    lines.splice(target.startLine, target.endLine - target.startLine + 1, ...wanted.trimEnd().split("\n"));
    candidate = lines.join("\n");
  }
  // Re-parse validation: JSON bytes (or any invalid TOML) can never be published.
  parseCodexToml(candidate);
  return { text: candidate, changed: true };
}

export function removeCodexH2a(text: string): { text: string; changed: boolean } {
  const servers = readCodexServers(text);
  const owned = servers.filter((server) => isH2aServerName(server.name));
  if (owned.length === 0) return { text, changed: false };
  const lines = text.split("\n");
  for (let i = owned.length - 1; i >= 0; i--) {
    const target = owned[i] as CodexServer;
    let end = target.endLine;
    while (end + 1 < lines.length && (lines[end + 1] as string).trim() === "") end++;
    lines.splice(target.startLine, end - target.startLine + 1);
  }
  const candidate = lines.join("\n");
  parseCodexToml(candidate);
  return { text: candidate, changed: true };
}
