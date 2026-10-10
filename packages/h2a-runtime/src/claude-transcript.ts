import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** A fixed conversation path; never searches for the latest modified transcript. */
export function claudeTranscriptPath(workspace: string, conversation: string): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects",
    workspace.replace(/[^a-zA-Z0-9]/g, "-"), `${conversation}.jsonl`);
}

export function correlatedClaudeResponse(path: string, conversation: string, prompt: string, fromOffset = 0): boolean {
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  if (stat.size < fromOffset || stat.size > 16 * 1024 * 1024) return false;
  const text = readFileSync(path).subarray(fromOffset).toString("utf8");
  const lines = text.split("\n");
  lines.pop(); // A partial final line never constitutes a response.
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
      const content = typeof message.content === "string" ? message.content : Array.isArray(message.content)
        ? message.content.filter((part: { type?: string }) => part.type === "text").map((part: { text?: string }) => part.text ?? "").join("") : undefined;
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
