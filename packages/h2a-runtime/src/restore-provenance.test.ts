import { describe, expect, it } from "vitest";
import { deriveLegacySessionClass, registrySessions } from "./restore.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryEntry } from "./registry.js";

const home = "/private/incident-fixture";
const evidence = { home, liveTmuxSessions: [] };
const at = new Date().toISOString();
function row(id: string, extra: Partial<RegistryEntry> = {}): RegistryEntry {
  return { id, label: id, tool: "codex", kind: "local-native", cwd: `${home}/src/project`,
    convId: id, source: "run", sessionClass: "human", enrolledAt: at, lastSeenAt: at, ...extra };
}

describe("incident restore provenance", () => {
  it("should never classify a legacy agent as human merely because its transcript exists (#382)", () => {
    const privateHome = mkdtempSync(join(tmpdir(), "legacy-provenance-"));
    try {
      const sessions = join(privateHome, ".codex/sessions"); mkdirSync(sessions, { recursive: true });
      const entry = row("ordinary-name", { sessionClass: undefined, cwd: join(privateHome, "src/project") });
      writeFileSync(join(sessions, "rollout-agent.jsonl"), JSON.stringify({ type: "session_meta", payload: { id: entry.convId, cwd: entry.cwd } }) + "\n");
      expect(deriveLegacySessionClass(entry, { home: privateHome, liveTmuxSessions: [] })).toBe("background");
      expect(registrySessions(privateHome, [entry], undefined, { home: privateHome, liveTmuxSessions: [] })).toEqual([]);
    } finally { rmSync(privateHome, { recursive: true, force: true }); }
  });
  it("should exclude 450 delegated rows while preserving an owner session with wt in its name", () => {
    const provenance: Partial<RegistryEntry>[] = [
      { delegationOrigin: "mcp:h2a_run" }, { delegatorInstance: "conductor" },
      { delegatorTmuxSession: "h2a-conductor" }, { parent: "parent-session" },
      { role: "job", sessionClass: "background" },
    ];
    const entries = Array.from({ length: 450 }, (_, i) => row(`agent-${i}`, {
      cwd: `${home}/src/bpmn-moddle-py/tmp/worktrees/seal-${i}`,
      ...provenance[i % provenance.length],
    }));
    entries.push(row("owner-wt-not-a-heuristic"));
    expect(registrySessions(home, entries, undefined, evidence).map(session => session.label))
      .toEqual(["owner-wt-not-a-heuristic"]);
  });

  it("should accept an explicitly confirmed legacy owner row", () => {
    expect(registrySessions(home, [row("confirmed", { sessionClass: undefined })], undefined,
      { ...evidence, humanConfirmedIds: new Set(["confirmed"]) })).toHaveLength(1);
  });
});
