/**
 * Local binding of an h2a workspace (its durable `ws:<sha256>` git identity) to ONE sentropic
 * workspace, per sentropic server. The binding is a local routing choice made explicitly by the
 * human (`h2a sentropic bind <workspace-id>`); the resource server still enforces membership on
 * every call. One file per (server, local workspace): a bind replaces only its own file, so two
 * workspaces bound at the same time never race on a shared map.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import { computeDurableWorkspaceId } from "../conductor-launch.js";
import {
  assertSentropicWorkspaceId,
  bindingFilePath,
  readBinding,
  removeBinding,
  resolveLocalWorkspaceId,
  writeBinding,
  type GitRunner,
  type WorkspaceBinding,
} from "./workspace-binding.js";

const SERVER = "https://preprod.sentropic.example";
const WS_A = `ws:${"a".repeat(64)}`;
const WS_B = `ws:${"b".repeat(64)}`;

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "h2a-binding-"));
}

function binding(localWorkspace: string, workspaceId: string): WorkspaceBinding {
  return {
    localWorkspace,
    server: SERVER,
    workspaceId,
    tenantId: "tenant-1",
    subject: "user-1",
    boundAt: "2026-11-07T21:00:00.000Z",
  };
}

describe("workspace binding store", () => {
  it("persists one binding per local workspace in a 0600 file inside a 0700 directory", () => {
    const dir = freshDir();
    writeBinding(binding(WS_A, "ws-sentropic-1"), dir);
    const path = bindingFilePath(SERVER, WS_A, dir);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    // A fresh read (another process) sees exactly what was recorded.
    expect(readBinding(SERVER, WS_A, dir)).toEqual(binding(WS_A, "ws-sentropic-1"));
  });

  it("keeps the bindings of two local workspaces apart, and a rebind replaces only its own", () => {
    const dir = freshDir();
    writeBinding(binding(WS_A, "ws-sentropic-1"), dir);
    writeBinding(binding(WS_B, "ws-sentropic-2"), dir);
    writeBinding(binding(WS_A, "ws-sentropic-3"), dir);
    expect(readBinding(SERVER, WS_A, dir)?.workspaceId).toBe("ws-sentropic-3");
    expect(readBinding(SERVER, WS_B, dir)?.workspaceId).toBe("ws-sentropic-2");
    expect(readBinding("https://other.example", WS_A, dir)).toBeUndefined();
  });

  it("unbind removes only that workspace's binding and leaves no temp file behind", () => {
    const dir = freshDir();
    writeBinding(binding(WS_A, "ws-sentropic-1"), dir);
    writeBinding(binding(WS_B, "ws-sentropic-2"), dir);
    expect(removeBinding(SERVER, WS_A, dir)).toBe(true);
    expect(removeBinding(SERVER, WS_A, dir)).toBe(false);
    expect(readBinding(SERVER, WS_A, dir)).toBeUndefined();
    expect(readBinding(SERVER, WS_B, dir)?.workspaceId).toBe("ws-sentropic-2");
    const left = readdirSync(join(bindingFilePath(SERVER, WS_B, dir), ".."));
    expect(left.filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("refuses a sentropic workspace id that is not a plain identifier", () => {
    for (const bad of ["", " ", "../etc", "a/b", "a b", "x".repeat(129), "id\n", "é"]) {
      expect(() => assertSentropicWorkspaceId(bad), JSON.stringify(bad)).toThrow(/workspace id/);
    }
    expect(assertSentropicWorkspaceId("0b9c8f1e-7d2a-4c3b-9e8f-1a2b3c4d5e6f")).toBe(
      "0b9c8f1e-7d2a-4c3b-9e8f-1a2b3c4d5e6f",
    );
  });

  it("refuses to record a local workspace that is not a durable ws: identity", () => {
    const dir = freshDir();
    expect(() => writeBinding(binding("ws:short", "ws-sentropic-1"), dir)).toThrow(/local workspace/);
    expect(() => writeBinding(binding("/home/me/repo", "ws-sentropic-1"), dir)).toThrow(/local workspace/);
  });

  it("reports a damaged binding file without parsing it into a binding or quoting its bytes", () => {
    const dir = freshDir();
    writeBinding(binding(WS_A, "ws-sentropic-1"), dir);
    writeFileSync(bindingFilePath(SERVER, WS_A, dir), '{"workspaceId": "zzSENTINELzz', "utf8");
    let caught: unknown;
    try {
      readBinding(SERVER, WS_A, dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const rendered = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}\n${inspect(caught)}`;
    expect(rendered).toMatch(/binding/);
    expect(rendered).not.toContain("zzSENTINELzz");
  });

  it("ignores a binding file whose recorded identity does not match the slot it sits in", () => {
    const dir = freshDir();
    writeBinding(binding(WS_A, "ws-sentropic-1"), dir);
    const slot = bindingFilePath(SERVER, WS_B, dir);
    mkdirSync(join(slot, ".."), { recursive: true });
    writeFileSync(slot, JSON.stringify(binding(WS_A, "ws-sentropic-9")), { mode: 0o600 });
    expect(() => readBinding(SERVER, WS_B, dir)).toThrow(/binding/);
  });
});

describe("local workspace identity", () => {
  const gitFor = (gitDir: string, commonDir: string, roots = "abc\n"): GitRunner => (args) => {
    const key = args.join(" ");
    if (key === "rev-list --max-parents=0 HEAD") return { status: 0, stdout: roots };
    if (key === "rev-parse --git-dir") return { status: 0, stdout: `${gitDir}\n` };
    if (key === "rev-parse --git-common-dir") return { status: 0, stdout: `${commonDir}\n` };
    return { status: 1, stdout: "" };
  };

  it("derives the same durable ws: id as track and h2a for a primary and a linked worktree", () => {
    expect(resolveLocalWorkspaceId("/repo", gitFor(".git", ".git"))).toBe(computeDurableWorkspaceId("abc", ""));
    expect(resolveLocalWorkspaceId("/repo", gitFor(".git", ".git"))).toMatch(/^ws:edeaaff3/);
    expect(
      resolveLocalWorkspaceId("/wt", gitFor("/repo/.git/worktrees/my-feature", "/repo/.git")),
    ).toBe(computeDurableWorkspaceId("abc", "my-feature"));
  });

  it("returns undefined outside a git repository", () => {
    expect(resolveLocalWorkspaceId("/nowhere", () => ({ status: 128, stdout: "" }))).toBeUndefined();
  });

  it("reads the identity of a real git repository with the default runner", () => {
    const repo = freshDir();
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      });
    expect(git("init", "-q").status).toBe(0);
    expect(git("commit", "-q", "--allow-empty", "-m", "root").status).toBe(0);
    const root = git("rev-list", "--max-parents=0", "HEAD").stdout.trim();
    expect(resolveLocalWorkspaceId(repo)).toBe(computeDurableWorkspaceId(root, ""));
    // From a subdirectory git answers --git-dir absolute but --git-common-dir relative: the
    // identity must still be the primary worktree's, not a phantom linked worktree ".git".
    const deep = join(repo, "sub", "deep");
    mkdirSync(deep, { recursive: true });
    expect(resolveLocalWorkspaceId(deep)).toBe(computeDurableWorkspaceId(root, ""));
  });
});
