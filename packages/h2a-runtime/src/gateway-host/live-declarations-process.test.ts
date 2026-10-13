// L6a fix3: real process exclusion and stale-holder fencing. All state is
// created under mkdtemp; only our own child PIDs receive signals.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLiveDeclarationStore } from "./live-declarations.js";
import { createLiveRegistration } from "./live-registration.js";

const driver = fileURLToPath(new URL("./fixtures/live-declarations-child.mjs", import.meta.url));
const source = new URL("./live-declarations.ts", import.meta.url).href;
const loader = fileURLToPath(new URL("../../../../node_modules/tsx/dist/loader.mjs", import.meta.url));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ChildResult {
  paused?: boolean;
  ok?: boolean;
  pid: number;
  name?: string;
  message?: string;
  expected?: number;
  actual?: number | null;
}

function launch(root: string, id: string, operation: string, cut = "read") {
  const child = spawn(process.execPath, ["--import", loader, driver, source, root, id, operation, cut], {
    env: {
      PATH: process.env.PATH,
      HOME: root,
      XDG_RUNTIME_DIR: root,
      XDG_STATE_HOME: root,
      XDG_CONFIG_HOME: root,
      H2A_ROOT: root,
      TMPDIR: root,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  const messages: ChildResult[] = [];
  child.stderr!.on("data", (data) => { stderr += String(data); });
  child.stdout!.on("data", (data) => {
    stdout += String(data);
    let end: number;
    while ((end = stdout.indexOf("\n")) !== -1) {
      messages.push(JSON.parse(stdout.slice(0, end)) as ChildResult);
      stdout = stdout.slice(end + 1);
    }
  });
  const exited = once(child, "exit");
  return {
    child,
    exited,
    async message(timeoutMs = 5_000): Promise<ChildResult> {
      const deadline = Date.now() + timeoutMs;
      while (messages.length === 0) {
        if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) {
          throw new Error(`child produced no result: ${stderr}`);
        }
        await delay(5);
      }
      return messages.shift()!;
    },
  };
}

async function stop(child: ChildProcess, exited: Promise<unknown>) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await exited;
}

function fixture(root: string) {
  const repo = join(root, "repo");
  mkdirSync(repo);
  const config = join(root, "gitconfig");
  writeFileSync(config, "");
  const env = {
    PATH: process.env.PATH, HOME: root, XDG_RUNTIME_DIR: root,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: config,
  };
  execFileSync("git", ["init", "-q", repo], { env });
  execFileSync("git", ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "fixture"], { env });
  const registration = createLiveRegistration({
    root, tenant: "local:test-owner",
    authority: { authorize: () => ({ ok: true, principal: "local:test-owner" }) },
  });
  const activated = registration.activate({ path: repo });
  return { registration, id: activated.declaration.declaration.declarationId };
}

describe("live declarations real-process fencing (L6a fix3)", () => {
  for (const cut of ["read", "rename"]) {
    for (const operation of cut === "read" ? ["B", "delete", "replace"] : ["B", "delete"]) {
      it(`refuses A paused at ${cut} beyond the stale delay after B's ${operation}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "h2a-live-fence-"));
        const children: ReturnType<typeof launch>[] = [];
        try {
          const { registration, id } = fixture(root);
          const a = launch(root, id, "A", cut);
          children.push(a);
          const paused = await a.message();
          expect(paused).toEqual({ paused: true, pid: a.child.pid });
          // Real elapsed time, exceeding the production 10 s stale delay.
          await delay(10_200);
          const b = launch(root, id, operation);
          children.push(b);
          expect(b.child.pid).not.toBe(a.child.pid);
          expect(await b.message()).toEqual({ ok: true, pid: b.child.pid });
          expect(await b.exited).toEqual([0, null]);
          expect(a.child.kill("SIGCONT")).toBe(true);
          const result = await a.message();
          expect(await a.exited).toEqual([0, null]);

          const store = createLiveDeclarationStore(root);
          const durable = store.get(id);
          if (operation === "delete") {
            expect(durable).toBeUndefined();
            expect(registration.replay()).toEqual([]);
          } else if (operation === "replace") {
            expect(durable?.declaration.declarationRevision).toBe(1);
            expect(durable?.declaration.serverWorkspaceId).toBeUndefined();
          } else {
            expect(durable?.declaration.declarationRevision).toBe(2);
            expect(durable?.declaration.serverWorkspaceId).toBe("workspace-B");
            expect(durable?.declaration.bindingRevision).toBe(1);
          }
          expect(result).toMatchObject({
            name: "LiveRevisionConflict", expected: 1,
            actual: operation === "delete" ? null : operation === "replace" ? 1 : 2,
          });
          console.info("fencing proof", JSON.stringify({ cut, operation, a: result, bPid: b.child.pid }));
        } finally {
          await Promise.all(children.map(({ child, exited }) => stop(child, exited)));
          rmSync(root, { recursive: true, force: true });
        }
      }, 25_000);
    }
  }

  it("excludes a second real process before the lock expires, with an explicit busy failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "h2a-live-exclusive-"));
    const children: ReturnType<typeof launch>[] = [];
    try {
      const { id } = fixture(root);
      const a = launch(root, id, "A");
      children.push(a);
      expect(await a.message()).toEqual({ paused: true, pid: a.child.pid });
      const b = launch(root, id, "B");
      children.push(b);
      expect(b.child.pid).not.toBe(a.child.pid);
      // The production lock wait itself lasts 5 s; allow startup as well.
      const busy = await b.message(7_000);
      expect(busy.name).toBe("Error");
      expect(busy.message).toMatch(/store busy: cannot acquire lock/);
      expect(await b.exited).toEqual([0, null]);
      expect(createLiveDeclarationStore(root).get(id)?.declaration.declarationRevision).toBe(1);
      expect(a.child.kill("SIGCONT")).toBe(true);
      expect(await a.message()).toEqual({ ok: true, pid: a.child.pid });
      expect(await a.exited).toEqual([0, null]);
      expect(createLiveDeclarationStore(root).get(id)?.declaration.serverWorkspaceId).toBe("workspace-A");
    } finally {
      await Promise.all(children.map(({ child, exited }) => stop(child, exited)));
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("does not release B's live lock or staged commit when dispossessed A exits", async () => {
    const root = mkdtempSync(join(tmpdir(), "h2a-live-successor-"));
    const children: ReturnType<typeof launch>[] = [];
    try {
      const { id } = fixture(root);
      const a = launch(root, id, "A", "rename");
      children.push(a);
      expect(await a.message()).toEqual({ paused: true, pid: a.child.pid });
      await delay(10_200);
      const b = launch(root, id, "B", "hold");
      children.push(b);
      expect(await b.message()).toEqual({ paused: true, pid: b.child.pid });
      expect(a.child.kill("SIGCONT")).toBe(true);
      expect(await a.message()).toMatchObject({ name: "LiveRevisionConflict", expected: 1, actual: 1 });
      expect(await a.exited).toEqual([0, null]);
      expect(b.child.kill("SIGCONT")).toBe(true);
      expect(await b.message()).toEqual({ ok: true, pid: b.child.pid });
      expect(await b.exited).toEqual([0, null]);
      const durable = createLiveDeclarationStore(root).get(id)!;
      expect(durable.declaration.declarationRevision).toBe(2);
      expect(durable.declaration.serverWorkspaceId).toBe("workspace-B");
    } finally {
      await Promise.all(children.map(({ child, exited }) => stop(child, exited)));
      rmSync(root, { recursive: true, force: true });
    }
  }, 25_000);
});
