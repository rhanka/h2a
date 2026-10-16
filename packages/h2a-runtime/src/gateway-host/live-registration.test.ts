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
  type LiveDeclarationRecord,
} from "./live-declarations.js";
import {
  createLiveRegistration,
  probeLiveWorkspace,
  unverifiedLocalLiveAuthority,
  type LiveAuthority,
  type LiveWorkController,
} from "./live-registration.js";
// L6a realignment: H consumes the frozen neutral contract
// (@sentropic/engram-live 0.1.0 @70ebdfee, vendored under
// ../vendor/engram-live — see the GUARD test below), never a silent copy of
// its derivations.
import {
  INITIAL_BINDING_REVISION,
  POLICY_VERSION,
  validateDeclarationRevocation,
  validateWorkspaceDeclaration,
} from "../vendor/engram-live/contracts.js";
import {
  deriveCloneIdentity,
  deriveDeclarationIdentity,
  deriveWorktreeIdentity,
} from "../vendor/engram-live/integration.js";
import { createHash } from "node:crypto";
import * as liveRegistrationModule from "./live-registration.js";
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
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const activatedA = registration.activate({ path: cloneA });
      const activatedB = registration.activate({ path: cloneB });
      const activatedLinked = registration.activate({ path: linked });

      // Two clones with equal fingerprints: distinct clones, distinct
      // declarations. Never a fingerprint/URL-only merge.
      expect(activatedA.declaration.declaration.cloneId).not.toBe(
        activatedB.declaration.declaration.cloneId,
      );
      expect(activatedA.declaration.declaration.declarationId).not.toBe(
        activatedB.declaration.declaration.declarationId,
      );
      expect(activatedA.declaration.declaration.hostFingerprint).toBe(
        activatedB.declaration.declaration.hostFingerprint,
      );

      // Linked worktree shares exactly one common-dir clone with its clone.
      expect(activatedLinked.declaration.declaration.cloneId).toBe(
        activatedA.declaration.declaration.cloneId,
      );
      expect(activatedLinked.declaration.declaration.declarationId).not.toBe(
        activatedA.declaration.declaration.declarationId,
      );
      expect(activatedLinked.declaration.declaration.hostFingerprint).not.toBe(
        activatedA.declaration.declaration.hostFingerprint,
      );

      const listed = registration.list();
      expect(listed).toHaveLength(3);
      const cloneIds = new Set(listed.map((d) => d.declaration.cloneId));
      expect(cloneIds).toHaveLength(2);

      // Every stored declaration is a valid neutral DTO; the envelope keeps
      // the H kind marker and the activation timestamp.
      for (const record of listed) {
        expect(validateWorkspaceDeclaration(record.declaration).ok).toBe(true);
        expect(record.kind).toBe("h2a-live-declaration");
      }
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
        tenant: "local:test-owner",
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
      expect(after?.declaration.declarationId).toBe(declaration.declaration.declarationId);
      expect(after?.declaration.declarationRevision).toBe(declaration.declaration.declarationRevision);
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
        tenant: "local:test-owner",
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
        tenant: "local:test-owner",
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
      expect(resolved?.declaration.declaration.declarationId).toBe(
        first.declaration.declaration.declarationId,
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
        tenant: "local:test-owner",
      });
      expect(registration.authority).toBe(unverifiedLocalLiveAuthority);
      expect(() => registration.activate({ path: repo })).toThrow(
        /local_authority_unavailable/,
      );
      expect(() => registration.list()).toThrow(/local_authority_unavailable/);
      expect(() => registration.status(repo)).toThrow(
        /local_authority_unavailable/,
      );
      expect(() => registration.remove({ path: repo, reason: "workspace-remove" })).toThrow(
        /local_authority_unavailable/,
      );
      // Nothing was persisted by the refused operations.
      expect(existsSync(liveDeclarationsPath(h2aRoot))).toBe(false);

      // A non-worktree is refused explicitly even with authority granted:
      // no silent skip, no empty declaration.
      const authorized = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
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
        tenant: "local:test-owner",
        authority: allowAllAuthority,
        workController: controller,
      });
      const { declaration } = registration.activate({ path: repo });

      const removal = registration.remove({ path: repo, reason: "workspace-remove" });
      expect(removal.removed).toBe(true);
      expect(removal.canceledWork).toBe(true);
      expect(removal.purgeRequested).toBe(true);
      expect(removal.revocation?.declarationId).toBe(declaration.declaration.declarationId);
      expect(removal.revocation?.reason).toBe("workspace-remove");
      expect(controller.calls).toEqual([
        { op: "cancel", declarationId: declaration.declaration.declarationId, cloneId: declaration.declaration.cloneId },
        { op: "purge", declarationId: declaration.declaration.declarationId, cloneId: declaration.declaration.cloneId },
      ]);
      expect(registration.list()).toEqual([]);
      expect(registration.status(repo)).toBeUndefined();

      // Committed history is untouched: same HEAD, clean status, worktree
      // files intact. Purge applies to private live snapshots only.
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
      expect(git(repo, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
      expect(existsSync(join(repo, ".git"))).toBe(true);

      // Removing again is not an error, but re-registers nothing.
      const secondRemoval = registration.remove({ path: repo, reason: "workspace-remove" });
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
        tenant: "local:test-owner",
        authority: allowAllAuthority,
        workController: idleController,
      });
      const { declaration } = registration.activate({ path: repo });
      expect(declaration.declaration.bindingRevision).toBeUndefined();

      const rebound = registration.rebind({
        path: repo,
        sentropicWorkspaceId: "sws-4711",
        issuer: "https://auth.sentropic.example.invalid",
      });
      expect(rebound.declaration.serverWorkspaceId).toBe("sws-4711");
      expect(rebound.declaration.serverIssuer).toBe("https://auth.sentropic.example.invalid");
      expect(rebound.declaration.bindingRevision).toBe(1);
      expect(rebound.declaration.declarationRevision).toBe(
        declaration.declaration.declarationRevision + 1,
      );
      expect(rebound.activatedAt).toBe(declaration.activatedAt);

      const reboundAgain = registration.rebind({
        path: repo,
        sentropicWorkspaceId: "sws-4712",
        issuer: "https://auth.sentropic.example.invalid",
      });
      expect(reboundAgain.declaration.bindingRevision).toBe(2);
      expect(reboundAgain.declaration.declarationRevision).toBe(
        rebound.declaration.declarationRevision + 1,
      );

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
        tenant: "local:test-owner",
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
        tenant: "local:test-owner",
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
      expect(busy.status(repo)?.declaration.serverWorkspaceId).toBe("sws-4712");
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
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const { declaration } = registration.activate({ path: repo });
      const store = createLiveDeclarationStore(h2aRoot);

      const first = store.update(
        declaration.declaration.declarationId,
        declaration.declaration.declarationRevision,
        (record) => ({
          ...record,
          declaration: {
            ...record.declaration,
            declarationRevision: record.declaration.declarationRevision + 1,
          },
          updatedAt: "2026-10-12T00:00:00.000Z",
        }),
      );
      expect(first.declaration.declarationRevision).toBe(
        declaration.declaration.declarationRevision + 1,
      );

      // A stale writer holding the pre-update revision is refused explicitly.
      expect(() =>
        store.update(
          declaration.declaration.declarationId,
          declaration.declaration.declarationRevision,
          (record) => ({
            ...record,
            declaration: {
              ...record.declaration,
              declarationRevision: record.declaration.declarationRevision + 1,
            },
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ),
      ).toThrow(/revision_conflict/);

      // The refusal clobbered nothing.
      const store2 = createLiveDeclarationStore(h2aRoot);
      expect(store2.get(declaration.declaration.declarationId)).toEqual(first);
      expect(store2.get(declaration.declaration.declarationId)?.declaration.declarationRevision).toBe(
        declaration.declaration.declarationRevision + 1,
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
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const activatedEmptyA = registration.activate({ path: emptyA });
      expect(
        activatedEmptyA.declaration.declaration.hostFingerprint,
      ).toBeUndefined();
      expect(activatedEmptyA.declaration.clone.identityUncertainty).toContain(
        "missing_history",
      );
      expect(
        validateWorkspaceDeclaration(activatedEmptyA.declaration.declaration).ok,
      ).toBe(true);

      // Missing fingerprints never merge clones: two empty repos stay
      // distinct (realpath-bound, not URL/fingerprint-bound).
      const activatedEmptyB = registration.activate({ path: emptyB });
      expect(activatedEmptyB.declaration.declaration.declarationId).not.toBe(
        activatedEmptyA.declaration.declaration.declarationId,
      );
      expect(activatedEmptyB.declaration.declaration.cloneId).not.toBe(
        activatedEmptyA.declaration.declaration.cloneId,
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
        tenant: "local:test-owner",
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

// ---------------------------------------------------------------------------
// L6a realignment RED: H must match the frozen engram-live contract
// (gaps L6a-h2a-gaps.md §1–4). Each test below fails until the service mints
// identities through the canonical derivation, speaks the contract
// vocabulary and refuses unverified principals.
// ---------------------------------------------------------------------------

/**
 * Pinned integrity of the vendored neutral surface (spec §11). The entries
 * were extracted byte-identical from vendor/sentropic-engram-live-0.1.0.tgz
 * (graphify@70ebdfee, PR rhanka/engram#359), whose own sha512 was
 * sha512-SpNpd9iDWi0x9lySvYd+HtUtWDyEPncW6pAdMS3YjaCiWF1C3aaIEMbxc6TbkPNwlBGxNpHdwf+Zc8ntMPq2iw==;
 * the tarball is removed after vendoring because its os-bounded (linux)
 * `file:` consumption breaks cross-platform install and packed
 * redistribution. Re-vendor from that commit and compare digests to rotate.
 */
const ENGRAM_LIVE_VENDORED_INTEGRITY = {
  "contracts.d.ts":
    "sha512-ZY8jaPcnjbKt5R8a/QA759l0038fiL9u1GHC6HV7FfqWAs+nVrMx16Zi1yIVFYVEH1FaYRxYQWwiibKuEEKP/w==",
  "contracts.js":
    "sha512-Jg0HTAjImE5IhPY1jqygRui7F16GeZ85RgGgJWSsIzv1JDnWtwZl23Z6DXLQvOG7Kg60c5cMfcThKusKU6jfzQ==",
  "registration.js":
    "sha512-v/0LGM651f3nVcP+R99oz2kRyC5ZKVhUO5UJ8dIeYrdLbdoayA5VOheZpIqF/fwRPQOxEfGP38QEg+cLvJoz7Q==",
  "registration.d.ts":
    "sha512-nRHZITOtLNND2lu0A59JbGrop8r9qb5Z75qGQ5FhycjeTCjqyygFsTrUSFEKEiDws6J5uoqGYx9ZttrflqTw2Q==",
  "integration.js":
    "sha512-cLQpW8pZl2NmP/41aX2DWqVNkQXqImd+To7XCx09PRR4dbT09OkR7qPmrf0uVpdIpjcNB/ynhzxRIVca3eHGFw==",
  "integration.d.ts":
    "sha512-mm7CIOP4c1VwvJhqHCIjE05KARUVVquxZo/xQ/Zj7L87Qvu/ltaz2Bb2wWBU0amir88KOOU9pTuPnTNu3goB5A==",
};

const noPrincipalAuthority: LiveAuthority = {
  authorize: () => ({ ok: true }),
};

describe("gateway-host live registration L6a realignment", () => {
  it("GUARD: consumes the pinned vendored engram-live surface, never a silent copy", async () => {
    const vendor = new URL("../vendor/engram-live/", import.meta.url);
    expect(Object.keys(ENGRAM_LIVE_VENDORED_INTEGRITY).sort()).toEqual(
      readdirSync(vendor).filter((file) => file.endsWith(".js") || file.endsWith(".d.ts")).sort(),
    );
    for (const [file, digest] of Object.entries(ENGRAM_LIVE_VENDORED_INTEGRITY)) {
      const bytes = readFileSync(new URL(file, vendor));
      expect(`sha512-${createHash("sha512").update(bytes).digest("base64")}`).toBe(digest);
    }
    // The core and runtime packages vendor the same contracts entry: both
    // executable code and type declarations must stay byte-identical.
    for (const file of ["contracts.js", "contracts.d.ts"]) {
      const coreContracts = readFileSync(
        new URL(`../../../h2a/src/vendor/engram-live/${file}`, import.meta.url),
      );
      expect(coreContracts.equals(readFileSync(new URL(file, vendor))), file).toBe(true);
    }
    const contracts = await import("../vendor/engram-live/contracts.js");
    expect(contracts.CONTRACT_NAME).toBe("@sentropic/engram-live/contracts");
    expect(contracts.CONTRACT_VERSION).toBe(1);
    expect(contracts.POLICY_VERSION).toBe("live-git-indexing/1");
  });

  it("gap1: declaration carries the flat identity triangle and removal returns a contract-valid revocation", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r1-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r1-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const { declaration } = registration.activate({ path: repo });
      const dto = declaration.declaration;
      expect(dto?.declarationId).toMatch(/^decl:/);
      expect(dto?.cloneId).toMatch(/^clone:/);
      expect(dto?.worktreeId).toMatch(/^wt:/);
      expect(dto?.tenant).toBe("local:test-owner");
      expect(dto?.liveCapability).toBe("live");
      expect(dto?.policyVersion).toBe(POLICY_VERSION);
      expect(dto?.declarationRevision).toBe(1);
      expect(validateWorkspaceDeclaration(dto).ok).toBe(true);

      const removal = registration.remove({ path: repo, reason: "workspace-remove" });
      expect(removal.removed).toBe(true);
      expect(validateDeclarationRevocation(removal.revocation).ok).toBe(true);
      expect(removal.revocation).toMatchObject({
        declarationId: dto?.declarationId,
        tenant: "local:test-owner",
        cloneId: dto?.cloneId,
        worktreeId: dto?.worktreeId,
        declarationRevision: dto?.declarationRevision,
        reason: "workspace-remove",
        requestPrivatePurge: {
          purgePrivateSnapshots: true,
          purgeDerivedIndexes: true,
          revokeDecryptability: true,
          preserveCommittedHistory: true,
        },
      });
      expect(registration.list()).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("gap1: withdrawing a clone revokes each of its declarations", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r1b-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r1b-base-"));
    try {
      const origin = makeRepo(join(base, "origin"));
      const cloneA = join(base, "clone-a");
      git(base, ["clone", "-q", origin, cloneA]);
      const linked = join(base, "clone-a-wt");
      git(cloneA, ["worktree", "add", "-q", "-b", "feature-x", linked]);
      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const activatedA = registration.activate({ path: cloneA });
      const activatedLinked = registration.activate({ path: linked });
      const cloneId = activatedA.declaration.declaration.cloneId;
      expect(activatedLinked.declaration.declaration.cloneId).toBe(cloneId);

      expect(typeof registration.removeClone).toBe("function");
      const outcome = registration.removeClone({ cloneId, reason: "owner-request" });
      expect(outcome.revocations).toHaveLength(2);
      const revokedIds = outcome.revocations.map((revocation) => revocation.declarationId).sort();
      expect(revokedIds).toEqual(
        [
          activatedA.declaration.declaration.declarationId,
          activatedLinked.declaration.declaration.declarationId,
        ].sort(),
      );
      for (const revocation of outcome.revocations) {
        expect(validateDeclarationRevocation(revocation).ok).toBe(true);
        expect(revocation.reason).toBe("owner-request");
      }
      expect(registration.list()).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("gap2: contract vocabulary with a flat product binding", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r2-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r2-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const { declaration } = registration.activate({ path: repo });
      const rebound = registration.rebind({
        path: repo,
        sentropicWorkspaceId: "sws-4711",
        issuer: "https://auth.sentropic.example.invalid",
      });
      const dto = rebound.declaration;
      expect(dto?.tenant).toBe("local:test-owner");
      expect(dto?.hostFingerprint).toMatch(/^ws:/);
      expect(dto?.serverWorkspaceId).toBe("sws-4711");
      expect(dto?.serverIssuer).toBe("https://auth.sentropic.example.invalid");
      expect(dto?.bindingRevision).toBe(INITIAL_BINDING_REVISION);
      expect(validateWorkspaceDeclaration(dto).ok).toBe(true);
      // Retired H vocabulary is gone from the neutral DTO.
      for (const retired of ["hostScope", "capability", "revision", "workspaceFingerprint", "binding"]) {
        expect(dto !== undefined && retired in (dto as unknown as Record<string, unknown>)).toBe(false);
      }
      expect(declaration.declaration?.bindingRevision).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("gap3: identities are byte-identical to the canonical engram derivation", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r3-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r3-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const probe = probeLiveWorkspace(repo)!;
      expect(probe.oidAlgorithm).toMatch(/^(sha1|sha256)$/);
      const tenant = "local:test-owner";
      const clone = deriveCloneIdentity({
        hostScope: tenant,
        commonDirRealpath: probe.commonDirRealpath,
        ...(probe.projectFingerprint !== undefined
          ? { commonDirProjectFingerprint: probe.projectFingerprint }
          : {}),
        identityUncertainty: [...probe.identityUncertainty] as never,
        oidAlgorithm: probe.oidAlgorithm as "sha1" | "sha256",
      });
      const worktree = deriveWorktreeIdentity({
        hostScope: tenant,
        clone: { cloneId: clone.cloneId },
        worktreePath: probe.worktreeRealpath,
        gitDir: probe.gitDir,
        ...(probe.workspaceFingerprint !== undefined
          ? { worktreeFingerprint: probe.workspaceFingerprint }
          : {}),
        identityUncertainty: [...probe.identityUncertainty] as never,
      });
      const identity = deriveDeclarationIdentity({
        hostScope: tenant,
        clone: { cloneId: clone.cloneId },
        worktree: { worktreeId: worktree.worktreeId },
      });

      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant,
        authority: allowAllAuthority,
      });
      const { declaration } = registration.activate({ path: repo });
      expect(declaration.declaration?.cloneId).toBe(clone.cloneId);
      expect(declaration.declaration?.worktreeId).toBe(worktree.worktreeId);
      expect(declaration.declaration?.declarationId).toBe(identity.declarationId);

      // The retired newline-joined scheme must not come back.
      const legacyCloneId =
        "clone:" +
        createHash("sha256")
          .update(`${tenant}\n${probe.commonDirRealpath}\n${probe.projectFingerprint ?? ""}`, "utf8")
          .digest("hex");
      expect(declaration.declaration?.cloneId).not.toBe(legacyCloneId);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("gap4: a positive authorization without a verified principal is refused", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r4-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-r4-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: noPrincipalAuthority,
      });
      // No neutral DTO is ever built from an unverified principal — reads
      // included (spec §12); the stable owner scope stays L7a work.
      expect(() => registration.activate({ path: repo })).toThrow(/verified_principal_required/);
      expect(() => registration.list()).toThrow(/verified_principal_required/);
      expect(() => registration.status(repo)).toThrow(/verified_principal_required/);
      expect(() => registration.resolvePath(repo)).toThrow(/verified_principal_required/);
      expect(() => registration.remove({ path: repo, reason: "workspace-remove" })).toThrow(
        /verified_principal_required/,
      );
      expect(() =>
        registration.rebind({
          path: repo,
          sentropicWorkspaceId: "sws-1",
          issuer: "https://auth.sentropic.example.invalid",
        }),
      ).toThrow(/verified_principal_required/);
      expect(() => registration.replay()).toThrow(/verified_principal_required/);
      expect(existsSync(liveDeclarationsPath(h2aRoot))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("core contract surface re-exports the frozen neutral surface without copies", async () => {
    const engramContracts = await import(
      "../../../h2a/src/vendor/engram-live/contracts.js"
    );
    expect(coreLiveContracts.POLICY_VERSION).toBe(engramContracts.POLICY_VERSION);
    expect(coreLiveContracts.EXPLICIT_LIVE_CAPABILITY).toBe("live");
    expect(coreLiveContracts.INITIAL_DECLARATION_REVISION).toBe(1);
    expect(coreLiveContracts.INITIAL_BINDING_REVISION).toBe(1);
    expect(coreLiveContracts.validateWorkspaceDeclaration).toBe(
      engramContracts.validateWorkspaceDeclaration,
    );
    expect(coreLiveContracts.validateCloneIdentity).toBe(engramContracts.validateCloneIdentity);
    expect(coreLiveContracts.validateWorktreeIdentity).toBe(
      engramContracts.validateWorktreeIdentity,
    );
    expect(coreLiveContracts.validateDeclarationRevocation).toBe(
      engramContracts.validateDeclarationRevocation,
    );
    expect(coreLiveContracts.validatePrivatePurgeRequest).toBe(
      engramContracts.validatePrivatePurgeRequest,
    );
    expect(coreLiveContracts.isLocalLiveTenant("local:test-owner")).toBe(true);
    for (const bad of ["", "local:", "sentropic:abc", "ws:deadbeef", "local:a\0b", undefined, 42]) {
      expect(coreLiveContracts.isLocalLiveTenant(bad)).toBe(false);
    }
  });

  it("gap3: non-activating lifecycle kinds never change activation", () => {
    const classify = (
      liveRegistrationModule as unknown as {
        classifyLifecycleEvent?: (kind: string) => string;
      }
    ).classifyLifecycleEvent;
    expect(typeof classify).toBe("function");
    for (const kind of ["bind", "upload", "code-workspace-create", "session-open", "session-end"]) {
      expect(classify!(kind)).toBe("no-activation-change");
    }
    expect(() => classify!("activate")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// L6a fix round 2 (Sol co-review rejection of eb463c52): the clone key must
// not depend on the worktree HEAD, the revision guard and the persistence
// must be atomic, and the gap-5 binding guards need discriminant tests.
// ---------------------------------------------------------------------------

describe("gateway-host live registration L6a fix2", () => {
  it("two worktrees of one clone at different heads share one cloneId and withdraw together", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2-base-"));
    try {
      const origin = makeRepo(join(base, "origin"));
      const clone = join(base, "clone");
      git(base, ["clone", "-q", origin, clone]);
      const mainBranch = git(clone, ["branch", "--show-current"]);
      // Orphan history beside main: the two worktrees below sit on
      // different heads with disjoint HEAD root commits.
      git(clone, ["checkout", "-q", "--orphan", "orphan"]);
      git(clone, [
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
        "orphan-1",
      ]);
      const linked = join(base, "clone-wt-main");
      git(clone, ["worktree", "add", "-q", linked, mainBranch]);

      const probeOrphan = probeLiveWorkspace(clone)!;
      const probeMain = probeLiveWorkspace(linked)!;
      expect(probeOrphan.commonDirRealpath).toBe(probeMain.commonDirRealpath);
      // The public per-worktree ws: fingerprint stays HEAD-bound (distinct).
      expect(probeOrphan.workspaceFingerprint).toMatch(/^ws:/);
      expect(probeMain.workspaceFingerprint).toMatch(/^ws:/);
      expect(probeMain.workspaceFingerprint).not.toBe(probeOrphan.workspaceFingerprint);
      // The clone-level project fingerprint is HEAD-independent (common-dir
      // history, spec §12): identical from both worktrees.
      expect(probeMain.projectFingerprint).toBe(probeOrphan.projectFingerprint);

      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const activatedOrphan = registration.activate({ path: clone });
      const activatedMain = registration.activate({ path: linked });
      expect(activatedMain.declaration.declaration.cloneId).toBe(
        activatedOrphan.declaration.declaration.cloneId,
      );
      expect(activatedMain.declaration.declaration.declarationId).not.toBe(
        activatedOrphan.declaration.declaration.declarationId,
      );

      // Withdrawing the shared clone revokes BOTH declarations.
      const outcome = registration.removeClone({
        cloneId: activatedOrphan.declaration.declaration.cloneId,
        reason: "owner-request",
      });
      expect(outcome.removed).toBe(2);
      expect(outcome.revocations).toHaveLength(2);
      expect(registration.list()).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("concurrent writers from one base revision: one wins, the other gets a typed revision conflict", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2w-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2w-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      }).activate({ path: repo });
      const storeA = createLiveDeclarationStore(h2aRoot);
      const storeB = createLiveDeclarationStore(h2aRoot);
      const id = storeA.list()[0]!.declaration.declarationId;
      const baseRevision = storeA.list()[0]!.declaration.declarationRevision;

      const bump = (tag: string) => (record: LiveDeclarationRecord) => ({
        ...record,
        declaration: {
          ...record.declaration,
          declarationRevision: record.declaration.declarationRevision + 1,
        },
        updatedAt: tag,
      });

      // The interleaved writer commits first; the outer writer must then
      // fail with a typed conflict instead of silently clobbering it.
      let conflict: unknown;
      try {
        storeA.update(id, baseRevision, (record) => {
          storeB.update(id, baseRevision, bump("2026-10-12T00:00:01.000Z"));
          return bump("2026-10-12T00:00:02.000Z")(record);
        });
      } catch (error) {
        conflict = error;
      }
      expect(conflict).toBeInstanceOf(Error);
      expect((conflict as Error).message).toMatch(/revision_conflict/);
      expect((conflict as Error).name).toBe("LiveRevisionConflict");

      // Exactly one writer won; the winner's record is intact.
      const fresh = createLiveDeclarationStore(h2aRoot);
      expect(fresh.get(id)?.declaration.declarationRevision).toBe(baseRevision + 1);
      expect(fresh.get(id)?.updatedAt).toBe("2026-10-12T00:00:01.000Z");
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("a removal interleaved before persistence is never resurrected by a stale writer", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2r-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2r-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      registration.activate({ path: repo });
      const storeA = createLiveDeclarationStore(h2aRoot);
      const storeB = createLiveDeclarationStore(h2aRoot);
      const id = storeA.list()[0]!.declaration.declarationId;
      const baseRevision = storeA.list()[0]!.declaration.declarationRevision;

      let conflict: unknown;
      try {
        storeA.update(id, baseRevision, (record) => {
          expect(storeB.remove(id)).toBe(true);
          return {
            ...record,
            declaration: {
              ...record.declaration,
              declarationRevision: record.declaration.declarationRevision + 1,
            },
            updatedAt: "2026-10-12T00:00:03.000Z",
          };
        });
      } catch (error) {
        conflict = error;
      }
      expect(conflict).toBeInstanceOf(Error);
      expect((conflict as Error).message).toMatch(/revision_conflict/);

      // The revoked declaration stays gone through every read path.
      expect(storeA.list()).toEqual([]);
      expect(registration.replay()).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("gap5: a roots-only revision preserves the binding", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2b-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2b-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      registration.activate({ path: repo });
      const rebound = registration.rebind({
        path: repo,
        sentropicWorkspaceId: "sws-4711",
        issuer: "https://auth.sentropic.example.invalid",
      });
      const store = createLiveDeclarationStore(h2aRoot);
      const moved = store.update(
        rebound.declaration.declarationId,
        rebound.declaration.declarationRevision,
        (record) => ({
          ...record,
          declaration: {
            ...record.declaration,
            authorizedRoots: [join(base, "repo-moved")],
            declarationRevision: record.declaration.declarationRevision + 1,
          },
          updatedAt: "2026-10-12T00:00:04.000Z",
        }),
      );
      expect(moved.declaration.serverWorkspaceId).toBe("sws-4711");
      expect(moved.declaration.serverIssuer).toBe("https://auth.sentropic.example.invalid");
      expect(moved.declaration.bindingRevision).toBe(1);
      expect(moved.declaration.authorizedRoots).toEqual([join(base, "repo-moved")]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });

  it("gap5: identical, decreasing and first-too-high binding revisions are refused", () => {
    const h2aRoot = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2c-root-"));
    const base = mkdtempSync(join(tmpdir(), "h2a-live-l6a-f2c-base-"));
    try {
      const repo = makeRepo(join(base, "repo"));
      const registration = createLiveRegistration({
        root: h2aRoot,
        tenant: "local:test-owner",
        authority: allowAllAuthority,
      });
      const { declaration } = registration.activate({ path: repo });
      const store = createLiveDeclarationStore(h2aRoot);
      const id = declaration.declaration.declarationId;
      const rev = declaration.declaration.declarationRevision;

      // First binding above INITIAL_BINDING_REVISION is refused.
      expect(() =>
        store.update(id, rev, (record) => ({
          ...record,
          declaration: {
            ...record.declaration,
            serverWorkspaceId: "sws-9",
            serverIssuer: "https://auth.sentropic.example.invalid",
            bindingRevision: INITIAL_BINDING_REVISION + 1,
            declarationRevision: record.declaration.declarationRevision + 1,
          },
          updatedAt: "2026-10-12T00:00:05.000Z",
        })),
      ).toThrow(/first product binding/);

      const rebound = registration.rebind({
        path: repo,
        sentropicWorkspaceId: "sws-4711",
        issuer: "https://auth.sentropic.example.invalid",
      });
      // Identical binding revision is refused (strictly increasing only).
      expect(() =>
        store.update(
          id,
          rebound.declaration.declarationRevision,
          (record) => ({
            ...record,
            declaration: {
              ...record.declaration,
              serverWorkspaceId: "sws-4712",
              serverIssuer: "https://auth.sentropic.example.invalid",
              bindingRevision: rebound.declaration.bindingRevision,
              declarationRevision: record.declaration.declarationRevision + 1,
            },
            updatedAt: "2026-10-12T00:00:06.000Z",
          }),
        ),
      ).toThrow(/strictly increasing/);
      // Decreasing binding revision is refused.
      expect(() =>
        store.update(
          id,
          rebound.declaration.declarationRevision,
          (record) => ({
            ...record,
            declaration: {
              ...record.declaration,
              serverWorkspaceId: "sws-4713",
              serverIssuer: "https://auth.sentropic.example.invalid",
              bindingRevision: (rebound.declaration.bindingRevision ?? 1) - 1,
              declarationRevision: record.declaration.declarationRevision + 1,
            },
            updatedAt: "2026-10-12T00:00:07.000Z",
          }),
        ),
      ).toThrow(/strictly increasing/);
      // Partial triplet (workspace change without a fresh revision) is refused.
      expect(() =>
        store.update(
          id,
          rebound.declaration.declarationRevision,
          (record) => ({
            ...record,
            declaration: {
              ...record.declaration,
              serverWorkspaceId: "sws-4714",
              bindingRevision: undefined,
              declarationRevision: record.declaration.declarationRevision + 1,
            },
            updatedAt: "2026-10-12T00:00:08.000Z",
          }),
        ),
      ).toThrow(/complete.*triplet/);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(h2aRoot, { recursive: true, force: true });
    }
  });
});
