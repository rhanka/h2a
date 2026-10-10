import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** A fixed conversation path; never searches for the latest modified transcript. */
export function claudeTranscriptPath(workspace: string, conversation: string): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects",
    workspace.replace(/[^a-zA-Z0-9]/g, "-"), `${conversation}.jsonl`);
}

function transcriptLines(path: string, fromOffset: number): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r"); const stat = fstatSync(fd);
    if (fromOffset < 0 || stat.size < fromOffset || stat.size - fromOffset > 16 * 1024 * 1024) return [];
    const buffer = Buffer.alloc(stat.size - fromOffset);
    const read = readSync(fd, buffer, 0, buffer.length, fromOffset);
    const lines = buffer.subarray(0, read).toString("utf8").split("\n");
    lines.pop(); return lines;
  } catch { return []; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function userText(row: Record<string, unknown>): string | undefined {
  const message = row.message as { content?: unknown } | undefined;
  return typeof message?.content === "string" ? message.content : Array.isArray(message?.content)
    ? message.content.filter((part: { type?: string }) => part.type === "text").map((part: { text?: string }) => part.text ?? "").join("") : undefined;
}
export function correlatedClaudePrompt(path: string, conversation: string, prompt: string, fromOffset = 0): boolean {
  let found = false;
  for (const line of transcriptLines(path, fromOffset)) {
    try {
      const row = JSON.parse(line);
      if (row.sessionId !== conversation || row.isSidechain === true || row.isMeta === true || row.type !== "user") continue;
      if (typeof row.uuid !== "string" || userText(row) !== prompt || found) return false;
      found = true;
    } catch { return false; }
  }
  return found;
}
export function correlatedClaudeResponse(path: string, conversation: string, prompt: string, fromOffset = 0): boolean {
  const lines = transcriptLines(path, fromOffset);
  const users = new Set<string>(), replies: Array<{ parent: string; content: unknown }> = [];
  const parents = new Map<string, { parent?: string; type: string }>();
  for (const line of lines) {
    let row: Record<string, unknown>;
    try { row = JSON.parse(line); } catch { return false; }
    if (row.sessionId !== conversation || row.isSidechain === true || row.isMeta === true) continue;
    if (typeof row.uuid === "string" && ["user", "assistant", "attachment", "system", "progress"].includes(String(row.type)))
      parents.set(row.uuid, { type: String(row.type), ...(typeof row.parentUuid === "string" ? { parent: row.parentUuid } : {}) });
    const message = row.message as { content?: unknown; role?: string } | undefined;
    if (!message) continue;
    if (row.type === "user" && typeof row.uuid === "string") {
      const content = userText(row);
      if (content === prompt) users.add(row.uuid);
    } else if (row.type === "assistant" && message.role === "assistant" && typeof row.parentUuid === "string") {
      replies.push({ parent: row.parentUuid, content: message.content });
    }
  }
  return replies.some(reply => {
    let parent: string | undefined = reply.parent;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (users.has(parent)) return Array.isArray(reply.content) && reply.content.some((part: { type?: string; text?: string }) =>
        part.type === "tool_use" || (part.type === "text" && Boolean(part.text)));
      visited.add(parent);
      const node = parents.get(parent);
      if (!node || node.type === "user") return false; // Another prompt starts a different turn.
      parent = node.parent;
    }
    return false;
  });
}
