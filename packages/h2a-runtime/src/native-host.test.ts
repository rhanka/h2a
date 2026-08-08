import { describe, expect, it } from "vitest";

import { nativeSidecarName, resolveSessionHostKind } from "./native-host.js";
import {
  isLive,
  isManagedLocalKind,
  type RegistryEntry,
} from "./registry.js";

describe("session host selector", () => {
  it("should default to the native PTY host", () => {
    expect(resolveSessionHostKind({}, {})).toBe("native");
  });

  it("should force tmux with the per-command --tmux flag", () => {
    expect(resolveSessionHostKind({ tmux: true }, {})).toBe("local-tmux");
  });

  it("should honor the fleet-wide H2A_SESSION_HOST=tmux valve", () => {
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "tmux" })).toBe(
      "local-tmux",
    );
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "TMUX" })).toBe(
      "local-tmux",
    );
  });

  it("should ignore any other valve value (native stays the default)", () => {
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "native" })).toBe(
      "native",
    );
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "" })).toBe("native");
  });

  it("should let the flag win over the valve being absent", () => {
    expect(resolveSessionHostKind({ tmux: false }, {})).toBe("native");
  });
});

describe("managed local kinds", () => {
  it("should treat both tmux and native as managed local", () => {
    expect(isManagedLocalKind("local-tmux")).toBe(true);
    expect(isManagedLocalKind("local-native")).toBe(true);
    expect(isManagedLocalKind("local")).toBe(false);
    expect(isManagedLocalKind("remote")).toBe(false);
  });

  it("should derive the sidecar companion name", () => {
    expect(nativeSidecarName("h2a-demo")).toBe("h2a-demo.h2a");
  });
});

describe("registry liveness for native sessions", () => {
  const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
    id: "demo",
    tool: "claude",
    kind: "local-native",
    cwd: "/tmp",
    enrolledAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    source: "run",
    tmuxSession: "h2a-demo",
    ...over,
  });

  it("should be live exactly when the native host reports the session", () => {
    expect(
      isLive(entry(), { nativeSessionAlive: (name) => name === "h2a-demo" }),
    ).toBe(true);
    expect(isLive(entry(), { nativeSessionAlive: () => false })).toBe(false);
  });

  it("should never consult tmux for a native entry", () => {
    let tmuxAsked = false;
    expect(
      isLive(entry(), {
        nativeSessionAlive: () => true,
        tmuxHasSession: () => {
          tmuxAsked = true;
          return true;
        },
      }),
    ).toBe(true);
    expect(tmuxAsked).toBe(false);
  });

  it("should probe the managed name candidates when no session name is recorded", () => {
    const probed: string[] = [];
    const result = isLive(entry({ tmuxSession: undefined }), {
      nativeSessionAlive: (name) => {
        probed.push(name);
        return name === "h2a-demo";
      },
    });
    expect(result).toBe(true);
    expect(probed).toContain("h2a-demo");
  });

  it("should stay dead once endedAt is recorded", () => {
    expect(
      isLive(entry({ endedAt: new Date().toISOString() }), {
        nativeSessionAlive: () => true,
      }),
    ).toBe(false);
  });
});
