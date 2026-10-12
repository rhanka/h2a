// L6a (H) — explicit live declarations and clone identity.
//
// Confinement: every test below runs inside mkdtemp roots only. HOME and
// XDG_RUNTIME_DIR are redirected to temp dirs for the whole file so the
// session registry and any git state stay away from the owner's real h2a
// state. No test silently skips when real state is absent: every fixture it
// needs, it creates.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetSessions, acquireSession } from "./sessions.js";
import {
  createLiveDeclarationStore,
  liveDeclarationsPath,
} from "./live-declarations.js";
import {
  createLiveRegistration,
  probeLiveWorkspace,
  unverifiedLocalLiveAuthority,
  type LiveAuthority,
  type LiveWorkController,
} from "./live-registration.js";
// Data-pure core DTOs are mirrored (not imported) by the runtime per the
// core/runtime boundary; this cross-check pins the two derivations together
// so they cannot drift while the neutral engram contract is still moving.
import * as coreLiveContracts from "../../../h2a/src/runtime/live/contracts.js";

// ---------------------------------------------------------------------------
// Temp-only fixtures
// ---------------------------------------------------------------------------

let tempHome = "";
let tempRuntime = "";
const previousHome = process.env.HOME;
const previousRuntime = process.env.XDG_RUNTIME_DIR;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "h2a-live-l6a-home-"));
  tempRuntime = mkdtempSync(join(tmpdir(), "h2a-live-l6a-xdg-"));
  // An existing (empty) global config keeps the owner's real git config out
  // of every fixture commit.
  writeFileSync(join(tempHome, "empty-gitconfig"), "");
  process.env.HOME = tempHome;
  process.env.XDG_RUNTIME_DIR = tempRuntime;
});

afterAll(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = previousRuntime;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempRuntime, { recursive: true, force: true });
});

beforeEach(resetSessions);

const gitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: join(tempHome, "empty-gitconfig"),
});

const git = (cwd: string, args: readonly string[]): string => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      env: gitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    })
      .toString("utf8")
      .trim();
  } catch (error) {
    throw new Error(
      `git -C ${cwd} ${args.join(" ")} failed: ${(error as Error).message}`,
    );
  }
};

/** A repo with one empty commit; `commits` adds more on top. */
function makeRepo(dir: string, commits = 1): string {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  for (let i = 0; i < commits; i += 1) {
    git(dir, [
      "-c",
      "user.name=h2a-test",
      "-c",
      "user.email=h2a-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      `commit-${i}`,
    ]);
  }
  return dir;
}

const allowAllAuthority: LiveAuthority = {
  authorize: () => ({ ok: true, principal: "local:test-principal" }),
};

interface ControllerCall {
  readonly op: "cancel" | "purge" | "in-flight";
  readonly declarationId: string;
  readonly cloneId: string;
}

function recordingController(
  inFlight = false,
): LiveWorkController & { calls: ControllerCall[] } {
  const calls: ControllerCall[] = [];
  return {
    calls,
    cancelScheduledWork(scope) {
      calls.push({ op: "cancel", ...scope });
      return true;
    },
    requestPrivatePurge(scope) {
      calls.push({ op: "purge", ...scope });
      return true;
    },
    hasInFlightWork(scope) {
      calls.push({ op: "in-flight", ...scope });
      return inFlight;
    },
  };
}

// ---------------------------------------------------------------------------
// L6a H cases
// ---------------------------------------------------------------------------

describe("gateway-host live registration (L6a H)", () => {
  it("equal fingerprints in two clones remain distinct and linked worktrees share one common-dir clone", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-base-"));
    try {
      const origin = makeRepo(join(base, "origin"));
      const cloneA = join(base, "clone-a");
      const cloneB = join(base, "clone-b");
      git(base, ["clone", "-q", origin, cloneA]);
      git(base, ["clone", "-q", origin, cloneB]);

      const probeA = probeLiveWorkspace(cloneA);
      const probeB = probeLiveWorkspace(cloneB);
      expect(probeA?.workspaceFingerprint).toMatch(/^ws:/);
      // Equal public fingerprints in the two separate clones.
      expect(probeB?.workspaceFingerprint).toBe(probeA?.workspaceFingerprint);
      expect(probeB?.projectFingerprint).toBe(probeA?.projectFingerprint);
      expect(probeB?.commonDirRealpath).not.toBe(probeA?.commonDirRealpath);

      // A linked worktree of clone A: same common dir, distinct ws: identity.
      const linked = join(base, "clone-a-wt");
      git(cloneA, ["worktree", "add", "-q", "-b", "feature-x", linked]);
      const probeLinked = probeLiveWorkspace(linked);
      expect(probeLinked?.commonDirRealpath).toBe(probeA?.commonDirRealpath);
      expect(probeLinked?.workspaceFingerprint).not.toBe(
        probeA?.workspaceFingerprint,
      );

      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
      });
      const activatedA = registration.activate({ path: cloneA });
      const activatedB = registration.activate({ path: cloneB });
      const activatedLinked = registration.activate({ path: linked });

      // Two clones with equal fingerprints: distinct clones, distinct
      // declarations. Never a fingerprint/URL-only merge.
      expect(activatedA.declaration.clone.cloneId).not.toBe(
        activatedB.declaration.clone.cloneId,
      );
      expect(activatedA.declaration.declarationId).not.toBe(
        activatedB.declaration.declarationId,
      );
      expect(activatedA.declaration.worktree.workspaceFingerprint).toBe(
        activatedB.declaration.worktree.workspaceFingerprint,
      );

      // Linked worktree shares exactly one common-dir clone with its clone.
      expect(activatedLinked.declaration.clone.cloneId).toBe(
        activatedA.declaration.clone.cloneId,
      );
      expect(activatedLinked.declaration.declarationId).not.toBe(
        activatedA.declaration.declarationId,
      );
      expect(activatedLinked.declaration.worktree.workspaceFingerprint).not.toBe(
        activatedA.declaration.worktree.workspaceFingerprint,
      );

      const listed = registration.list();
      expect(listed).toHaveLength(3);
      const cloneIds = new Set(listed.map((d) => d.clone.cloneId));
      expect(cloneIds).toHaveLength(2);

      // The runtime derivation must stay byte-identical to the data-pure
      // core contract (they mirror each other across the core/runtime
      // boundary until the neutral engram contract lands).
      const coreA = coreLiveContracts.deriveLiveCloneIdentity({
        hostScope: "local:test-owner",
        commonDirRealpath: probeA!.commonDirRealpath,
        ...(probeA!.projectFingerprint !== undefined
          ? { projectFingerprint: probeA!.projectFingerprint }
          : {}),
      });
      expect(coreA.cloneId).toBe(activatedA.declaration.clone.cloneId);
      expect(coreLiveContracts.LIVE_DECLARATION_KIND).toBe(
        activatedA.declaration.kind,
      );
      expect(coreLiveContracts.validateLiveDeclaration(activatedA.declaration))
        .toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("bind upload code-workspace creation and session opening or ending never activate or withdraw live declarations", async () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-guard-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const controller = recordingController();
      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
        workController: controller,
      });
      const ws = probeLiveWorkspace(repo)!.workspaceFingerprint!;

      // Session opening with the workspace identity, bind/upload artifacts
      // and code-workspace creation: none of these is activation.
      const sessionOperations = async (): Promise<void> => {
        await acquireSession("guard-session", {
          clientSessionId: "client-guard",
          workspaceId: ws,
        });
        // Code-workspace creation stand-in (an editor artifact in the tree).
        writeFileSync(
          join(repo, "project.code-workspace"),
          JSON.stringify({ folders: [{ path: "." }] }),
        );
        // Transcript upload stand-in under the private runtime root.
        mkdirSync(join(h2aRoot, "transcripts"), { recursive: true });
        writeFileSync(
          join(h2aRoot, "transcripts", "guard-session.jsonl"),
          JSON.stringify({ session: "guard-session" }) + "\n",
        );
        // Bind stand-in: an enrollment-side marker, never a live input.
        mkdirSync(join(tempHome, ".sentropic"), { recursive: true });
        writeFileSync(
          join(tempHome, ".sentropic", "h2a-auth.json"),
          JSON.stringify({ server: "https://sentropic.example.invalid" }),
        );
        // Session ending.
        resetSessions();
      };

      await sessionOperations();
      expect(registration.list()).toEqual([]);
      expect(existsSync(liveDeclarationsPath(h2aRoot))).toBe(false);
      expect(controller.calls).toEqual([]);

      // Explicit activation — the only path that creates a declaration.
      const { declaration, created } = registration.activate({ path: repo });
      expect(created).toBe(true);
      const before = readFileSync(liveDeclarationsPath(h2aRoot), "utf8");

      await sessionOperations();
      expect(readFileSync(liveDeclarationsPath(h2aRoot), "utf8")).toBe(before);
      expect(registration.list()).toHaveLength(1);
      const after = registration.status(repo);
      expect(after?.declarationId).toBe(declaration.declarationId);
      expect(after?.revision).toBe(declaration.revision);
      expect(after?.activatedAt).toBe(declaration.activatedAt);
      expect(controller.calls).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("explicit activation is once per worktree and replays durably after host restart without renewed activation", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-replay-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
      });
      const first = registration.activate({ path: repo });
      expect(first.created).toBe(true);
      // Once per workspace: re-activation is idempotent, no revision bump.
      const again = registration.activate({ path: repo });
      expect(again.created).toBe(false);
      expect(again.declaration).toEqual(first.declaration);

      // Host restart: brand-new store and service instances replay the same
      // durable declaration without renewed activation.
      const store2 = createLiveDeclarationStore(h2aRoot);
      expect(store2.list()).toHaveLength(1);
      const registration2 = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
      });
      const replayed = registration2.replay();
      expect(replayed).toHaveLength(1);
      expect(replayed[0]!).toEqual(first.declaration);
      expect(replayed[0]!.activatedAt).toBe(first.declaration.activatedAt);
      const afterRestart = registration2.activate({ path: repo });
      expect(afterRestart.created).toBe(false);
      expect(afterRestart.declaration).toEqual(first.declaration);

      // Path resolution seam: a path inside the authorized root resolves to
      // the declaration with its relative path.
      const resolved = registration2.resolvePath(join(repo, "src", "main.ts"));
      expect(resolved?.declaration.declarationId).toBe(
        first.declaration.declarationId,
      );
      expect(resolved?.relativePath).toBe("src/main.ts");
      expect(registration2.resolvePath(join(base, "elsewhere"))).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("an unverified local principal denies registration and reads explicitly, never as an empty success", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-auth-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      // Default authority is the L7a placeholder: deny everything, explicitly.
      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
      });
      expect(registration.authority).toBe(unverifiedLocalLiveAuthority);
      expect(() => registration.activate({ path: repo })).toThrow(
        /local_authority_unavailable/,
      );
      expect(() => registration.list()).toThrow(/local_authority_unavailable/);
      expect(() => registration.status(repo)).toThrow(
        /local_authority_unavailable/,
      );
      expect(() => registration.remove({ path: repo })).toThrow(
        /local_authority_unavailable/,
      );
      // Nothing was persisted by the refused operations.
      expect(existsSync(liveDeclarationsPath(h2aRoot))).toBe(false);

      // A non-worktree is refused explicitly even with authority granted:
      // no silent skip, no empty declaration.
      const authorized = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
      });
      const plain = join(base, "plain");
      mkdirSync(plain, { recursive: true });
      expect(() => authorized.activate({ path: plain })).toThrow(
        /not.*git worktree|not a git/i,
      );
      expect(authorized.list()).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("removal cancels delayed work, requests a private purge and never deletes committed history", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-remove-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const headBefore = git(repo, ["rev-parse", "HEAD"]);
      const controller = recordingController();
      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
        workController: controller,
      });
      const { declaration } = registration.activate({ path: repo });

      const removal = registration.remove({ path: repo });
      expect(removal.removed).toBe(true);
      expect(removal.canceledWork).toBe(true);
      expect(removal.purgeRequested).toBe(true);
      expect(controller.calls).toEqual([
        { op: "cancel", declarationId: declaration.declarationId, cloneId: declaration.clone.cloneId },
        { op: "purge", declarationId: declaration.declarationId, cloneId: declaration.clone.cloneId },
      ]);
      expect(registration.list()).toEqual([]);
      expect(registration.status(repo)).toBeUndefined();

      // Committed history is untouched: same HEAD, clean status, worktree
      // files intact. Purge applies to private live snapshots only.
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
      expect(git(repo, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
      expect(existsSync(join(repo, ".git"))).toBe(true);

      // Removing again is not an error, but re-registers nothing.
      const secondRemoval = registration.remove({ path: repo });
      expect(secondRemoval.removed).toBe(false);
      expect(secondRemoval.canceledWork).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("rebind requires revalidation, bumps the binding revision and refuses to redirect in-flight collection", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-rebind-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const idleController = recordingController(false);
      const busyController = recordingController(true);
      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
        workController: idleController,
      });
      const { declaration } = registration.activate({ path: repo });
      expect(declaration.binding).toBeUndefined();

      const rebound = registration.rebind({
        path: repo,
        sentropicWorkspaceId: "sws-4711",
        issuer: "https://auth.sentropic.example.invalid",
      });
      expect(rebound.binding).toEqual({
        sentropicWorkspaceId: "sws-4711",
        issuer: "https://auth.sentropic.example.invalid",
        bindingRevision: 1,
      });
      expect(rebound.revision).toBe(declaration.revision + 1);
      expect(rebound.activatedAt).toBe(declaration.activatedAt);

      const reboundAgain = registration.rebind({
        path: repo,
        sentropicWorkspaceId: "sws-4712",
        issuer: "https://auth.sentropic.example.invalid",
      });
      expect(reboundAgain.binding?.bindingRevision).toBe(2);
      expect(reboundAgain.revision).toBe(rebound.revision + 1);

      // Revalidation is required: without a fresh authorization decision the
      // rebind is refused, never silently applied.
      const onceOnly: LiveAuthority = {
        authorize: (request) =>
          request.operation === "rebind"
            ? { ok: false, reason: "revalidation_failed" }
            : { ok: true, principal: "local:test-principal" },
      };
      const strict = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: onceOnly,
        workController: idleController,
      });
      expect(() =>
        strict.rebind({
          path: repo,
          sentropicWorkspaceId: "sws-4713",
          issuer: "https://auth.sentropic.example.invalid",
        }),
      ).toThrow(/revalidation_failed/);

      // In-flight collection cannot be redirected by a rebind.
      const busy = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
        workController: busyController,
      });
      expect(() =>
        busy.rebind({
          path: repo,
          sentropicWorkspaceId: "sws-4714",
          issuer: "https://auth.sentropic.example.invalid",
        }),
      ).toThrow(/in_flight/);
      expect(busy.status(repo)?.binding?.sentropicWorkspaceId).toBe("sws-4712");
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("declaration updates are revision-guarded: stale writers are refused and never clobber", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-revision-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
      });
      const { declaration } = registration.activate({ path: repo });
      const store = createLiveDeclarationStore(h2aRoot);

      const first = store.update(
        declaration.declarationId,
        declaration.revision,
        (record) => ({ ...record, updatedAt: "2026-10-12T00:00:00.000Z" }),
      );
      expect(first.revision).toBe(declaration.revision + 1);

      // A stale writer holding the pre-update revision is refused explicitly.
      expect(() =>
        store.update(
          declaration.declarationId,
          declaration.revision,
          (record) => ({ ...record, updatedAt: "2026-01-01T00:00:00.000Z" }),
        ),
      ).toThrow(/revision_conflict/);

      // The refusal clobbered nothing.
      const store2 = createLiveDeclarationStore(h2aRoot);
      expect(store2.get(declaration.declarationId)).toEqual(first);
      expect(store2.get(declaration.declarationId)?.revision).toBe(
        declaration.revision + 1,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("missing and shallow history yield explicit identity uncertainty without merging distinct clones", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-history-"));
    try {
      // Unborn HEAD: no workspace fingerprint, explicit uncertainty.
      const emptyA = join(base, "empty-a");
      mkdirSync(emptyA, { recursive: true });
      git(emptyA, ["init", "-q"]);
      const probeEmpty = probeLiveWorkspace(emptyA);
      expect(probeEmpty?.workspaceFingerprint).toBeUndefined();
      expect(probeEmpty?.projectFingerprint).toBeUndefined();
      expect(probeEmpty?.identityUncertainty).toContain("missing_history");

      const emptyB = join(base, "empty-b");
      mkdirSync(emptyB, { recursive: true });
      git(emptyB, ["init", "-q"]);

      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
      });
      const activatedEmptyA = registration.activate({ path: emptyA });
      expect(
        activatedEmptyA.declaration.worktree.workspaceFingerprint,
      ).toBeUndefined();
      expect(activatedEmptyA.declaration.clone.identityUncertainty).toContain(
        "missing_history",
      );
      expect(
        coreLiveContracts.validateLiveDeclaration(
          activatedEmptyA.declaration,
        ),
      ).toBeUndefined();

      // Missing fingerprints never merge clones: two empty repos stay
      // distinct (realpath-bound, not URL/fingerprint-bound).
      const activatedEmptyB = registration.activate({ path: emptyB });
      expect(activatedEmptyB.declaration.declarationId).not.toBe(
        activatedEmptyA.declaration.declarationId,
      );
      expect(activatedEmptyB.declaration.clone.cloneId).not.toBe(
        activatedEmptyA.declaration.clone.cloneId,
      );

      // Shallow clone: fingerprint exists (from grafted roots) but carries
      // explicit uncertainty, never a silent complete identity.
      const origin = makeRepo(join(base, "deep-origin"), 2);
      const shallow = join(base, "shallow");
      // file:// transport: a local path clone silently ignores --depth.
      git(base, ["clone", "-q", "--depth", "1", `file://${origin}`, shallow]);
      const probeShallow = probeLiveWorkspace(shallow);
      expect(probeShallow?.workspaceFingerprint).toMatch(/^ws:/);
      expect(probeShallow?.shallow).toBe(true);
      expect(probeShallow?.identityUncertainty).toContain("shallow_history");
      const activatedShallow = registration.activate({ path: shallow });
      expect(activatedShallow.declaration.clone.identityUncertainty).toContain(
        "shallow_history",
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("activation writes no file inside the observed worktree or its git dirs", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-nowrite-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      git(repo, [
        "-c",
        "user.name=h2a-test",
        "-c",
        "user.email=h2a-test@example.invalid",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "second",
      ]);

      const inventory = (root: string): Map<string, number> => {
        const files = new Map<string, number>();
        const walk = (dir: string, rel: string): void => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(join(dir, entry.name), childRel);
            else files.set(childRel, statSync(join(dir, entry.name)).size);
          }
        };
        walk(root, "");
        return files;
      };

      const before = inventory(repo);
      const statusBefore = git(repo, [
        "status",
        "--porcelain",
        "--untracked-files=all",
      ]);

      const registration = createLiveRegistration({
        root: h2aRoot,
        hostScope: "local:test-owner",
        authority: allowAllAuthority,
      });
      registration.activate({ path: repo });
      registration.replay();
      registration.status(repo);
      registration.resolvePath(join(repo, "src"));

      expect(inventory(repo)).toEqual(before);
      expect(
        git(repo, ["status", "--porcelain", "--untracked-files=all"]),
      ).toBe(statusBefore);
      // Durable state lives only under the injected h2a root.
      expect(existsSync(liveDeclarationsPath(h2aRoot))).toBe(true);
      expect(existsSync(join(repo, "live"))).toBe(false);
      expect(existsSync(join(repo, ".h2a"))).toBe(false);
      expect(existsSync(join(repo, ".engram"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });
});
