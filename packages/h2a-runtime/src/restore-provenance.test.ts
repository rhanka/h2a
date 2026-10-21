import { describe, expect, it } from "vitest";
import { registrySessions } from "./restore.js";
import type { RegistryEntry } from "./registry.js";

const home = "/private/incident-fixture";
const evidence = { home, liveTmuxSessions: [] };
const at = new Date().toISOString();
function row(id: string, extra: Partial<RegistryEntry> = {}): RegistryEntry {
  return { id, label: id, tool: "codex", kind: "local-native", cwd: `${home}/src/project`,
    convId: id, source: "run", sessionClass: "human", enrolledAt: at, lastSeenAt: at, ...extra };
}

describe("incident restore provenance", () => {
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
