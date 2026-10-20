import { describe, expect, it } from "vitest";

import {
  deriveSessionFacet,
  decideInPlaceResume,
  matchInteractiveShell,
  matchRowConversation,
  primaryBinaryName,
  type HostProcessSnapshot,
  type SessionFacetRow,
} from "./launch-layout.js";

/**
 * Lot L1b RED — the foreground facet derives from HOST-SIDE foreground
 * evidence, never from client-side guesses. These tests use only the
 * long-standing `deriveSessionFacet` export: `hostProcesses` is ignored by
 * today's code, so every host-evidence assertion below fails until the
 * in-place decision lands.
 */
describe("lot L1b RED: foreground facet from host-side evidence", () => {
  const shellProcs = [
    { pid: 100, command: "bash", args: ["-l"], startedAtMs: 111, ppid: 50 },
  ];

  it("should expose a shell facet from host-side foreground evidence", () => {
    const row: SessionFacetRow = {
      session: "s",
      tool: "claude",
      hostProcesses: shellProcs,
    };
    expect(deriveSessionFacet(row)).toBe("shell");
  });

  it("should expose a live-agent-cli facet for a foreground CLI holding the row conversation", () => {
    const row: SessionFacetRow = {
      session: "s",
      tool: "claude",
      convId: "conv-1",
      hostProcesses: [
        {
          pid: 101,
          command: "claude",
          args: ["--resume", "conv-1"],
          startedAtMs: 222,
          ppid: 50,
        },
      ],
    };
    expect(deriveSessionFacet(row)).toBe("live-agent-cli");
  });

  it("should let host-side evidence override stale liveness bits (vim foreground is not a live CLI)", () => {
    const row: SessionFacetRow = {
      session: "s",
      tool: "claude",
      tmuxLive: true,
      hostProcesses: [
        { pid: 102, command: "vim", args: [], startedAtMs: 333, ppid: 50 },
      ],
    };
    expect(deriveSessionFacet(row)).toBe("unknown");
  });

  it("should stay unknown on an old host with no foreground evidence", () => {
    const row: SessionFacetRow = { session: "s", tool: "mystery-tool" };
    expect(deriveSessionFacet(row)).toBe("unknown");
  });

  it("should keep the registry-tool shell facet when no host data exists (L1a compat)", () => {
    const row: SessionFacetRow = { session: "s", tool: "bash" };
    expect(deriveSessionFacet(row)).toBe("shell");
  });

  it("should let host-side evidence override a stale tool bit (live shell beats registry claude)", () => {
    const row: SessionFacetRow = {
      session: "s",
      tool: "claude",
      hostProcesses: [
        { pid: 7, command: "bash", args: ["-l"], startedAtMs: 1, ppid: 1 },
      ],
    };
    expect(deriveSessionFacet(row)).toBe("shell");
  });

  it("should let a live CLI subtree override stale liveness bits (claude beats tmuxLive:false)", () => {
    const row: SessionFacetRow = {
      session: "s",
      tool: "claude",
      tmuxLive: false,
      convId: "conv-9",
      hostProcesses: [
        { pid: 9, command: "claude", args: ["--resume", "conv-9"], startedAtMs: 2, ppid: 1 },
      ],
    };
    expect(deriveSessionFacet(row)).toBe("live-agent-cli");
  });

  it("should stay unknown for an attached row with no foreground evidence", () => {
    const row: SessionFacetRow = { session: "s", attachLiveSinceMs: 99 };
    expect(deriveSessionFacet(row)).toBe("unknown");
  });
});

describe("matchRowConversation (lot L1b)", () => {
  const proc = (over: Partial<HostProcessSnapshot> & { pid: number }): HostProcessSnapshot => ({
    command: "claude",
    args: [],
    startedAtMs: over.pid,
    ppid: 1,
    ...over,
  });

  it("should match a single CLI holding the row conversation", () => {
    const p = proc({ pid: 1, args: ["--resume", "conv-1"] });
    expect(matchRowConversation({ convId: "conv-1" }, [p])).toBe(p);
  });

  it("should not match a CLI holding another conversation", () => {
    const p = proc({ pid: 1, args: ["--resume", "other"] });
    expect(matchRowConversation({ convId: "conv-1" }, [p])).toBeNull();
  });

  it("should attribute twin CLIs sharing one conversation to the eldest only", () => {
    const a = proc({ pid: 9, args: ["--resume", "conv-1"], startedAtMs: 9 });
    const b = proc({ pid: 3, args: ["--resume", "conv-1"], startedAtMs: 3 });
    expect(matchRowConversation({ convId: "conv-1" }, [a, b])).toBe(b);
  });

  it("should match the row conversation holder among two CLIs", () => {
    const holder = proc({ pid: 1, args: ["--resume", "conv-1"] });
    const other = proc({ pid: 2, args: ["--resume", "conv-2"] });
    expect(matchRowConversation({ convId: "conv-1" }, [holder, other])).toBe(holder);
  });

  it("should report ambiguity for two CLIs when the row names no conversation", () => {
    const procs = [
      proc({ pid: 1, args: ["--resume", "conv-1"] }),
      proc({ pid: 2, args: ["--resume", "conv-2"] }),
    ];
    expect(matchRowConversation({}, procs)).toBe("ambiguous");
  });

  it("should resolve a node-wrapped CLI through the interpreter", () => {
    const p = proc({ pid: 1, command: "node", args: ["node", "/x/claude", "--resume", "conv-1"] });
    expect(matchRowConversation({ convId: "conv-1" }, [p])).toBe(p);
  });

  it("should not match a bare tool name with no conversation in argv", () => {
    const p = proc({ pid: 1, args: [] });
    expect(matchRowConversation({ convId: "conv-1" }, [p])).toBeNull();
  });

  it("should attribute any single agent binary when the row names no conversation", () => {
    const p = proc({ pid: 1, args: ["--resume", "conv-z"] });
    expect(matchRowConversation({}, [p])).toBe(p);
  });
});

describe("matchInteractiveShell + primaryBinaryName (lot L1b)", () => {
  const proc = (over: Partial<HostProcessSnapshot> & { pid: number }): HostProcessSnapshot => ({
    command: "bash",
    args: [],
    startedAtMs: over.pid,
    ppid: 1,
    ...over,
  });

  it("should match a plain bash foreground", () => {
    expect(matchInteractiveShell([proc({ pid: 1, args: ["-l"] })])).not.toBeNull();
  });

  it("should never match bash -c (script runner, not an interactive shell)", () => {
    expect(matchInteractiveShell([proc({ pid: 1, args: ["-c", "x"] })])).toBeNull();
  });

  it("should not match vim (not a shell — unknown, never promoted)", () => {
    expect(matchInteractiveShell([proc({ pid: 1, command: "vim" })])).toBeNull();
  });

  it("should resolve interpreter-wrapped binaries structurally", () => {
    expect(primaryBinaryName({ command: "node", args: ["node", "/x/codex"] })).toBe("codex");
    expect(primaryBinaryName({ command: "python3", args: ["x"] })).toBe("python3");
    expect(primaryBinaryName({ command: "/usr/bin/bash", args: [] })).toBe("bash");
  });
});

describe("decideInPlaceResume (lot L1b)", () => {
  const cli = (convId: string, startedAtMs = 111): HostProcessSnapshot => ({
    pid: 4242,
    command: "claude",
    args: ["--resume", convId],
    startedAtMs,
    ppid: 100,
  });
  const shell = (pid = 7): HostProcessSnapshot => ({
    pid,
    command: "bash",
    args: ["-l"],
    startedAtMs: pid,
    ppid: 1,
  });

  it("should attach on a verified foreground CLI with its application incarnation", () => {
    const decision = decideInPlaceResume({
      session: "h2a-prim",
      convId: "conv-x",
      hostProcesses: [cli("conv-x", 111)],
    });
    expect(decision).toMatchObject({
      outcome: "attach",
      facet: "live-agent-cli",
      appIncarnation: 111,
    });
  });

  it("should defer a shell foreground as needs-adapter (never type)", () => {
    const decision = decideInPlaceResume({ session: "h2a-prim", hostProcesses: [shell()] });
    expect(decision).toMatchObject({
      outcome: "deferred",
      reason: "needs-adapter",
      facet: "shell",
    });
  });

  it("should refuse an ambiguous foreground instead of a second owner", () => {
    const decision = decideInPlaceResume({
      session: "s",
      hostProcesses: [cli("conv-1"), cli("conv-2")],
    });
    expect(decision).toMatchObject({ outcome: "refused", reason: "ambiguous-cli" });
  });

  it("should refuse an unknown foreground application", () => {
    const decision = decideInPlaceResume({
      session: "s",
      hostProcesses: [{ pid: 5, command: "vim", args: [], startedAtMs: 5, ppid: 1 }],
    });
    expect(decision).toMatchObject({ outcome: "refused", reason: "unknown-foreground" });
  });

  it("should return null without host evidence (old hosts keep L1a)", () => {
    expect(decideInPlaceResume({ session: "s" })).toBeNull();
  });
});
