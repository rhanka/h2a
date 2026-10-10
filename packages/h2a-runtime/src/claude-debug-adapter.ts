import { openSync, readSync, fstatSync, closeSync, existsSync } from "node:fs";

export type ClaudeDebugAnalysis = {
  connectedMcps: Set<string>;
  capableMcps: Set<string>;
  events: Array<"hooks-settled" | "turn-start" | "main-dispatch">;
  promptSubmitSettled: boolean;
  turnStartObserved: boolean;
  mainThreadDispatched: boolean;
  titleDispatched: boolean;
  hookVeto: boolean;
  providerRefusal: boolean;
  error?: string;
};

export const CLAUDE_DEBUG_MAX_BYTES = 16 * 1024 * 1024; // 16 Mio max

export function parseClaudeDebugEvents(content: string): ClaudeDebugAnalysis {
  const connectedMcps = new Set<string>();
  const capableMcps = new Set<string>();
  const events: ClaudeDebugAnalysis["events"] = [];
  let promptSubmitSettled = false;
  let turnStartObserved = false;
  let mainThreadDispatched = false;
  let titleDispatched = false;
  let hookVeto = false;
  let providerRefusal = false;

  const lines = content.split("\n");
  for (const line of lines) {
    if (/\[ERROR\] API error \(attempt \d+\/\d+\): (?:401|403|429)\b/.test(line) ||
        /\[ERROR\] API error .*?(?:insufficient credits|quota exhausted)/i.test(line)) providerRefusal = true;
    // MCP connection detection
    const mcpMatch = line.match(/MCP server "([^"]+)": Successfully connected/);
    if (mcpMatch?.[1]) {
      connectedMcps.add(mcpMatch[1]);
    }
    const capability = line.match(/MCP server "([^"]+)": Connection established with capabilities: (\{.*\})/);
    if (capability?.[1] && capability[2]) {
      try { if (JSON.parse(capability[2]).hasTools === true) capableMcps.add(capability[1]); } catch { /* Unknown capabilities never prove readiness. */ }
    }

    // Prompt submit hook settling
    if (/prompt\.submit settled/i.test(line)) {
      promptSubmitSettled = true;
      events.push("hooks-settled");
    }

    // Hook rejection / veto
    if (/(?:hook|hooks)[\s\S]*?(?:veto|rejected|failed|refused|exit [1-9]|finished with status [1-9])/i.test(line)) {
      hookVeto = true;
    }

    // Turn start
    if (/\[engine\] turn \d+ start/i.test(line)) {
      turnStartObserved = true;
      events.push("turn-start");
    }

    // API request dispatch
    const apiMatch = line.match(/\[API REQUEST\] \/v1\/messages source=([A-Za-z0-9_]+)/);
    if (apiMatch?.[1]) {
      const source = apiMatch[1];
      if (source === "generate_session_title") {
        titleDispatched = true;
      } else if (source === "repl_main_thread") {
        mainThreadDispatched = true;
        events.push("main-dispatch");
      }
    }
  }

  return {
    connectedMcps,
    capableMcps,
    events,
    promptSubmitSettled,
    turnStartObserved,
    mainThreadDispatched,
    titleDispatched,
    hookVeto,
    providerRefusal,
  };
}

/** Keeps partial UTF-8 lines and fails closed on rotation, truncation or saturation. */
export class ClaudeDebugReader {
  private offset: number;
  private pending = Buffer.alloc(0);
  private identity: string | undefined;
  constructor(private readonly path: string, fromOffset = 0) { this.offset = fromOffset; }
  read(): { content: string; error?: string; more?: boolean } {
    let fd: number | undefined;
    try {
      fd = openSync(this.path, "r");
      const stat = fstatSync(fd), identity = `${stat.dev}:${stat.ino}`;
      if ((this.identity && this.identity !== identity) || stat.size < this.offset) return { content: "", error: "Claude diagnostic rotated or truncated" };
      this.identity = identity;
      if (stat.size >= CLAUDE_DEBUG_MAX_BYTES) return { content: "", error: "Claude diagnostic saturated" };
      const bytes = Math.min(stat.size - this.offset, 65536);
      const buffer = Buffer.alloc(bytes);
      const read = readSync(fd, buffer, 0, bytes, this.offset);
      this.offset += read;
      this.pending = Buffer.concat([this.pending, buffer.subarray(0, read)]);
      let lineStart = 0, newline = this.pending.indexOf(10);
      while (newline >= 0) {
        if (newline - lineStart + 1 > 65536) return { content: "", error: "Claude diagnostic line exceeds its budget" };
        lineStart = newline + 1;
        newline = this.pending.indexOf(10, lineStart);
      }
      if (this.pending.length - lineStart > 65536) return { content: "", error: "Claude diagnostic line exceeds its budget" };
      newline = lineStart - 1;
      if (newline < 0) return { content: "", ...(this.pending.length ? { more: true } : {}) };
      const content = this.pending.subarray(0, newline + 1).toString("utf8");
      this.pending = this.pending.subarray(newline + 1);
      return { content, ...(this.offset < stat.size || this.pending.length ? { more: true } : {}) };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" && !this.identity ? { content: "" }
        : { content: "", error: "Claude diagnostic unavailable" };
    } finally { if (fd !== undefined) closeSync(fd); }
  }
}

export function readClaudeDebugBounded(content: string, maxBytes = CLAUDE_DEBUG_MAX_BYTES): string {
  if (content.length <= maxBytes) return content;
  return content.slice(-maxBytes);
}

export function readClaudeDebugIncremental(
  filePath: string,
  fromOffset: number,
  maxBytes = CLAUDE_DEBUG_MAX_BYTES,
): { content: string; newOffset: number } {
  if (!existsSync(filePath)) {
    return { content: "", newOffset: fromOffset };
  }
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const stat = fstatSync(fd);
    if (stat.size <= fromOffset) {
      return { content: "", newOffset: fromOffset };
    }
    const bytesToRead = Math.min(stat.size - fromOffset, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const read = readSync(fd, buffer, 0, bytesToRead, fromOffset);
    return {
      content: buffer.toString("utf8", 0, read),
      newOffset: fromOffset + read,
    };
  } catch {
    return { content: "", newOffset: fromOffset };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}
