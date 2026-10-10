import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { prepareClaudeMcpObservers, observedClaudeMcpTools } from "./claude-mcp-observer.js";

it("should require actual tools/list delivery, preserve server arguments, and reject foreign conversation ACKs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-observer-"));
  const config = join(dir, "config.json"), previous = process.env.H2A_CLAUDE_MCP_CONFIG;
  const server = join(dir, "fixture.cjs");
  writeFileSync(server, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);setTimeout(()=>console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='tools/list'?{tools:[{name:process.argv[2],inputSchema:{type:'object'}}]}:{capabilities:{tools:{}}}})),q.method==='tools/list'?200:0);});`);
  writeFileSync(config, JSON.stringify({ mcpServers: { playwright: { command: process.execPath, args: [server, "browser_test"] } } }));
  process.env.H2A_CLAUDE_MCP_CONFIG = config;
  const prepared = prepareClaudeMcpObservers(dir, dir, ["playwright"], "conversation", "nonce");
  expect(prepared).toBe(join(dir, "claude-mcp-config.json"));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/claude-mcp-observer.js", import.meta.url)), join(dir, "mcp-playwright.json")], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", data => { output += data; });
  try {
    child.stdin.write(JSON.stringify({ id: 1, method: "initialize" }) + "\n");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(observedClaudeMcpTools(dir, ["playwright"], "conversation", "nonce")).toBe(false);
    child.stdin.write(JSON.stringify({ id: 2, method: "tools/list" }) + "\n");
    const deadline = Date.now() + 2000;
    while (!observedClaudeMcpTools(dir, ["playwright"], "conversation", "nonce") && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 25));
    expect(observedClaudeMcpTools(dir, ["playwright"], "conversation", "nonce")).toBe(true);
    expect(observedClaudeMcpTools(dir, ["playwright"], "wrong", "nonce")).toBe(false);
    expect(JSON.parse(output.trim().split("\n").at(-1)!).result.tools[0].name).toBe("browser_test");
  } finally {
    child.stdin.end(); if (child.exitCode === null) await once(child, "close");
    if (previous === undefined) delete process.env.H2A_CLAUDE_MCP_CONFIG; else process.env.H2A_CLAUDE_MCP_CONFIG = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
