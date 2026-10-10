import { openSync, readSync, fstatSync, closeSync, existsSync } from "node:fs";

export type ClaudeDebugAnalysis = {
  connectedMcps: Set<string>;
  promptSubmitSettled: boolean;
  turnStartObserved: boolean;
  mainThreadDispatched: boolean;
  titleDispatched: boolean;
  hookVeto: boolean;
  error?: string;
};

export const CLAUDE_DEBUG_MAX_BYTES = 16 * 1024 * 1024; // 16 Mio max

export function parseClaudeDebugEvents(content: string): ClaudeDebugAnalysis {
  const connectedMcps = new Set<string>();
  let promptSubmitSettled = false;
  let turnStartObserved = false;
  let mainThreadDispatched = false;
  let titleDispatched = false;
  let hookVeto = false;

  const lines = content.split("\n");
  for (const line of lines) {
    // MCP connection detection
    const mcpMatch = line.match(/MCP server "([^"]+)": Successfully connected/);
    if (mcpMatch?.[1]) {
      connectedMcps.add(mcpMatch[1]);
    }

    // Prompt submit hook settling
    if (/prompt\.submit settled/i.test(line)) {
      promptSubmitSettled = true;
    }

    // Hook rejection / veto
    if (/(?:hook|hooks)[\s\S]*?(?:veto|rejected|failed|refused|exit [1-9])/i.test(line)) {
      hookVeto = true;
    }

    // Turn start
    if (/\[engine\] turn \d+ start/i.test(line)) {
      turnStartObserved = true;
    }

    // API request dispatch
    const apiMatch = line.match(/\[API REQUEST\] \/v1\/messages source=([A-Za-z0-9_]+)/);
    if (apiMatch?.[1]) {
      const source = apiMatch[1];
      if (source === "generate_session_title") {
        titleDispatched = true;
      } else if (source === "repl_main_thread") {
        mainThreadDispatched = true;
      }
    }
  }

  return {
    connectedMcps,
    promptSubmitSettled,
    turnStartObserved,
    mainThreadDispatched,
    titleDispatched,
    hookVeto,
  };
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
