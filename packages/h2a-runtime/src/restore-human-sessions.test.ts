import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  groupSessions,
  registrySessions,
  type DiscoveredSession,
} from "./restore.js";
import type { RegistryEntry } from "./registry.js";
import { DEFAULT_LAYOUT } from "./config.js";

const HOME = "/home/u";

function registryEntry(
  project: string,
  over: Partial<RegistryEntry> = {},
): RegistryEntry {
  const now = new Date().toISOString();
  return {
    id: `id-${project}`,
    tool: "claude",
    kind: "local-tmux",
    cwd: join(HOME, "src", project),
    tmuxSession: `remote-${project}`,
    enrolledAt: now,
    lastSeenAt: now,
    source: "run",
    ...over,
  };
}

describe("h2a restore — human-facing session preservation (defect repro)", () => {
  it("DEFECT #1: keeps EVERY distinct live human session of one repo (default cap)", () => {
    // sentropic legitimately has THREE concurrent human sessions live at once.
    const entries: RegistryEntry[] = [
      registryEntry("sentropic", {
        id: "id-s1",
        tmuxSession: "remote-sentropic-1",
        label: "sentropic-1",
        convId: "conv-1",
      }),
      registryEntry("sentropic", {
        id: "id-s2",
        tmuxSession: "remote-sentropic-2",
        label: "sentropic-2",
        convId: "conv-2",
      }),
      registryEntry("sentropic", {
        id: "id-s3",
        tmuxSession: "remote-sentropic-3",
        label: "sentropic-3",
        convId: "conv-3",
      }),
    ];
    const sessions = registrySessions(HOME, entries);
    const { windows } = groupSessions(sessions, DEFAULT_LAYOUT);
    const labels = windows.flatMap((w) => w.tabs).map((t) => t.label).sort();
    // Each distinct live human session must survive restore (keyed by session
    // identity, not by repo). Current code collapses to the newest one.
    expect(labels).toEqual(["sentropic-1", "sentropic-2", "sentropic-3"]);
  });

  it("DEFECT #1b: the SCAN fallback stays capped (mtime guesses are noisy)", () => {
    // Filesystem-scan guesses (origin 'scan') can duplicate one conversation, so
    // the multiSessionDefault cap must still tame THEM.
    const scan = (sid: string, ageMs: number): DiscoveredSession => ({
      project: "guessy",
      mtimeMs: Date.now() - ageMs,
      tool: "claude",
      sid,
      cwd: join(HOME, "src", "guessy"),
      origin: "scan",
      label: sid,
    });
    const sessions = [scan("a", 0), scan("b", 1000), scan("c", 2000)];
    const tabs = groupSessions(sessions, DEFAULT_LAYOUT).windows.flatMap(
      (w) => w.tabs,
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.label).toBe("a"); // newest guess only
  });

  it("DEFECT #2: excludes delegated role:'job' workers from human restore", () => {
    const entries: RegistryEntry[] = [
      registryEntry("human", { sessionClass: "human" }),
      // A delegated job: role 'job', NO sessionClass set (as delegate enrolls it).
      registryEntry("worker", { role: "job", jobState: "running" }),
    ];
    const projects = registrySessions(HOME, entries).map((s) => s.project);
    expect(projects).toEqual(["human"]);
  });

  it("DEFECT #2b: still excludes explicit sessionClass:'background' launches", () => {
    const entries: RegistryEntry[] = [
      registryEntry("human", { sessionClass: "human" }),
      registryEntry("bg", { sessionClass: "background" }),
    ];
    const projects = registrySessions(HOME, entries).map((s) => s.project);
    expect(projects).toEqual(["human"]);
  });
});
