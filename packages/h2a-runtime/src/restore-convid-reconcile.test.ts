import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  groupSessions,
  reconcileRunConvIds,
  registrySessions,
} from "./restore.js";
import {
  loadRegistry,
  persistReconciledConvIds,
  looksLikeConversationUuid,
  type RegistryEntry,
} from "./registry.js";
import { DEFAULT_LAYOUT } from "./config.js";

const HOME = "/home/u";

// Real claude conversation uuids (shape matters — restore refuses non-uuids).
const UUID = {
  llmMesh: "34ab1c0e-a625-4d10-a029-7e0d67ffb672",
  architect: "9a93d0f7-55a1-470c-9234-767263cb1e44",
  canevas: "42936d7a-c954-4fe8-ad02-70c60be42104",
} as const;

function runEntry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  const now = new Date().toISOString();
  return {
    id: "run-id",
    tool: "claude",
    kind: "local-tmux",
    cwd: join(HOME, "src", "sentropic"),
    source: "run",
    enrolledAt: now,
    lastSeenAt: now,
    sessionClass: "human",
    ...over,
  };
}

function hookEntry(convId: string, over: Partial<RegistryEntry> = {}): RegistryEntry {
  const now = new Date().toISOString();
  return {
    id: convId,
    tool: "claude",
    kind: "local",
    cwd: join(HOME, "src", "sentropic"),
    source: "hook",
    convId,
    enrolledAt: now,
    lastSeenAt: now,
    sessionClass: "human",
    ...over,
  };
}

/** customTitle stub: last-write-wins map keyed by "<cwd>\0<convId>". */
function titleReader(map: Record<string, string>) {
  return (cwd: string, convId: string): string | undefined => map[`${cwd}\x00${convId}`];
}

describe("looksLikeConversationUuid", () => {
  it("accepts a real uuid and rejects a label/slug", () => {
    expect(looksLikeConversationUuid(UUID.llmMesh)).toBe(true);
    expect(looksLikeConversationUuid("llm-mesh")).toBe(false);
    expect(looksLikeConversationUuid("mcp")).toBe(false);
    expect(looksLikeConversationUuid(undefined)).toBe(false);
  });
});

describe("reconcileRunConvIds — run↔hook join", () => {
  const cwd = join(HOME, "src", "sentropic");

  it("joins a run entry (convId===label) to the hook carrying the real uuid via customTitle", () => {
    const entries: RegistryEntry[] = [
      runEntry({ id: "llm-mesh", label: "llm-mesh", convId: "llm-mesh", tmuxSession: "h2a-llm-mesh" }),
      hookEntry(UUID.llmMesh),
    ];
    const r = reconcileRunConvIds(
      entries,
      titleReader({ [`${cwd}\x00${UUID.llmMesh}`]: "llm-mesh" }),
    );
    expect(r.resolvedSid.get("llm-mesh")).toBe(UUID.llmMesh);
    expect(r.claimedConvIds.has(UUID.llmMesh)).toBe(true);
    expect(r.unresolvedRunIds.size).toBe(0);
  });

  it("trusts a run entry that ALREADY carries a real uuid (captured at launch)", () => {
    const entries: RegistryEntry[] = [
      runEntry({ id: "architect", label: "architect", convId: UUID.architect }),
      hookEntry(UUID.architect),
    ];
    const r = reconcileRunConvIds(entries, titleReader({}));
    expect(r.resolvedSid.get("architect")).toBe(UUID.architect);
    // The hook twin of an already-resolved conversation is claimed too (dedup).
    expect(r.claimedConvIds.has(UUID.architect)).toBe(true);
  });

  it("marks a run entry UNRESOLVED when convId===label and no hook/customTitle matches", () => {
    const entries: RegistryEntry[] = [
      runEntry({ id: "mcp", label: "mcp", convId: "mcp" }),
    ];
    const r = reconcileRunConvIds(entries, titleReader({}));
    expect(r.unresolvedRunIds.has("mcp")).toBe(true);
    expect(r.resolvedSid.has("mcp")).toBe(false);
  });

  it("marks a claude run entry UNRESOLVED when its cwd HAS conversations but none match the label", () => {
    // `caneva` (typo) — convId "canevas" is neither a uuid nor a live conversation.
    const entries: RegistryEntry[] = [
      runEntry({ id: "caneva", label: "caneva", convId: "canevas" }),
      hookEntry(UUID.canevas, {}),
    ];
    const r = reconcileRunConvIds(
      entries,
      titleReader({ [`${cwd}\x00${UUID.canevas}`]: "canevas" }),
    );
    expect(r.unresolvedRunIds.has("caneva")).toBe(true);
  });

  it("does NOT reconcile delegated jobs / background launches", () => {
    const entries: RegistryEntry[] = [
      runEntry({ id: "job", label: "job", convId: "job", role: "job", jobState: "running", sessionClass: undefined }),
      runEntry({ id: "bg", label: "bg", convId: "bg", sessionClass: "background" }),
    ];
    const r = reconcileRunConvIds(entries, titleReader({}));
    expect(r.unresolvedRunIds.size).toBe(0);
    expect(r.resolvedSid.size).toBe(0);
  });
});

describe("registrySessions + reconciliation (restore behaviour)", () => {
  const cwd = join(HOME, "src", "sentropic");

  it("REPRO: run entry (convId===label) + hook (real uuid, same cwd) → session resumes on the real uuid", () => {
    const entries: RegistryEntry[] = [
      runEntry({ id: "llm-mesh", label: "llm-mesh", convId: "llm-mesh", tmuxSession: "h2a-llm-mesh" }),
      hookEntry(UUID.llmMesh),
    ];
    const resolution = reconcileRunConvIds(
      entries,
      titleReader({ [`${cwd}\x00${UUID.llmMesh}`]: "llm-mesh" }),
    );
    const sessions = registrySessions(HOME, entries, resolution);
    // Exactly ONE session (the hook twin is deduped), resuming on the real uuid.
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ label: "llm-mesh", sid: UUID.llmMesh, project: "sentropic" });
  });

  it("REGRESSION: THREE named sessions of the SAME repo are all preserved with DISTINCT real uuids", () => {
    const entries: RegistryEntry[] = [
      runEntry({ id: "llm-mesh", label: "llm-mesh", convId: "llm-mesh", tmuxSession: "h2a-llm-mesh" }),
      runEntry({ id: "architect", label: "architect", convId: "architect", tmuxSession: "h2a-architect" }),
      runEntry({ id: "canevas", label: "canevas", convId: "canevas", tmuxSession: "h2a-canevas" }),
      hookEntry(UUID.llmMesh),
      hookEntry(UUID.architect),
      hookEntry(UUID.canevas),
    ];
    const resolution = reconcileRunConvIds(
      entries,
      titleReader({
        [`${cwd}\x00${UUID.llmMesh}`]: "llm-mesh",
        [`${cwd}\x00${UUID.architect}`]: "architect",
        [`${cwd}\x00${UUID.canevas}`]: "canevas",
      }),
    );
    const sessions = registrySessions(HOME, entries, resolution);
    const { windows } = groupSessions(sessions, DEFAULT_LAYOUT);
    const tabs = windows.flatMap((w) => w.tabs);
    // All three named sessions survive (not collapsed under one repo path)…
    expect(tabs.map((t) => t.label).sort()).toEqual(["architect", "canevas", "llm-mesh"]);
    // …each with its OWN real conversation uuid.
    const byLabel = new Map(tabs.map((t) => [t.label, t.sid]));
    expect(byLabel.get("llm-mesh")).toBe(UUID.llmMesh);
    expect(byLabel.get("architect")).toBe(UUID.architect);
    expect(byLabel.get("canevas")).toBe(UUID.canevas);
    // No anonymous "sentropic" hook duplicates leaked through.
    expect(tabs.every((t) => t.label !== "sentropic")).toBe(true);
    // Every sid is a real uuid (no broken `--resume <label>`).
    expect(tabs.every((t) => looksLikeConversationUuid(t.sid))).toBe(true);
  });

  it("skips an unresolved run session from discovery (restore emits the note, not a broken resume)", () => {
    const entries: RegistryEntry[] = [
      runEntry({ id: "mcp", label: "mcp", convId: "mcp", tmuxSession: "remote-mcp" }),
    ];
    const resolution = reconcileRunConvIds(entries, titleReader({}));
    expect(registrySessions(HOME, entries, resolution)).toEqual([]);
  });

  it("keeps an UNCLAIMED hook session (a direct claude, no run wrapper) as before", () => {
    const entries: RegistryEntry[] = [hookEntry(UUID.architect)];
    const resolution = reconcileRunConvIds(entries, titleReader({}));
    const sessions = registrySessions(HOME, entries, resolution);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ project: "sentropic", sid: UUID.architect });
  });
});

describe("persistReconciledConvIds — writeback", () => {
  const SCRATCH_ROOT = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    ".test-scratch",
    "reconcile",
  );
  let regPath: string;

  beforeEach(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    regPath = join(mkdtempSync(join(SCRATCH_ROOT, "r-")), "registry.json");
  });
  afterEach(() => {
    rmSync(dirname(regPath), { recursive: true, force: true });
  });

  it("rewrites the run entry convId to the resolved uuid, idempotently", () => {
    const now = new Date().toISOString();
    const seed: RegistryEntry[] = [
      { id: "llm-mesh", tool: "claude", kind: "local-tmux", cwd: join(HOME, "src", "sentropic"), source: "run", label: "llm-mesh", convId: "llm-mesh", tmuxSession: "h2a-llm-mesh", enrolledAt: now, lastSeenAt: now },
    ];
    writeFileSync(regPath, JSON.stringify({ version: 1, entries: seed }, null, 2), "utf8");

    const changed = persistReconciledConvIds(new Map([["llm-mesh", UUID.llmMesh]]), regPath);
    expect(changed).toBe(1);
    const after = loadRegistry(regPath).find((e) => e.id === "llm-mesh");
    expect(after?.convId).toBe(UUID.llmMesh);

    // Second run is a no-op (already resolved) — nothing rewritten.
    const again = persistReconciledConvIds(new Map([["llm-mesh", UUID.llmMesh]]), regPath);
    expect(again).toBe(0);
  });
});
