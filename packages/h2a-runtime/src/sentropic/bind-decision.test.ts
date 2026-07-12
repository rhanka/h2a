import { describe, expect, it } from "vitest";

import {
  bindingKey,
  planBatch,
  planCreateOrBind,
  uploadRouteTarget,
  type Binding,
  type WorkspaceRef,
} from "./bind-decision.js";

const FP = "ws:aaaa";
const wsA: WorkspaceRef = { workspaceId: "swA", name: "proj", role: "admin" };
const wsMember: WorkspaceRef = { workspaceId: "swM", name: "proj", role: "member" };
const wsB: WorkspaceRef = { workspaceId: "swB", name: "other", role: "admin" };

describe("planCreateOrBind — auto path", () => {
  it("creates when no scoped binding exists (identity=fingerprint, name is only a suggestion)", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsA],
      existingBindings: [],
    });
    expect(plan).toEqual({ action: "create", fingerprint: FP, suggestedName: "proj" });
  });

  it("reports already-bound when exactly one scoped binding exists", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsA],
      existingBindings: [{ workspaceId: "swA", fingerprint: FP }],
    });
    expect(plan).toEqual({ action: "already-bound", fingerprint: FP, workspaceId: "swA" });
  });

  it("is ambiguous (never auto-picks) when multiple scoped bindings exist", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsA, wsB],
      existingBindings: [
        { workspaceId: "swA", fingerprint: FP },
        { workspaceId: "swB", fingerprint: FP },
      ],
    });
    expect(plan).toEqual({ action: "ambiguous", fingerprint: FP, candidates: ["swA", "swB"] });
  });

  it("IGNORES bindings outside the caller-authorized set (no global first-wins) → create", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsA],
      existingBindings: [{ workspaceId: "swOUTSIDE", fingerprint: FP }],
    });
    expect(plan.action).toBe("create");
  });
});

describe("planCreateOrBind — explicit --to (name ≠ identity, admin-gated)", () => {
  it("binds to an admin-role authorized target", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsA],
      existingBindings: [],
      explicitTo: "swA",
    });
    expect(plan).toEqual({ action: "bind", fingerprint: FP, workspaceId: "swA" });
  });

  it("refuses a non-admin target (viewer/member cannot bind)", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsMember],
      existingBindings: [],
      explicitTo: "swM",
    });
    expect(plan).toEqual({ action: "needs-admin", fingerprint: FP, workspaceId: "swM" });
  });

  it("refuses an explicit target the caller is not authorized to see (no adopt-by-name)", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsA],
      existingBindings: [],
      explicitTo: "swGHOST",
    });
    expect(plan).toEqual({ action: "unknown-target", fingerprint: FP, workspaceId: "swGHOST" });
  });

  it("is a no-op when the explicit target is already bound", () => {
    const plan = planCreateOrBind({
      fingerprint: FP,
      localName: "proj",
      authorizedWorkspaces: [wsA],
      existingBindings: [{ workspaceId: "swA", fingerprint: FP }],
      explicitTo: "swA",
    });
    expect(plan).toEqual({ action: "already-bound", fingerprint: FP, workspaceId: "swA" });
  });
});

describe("routing + batch", () => {
  it("uploads route by the (workspace, fingerprint) PAIR, not the fingerprint alone", () => {
    const b: Binding = { workspaceId: "swA", fingerprint: FP };
    expect(uploadRouteTarget(b)).toEqual({ workspaceId: "swA", fingerprint: FP });
    expect(bindingKey("swA", FP)).toBe("swA ws:aaaa");
  });

  it("planBatch returns one plan per workspace", () => {
    const plans = planBatch([
      { fingerprint: "ws:1", localName: "a", authorizedWorkspaces: [wsA], existingBindings: [] },
      {
        fingerprint: "ws:2",
        localName: "b",
        authorizedWorkspaces: [wsA],
        existingBindings: [{ workspaceId: "swA", fingerprint: "ws:2" }],
      },
    ]);
    expect(plans.map((p) => p.action)).toEqual(["create", "already-bound"]);
  });
});
