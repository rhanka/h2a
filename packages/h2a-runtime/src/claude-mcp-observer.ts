/** Session-private stdio observer: preserves server arguments and proves tools/list delivery. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

type Server = { command?: string; args?: string[]; env?: Record<string, string>; type?: string };
function birth(pid: number): string | undefined {
  try { const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]; }
  catch { return undefined; }
}
export function claudeMcpConfiguration(cwd: string): Record<string, Server> {
  let servers: Record<string, Server> = {};
  const explicit = process.env.H2A_CLAUDE_MCP_CONFIG;
  if (explicit) servers = JSON.parse(readFileSync(explicit, "utf8")).mcpServers ?? {};
  else {
    try { const config = JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json"), "utf8"));
      servers = { ...config.mcpServers, ...config.projects?.[cwd]?.mcpServers }; } catch { /* Project config can still supply the profile. */ }
    try { servers = { ...servers, ...JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8")).mcpServers }; } catch { /* Missing project config is normal. */ }
  }
  return servers;
}
export function prepareClaudeMcpObservers(directory: string, cwd: string, required: string[], conversation: string, nonce: string,
  servers = claudeMcpConfiguration(cwd)): string {
  const observed: Record<string, Server> = {};
  for (const name of required) {
    const server = servers[name];
    if (!server?.command || (server.type && server.type !== "stdio") || !Array.isArray(server.args ?? []))
      throw new Error(`required Claude MCP ${name} needs an explicit supported stdio configuration (H2A_CLAUDE_MCP_CONFIG)`);
    const spec = join(directory, `mcp-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    writeFileSync(spec, JSON.stringify({ server, name, conversation, nonce, ack: spec + ".ready" }), { mode: 0o600, flag: "wx" });
    observed[name] = { command: process.execPath, args: [fileURLToPath(new URL("./claude-mcp-observer.js", import.meta.url)), spec] };
  }
  const path = join(directory, "claude-mcp-config.json");
  writeFileSync(path, JSON.stringify({ mcpServers: observed }), { mode: 0o600, flag: "wx" });
  return path;
}
export function observedClaudeMcpTools(directory: string, names: string[], conversation: string, nonce: string): boolean {
  return names.every(name => {
    try {
      const ack = JSON.parse(readFileSync(join(directory, `mcp-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json.ready`), "utf8"));
      return ack.name === name && ack.conversation === conversation && ack.nonce === nonce && ack.tools > 0 && ack.start && birth(ack.pid) === ack.start;
    } catch { return false; }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
  rmSync(spec.ack, { force: true });
  const expand = (value: string) => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_match, name: string, fallback: string | undefined) => process.env[name] ?? fallback ?? "");
  const env = { ...process.env, ...Object.fromEntries(Object.entries(spec.server.env ?? {}).map(([key, value]) => [key, expand(String(value))])) };
  const child = spawn(expand(spec.server.command), (spec.server.args ?? []).map(expand), { env, stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map<string, string>();
  createInterface({ input: process.stdin }).on("line", line => {
    try { const message = JSON.parse(line); if (message.id !== undefined) pending.set(JSON.stringify(message.id), message.method); } catch { /* Forward unknown frames unchanged. */ }
    child.stdin.write(line + "\n");
  }).on("close", () => child.stdin.end());
  createInterface({ input: child.stdout }).on("line", line => {
    let tools: number | undefined;
    try {
      const response = JSON.parse(line), id = JSON.stringify(response.id);
      if (pending.get(id) === "tools/list" && !response.error && Array.isArray(response.result?.tools)) tools = response.result.tools.length;
      pending.delete(id);
    } catch { /* Unknown frames never authorize submission. */ }
    process.stdout.write(line + "\n", () => {
      if (!tools) return;
      const temporary = spec.ack + "." + process.pid + ".tmp";
      writeFileSync(temporary, JSON.stringify({ name: spec.name, conversation: spec.conversation, nonce: spec.nonce, tools, pid: process.pid, start: birth(process.pid) }), { mode: 0o600 });
      renameSync(temporary, spec.ack);
    });
  });
  child.on("error", () => { process.exitCode = 1; process.stdin.destroy(); });
  child.stdin.on("error", () => {});
  child.on("close", code => {
    try { if (JSON.parse(readFileSync(spec.ack, "utf8")).pid === process.pid) rmSync(spec.ack); } catch { /* A replacement owns its own ACK. */ }
    process.exitCode = code ?? 1; process.stdin.destroy();
  });
  // The server belongs to this observer. Do not leave it running after Claude disconnects.
  process.on("SIGTERM", () => { child.kill("SIGTERM"); });
}
