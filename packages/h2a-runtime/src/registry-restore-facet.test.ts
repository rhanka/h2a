/**
 * Lot L5 RED — persisted restore facet (D12a): enrollment guard, provenance
 * preservation across resume/hook enrollment, one-time classification.
 *
 * Registry I/O goes to mkdtemp roots under the test run root (never owner
 * state, never the repo): this file stays green under the test sandbox.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  classifyRestoreFacet,
  enroll,
  hasDelegationProvenance,
  loadRegistry,
  persistRestoreFacets,
  type EnrollInput,
  type RegistryEntry,
} from "./registry.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function freshRegistryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "h2a-l5-reg-"));
  scratchDirs.push(dir);
  return join(dir, "registry.json");
}

function delegatedInput(id: string): EnrollInput {
  return {
    id,
    tool: "claude",
    kind: "local-tmux",
    cwd: "/tmp/fake/proj",
    source: "run",
    sessionClass: "human",
    delegationOrigin: "mcp:h2a_run",
    parent: "job-parent-1",
  };
}

function readEntry(path: string, id: string): RegistryEntry {
  const read = loadRegistry(path);
  if (read.state !== "ok") throw new Error("registry unreadable");
  const entry = read.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`missing entry ${id}`);
  return entry;
}

describe("lot L5 RED: persisted restore facet (D12a)", () => {
  it("should preserve delegation provenance across resume and hook enrollment", () => {
    const path = freshRegistryPath();
    enroll(delegatedInput("sess-1"), path);
    // A resume/hook re-enrollment that knows nothing of the delegation must
    // neither erase the provenance nor promote the row to primary.
    enroll(
      {
        id: "sess-1",
        tool: "claude",
        kind: "local-tmux",
        cwd: "/tmp/fake/proj",
        source: "hook",
        sessionClass: "human",
      },
      path,
    );
    const entry = readEntry(path, "sess-1");
    expect(entry.delegationOrigin).toBe("mcp:h2a_run");
    expect(entry.parent).toBe("job-parent-1");
    expect(entry.restoreFacet).toBe("secondary");
    expect(hasDelegationProvenance(entry)).toBe(true);
  });

  it("should refuse primary enrollment carrying delegation provenance", () => {
    const path = freshRegistryPath();
    expect(() =>
      enroll({ ...delegatedInput("sess-2"), restoreFacet: "primary" }, path),
    ).toThrow(/primary.*delegation|delegation.*primary/i);
    // Promoting an already-delegated row to primary is refused too.
    enroll(delegatedInput("sess-3"), path);
    expect(() =>
      enroll(
        {
          id: "sess-3",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/tmp/fake/proj",
          source: "run",
          sessionClass: "human",
          restoreFacet: "primary",
        },
        path,
      ),
    ).toThrow(/primary.*delegation|delegation.*primary/i);
  });

  it("should classify legacy rows once and never overwrite an explicit facet", () => {
    const path = freshRegistryPath();
    enroll(
      {
        id: "legacy-human",
        tool: "claude",
        kind: "local-tmux",
        cwd: "/tmp/fake/proj",
        source: "run",
        sessionClass: "human",
      },
      path,
    );
    // A legacy row predating the facet field classifies once to primary…
    const before = readEntry(path, "legacy-human");
    expect(before.restoreFacet).toBe("primary");
    // …and an explicit secondary is never overwritten by a later event.
    enroll(
      {
        id: "explicit-sec",
        tool: "codex",
        kind: "local-tmux",
        cwd: "/tmp/fake/proj",
        source: "run",
        sessionClass: "human",
        restoreFacet: "secondary",
      },
      path,
    );
    persistRestoreFacets(
      new Map([["explicit-sec", "primary"]]),
      { path },
    );
    expect(readEntry(path, "explicit-sec").restoreFacet).toBe("secondary");
    expect(
      classifyRestoreFacet(readEntry(path, "legacy-human")),
    ).toBe("primary");
  });
});
