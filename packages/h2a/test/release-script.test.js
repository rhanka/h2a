// Unit tests for the pure helpers exported by `scripts/release.mjs`.
//
// The CLI portion of the script (spawning npm + git) is deliberately not
// integration-tested here: spinning up a throw-away git repo with a working
// `npm test` inside CI is too brittle for marginal value. The two helpers
// (`parseVersion`, `bumpPackageJsonContent`) carry all the
// release-correctness logic that is not just a thin wrapper on top of `git`
// / `npm` invocations, so unit-testing them directly is what matters.

import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const RELEASE_SCRIPT = resolve(HERE, "..", "..", "..", "scripts", "release.mjs");

// DEC-062: on Windows the absolute path starts with `D:\` and Node's ESM
// loader rejects it as an unsupported protocol; the import must be a
// file:// URL.
const {
  bumpPackageJsonContent,
  bumpPackageLockContent,
  formatNextSteps,
  gitStatusIsClean,
  parseVersion,
  planReleaseGitSteps,
  resolveReleaseBranch
} = await import(pathToFileURL(RELEASE_SCRIPT).href);

test("parseVersion accepts strict X.Y.Z and returns numeric components", () => {
  assert.deepEqual(parseVersion("0.0.0"), { major: 0, minor: 0, patch: 0 });
  assert.deepEqual(parseVersion("0.99.99"), { major: 0, minor: 99, patch: 99 });
  assert.deepEqual(parseVersion("12.34.56"), { major: 12, minor: 34, patch: 56 });
});

test("parseVersion rejects bad inputs", () => {
  assert.throws(() => parseVersion("v0.2.0"));        // no leading 'v'
  assert.throws(() => parseVersion("0.2"));           // missing patch
  assert.throws(() => parseVersion("0.2.0-rc.1"));    // pre-release
  assert.throws(() => parseVersion("0.2.0+build"));   // build metadata
  assert.throws(() => parseVersion("01.2.3"));         // leading zero
  assert.throws(() => parseVersion("1.02.3"));         // leading zero
  assert.throws(() => parseVersion("1.2.03"));         // leading zero
  assert.throws(() => parseVersion(""));              // empty
  assert.throws(() => parseVersion(undefined));       // wrong type
  assert.throws(() => parseVersion(0.2));             // wrong type
});

test("bumpPackageJsonContent updates the version field", () => {
  const input = JSON.stringify({ name: "@sentropic/h2a", version: "0.1.0" }, null, 2);
  const out = bumpPackageJsonContent(input, "0.2.0");
  const parsed = JSON.parse(out);
  assert.equal(parsed.version, "0.2.0");
  assert.equal(parsed.name, "@sentropic/h2a");
});

test("bumpPackageJsonContent rewrites the @sentropic/h2a dep to ^X.Y.Z", () => {
  const input = JSON.stringify(
    {
      name: "@sentropic/h2a-cli",
      version: "0.1.1",
      dependencies: { "@sentropic/h2a": "^0.1.0" }
    },
    null,
    2
  );
  const out = bumpPackageJsonContent(input, "0.2.0");
  const parsed = JSON.parse(out);
  assert.equal(parsed.version, "0.2.0");
  assert.equal(parsed.dependencies["@sentropic/h2a"], "^0.2.0");
});

test("bumpPackageJsonContent rewrites the @sentropic/track dep to ^X.Y.Z (lockstep)", () => {
  const input = JSON.stringify(
    {
      name: "@sentropic/h2a",
      version: "0.82.0",
      dependencies: {
        "@sentropic/track": "^0.26.0",
        hono: "^4.12.23"
      }
    },
    null,
    2
  );
  const out = bumpPackageJsonContent(input, "0.83.0");
  const parsed = JSON.parse(out);
  assert.equal(parsed.version, "0.83.0");
  assert.equal(parsed.dependencies["@sentropic/track"], "^0.83.0");
  // Non-lockstep deps are left untouched.
  assert.equal(parsed.dependencies.hono, "^4.12.23");
});

test("bumpPackageJsonContent keeps the required runtime peer in lockstep", () => {
  const input = JSON.stringify(
    {
      name: "@sentropic/h2a",
      version: "0.93.1",
      peerDependencies: { "@sentropic/h2a-runtime": "^0.93.1" }
    },
    null,
    2
  );
  const parsed = JSON.parse(bumpPackageJsonContent(input, "0.94.0"));
  assert.equal(parsed.peerDependencies["@sentropic/h2a-runtime"], "^0.94.0");
});

test("bumpPackageJsonContent leaves the @sentropic/h2a dep alone when absent", () => {
  const input = JSON.stringify(
    { name: "@sentropic/h2a", version: "0.1.0", dependencies: { typescript: "^5" } },
    null,
    2
  );
  const out = bumpPackageJsonContent(input, "0.2.0");
  const parsed = JSON.parse(out);
  assert.equal(parsed.dependencies.typescript, "^5");
  assert.equal(parsed.dependencies["@sentropic/h2a"], undefined);
});

test("bumpPackageJsonContent preserves trailing newline state", () => {
  const withNl = JSON.stringify({ name: "x", version: "0.0.1" }, null, 2) + "\n";
  const withoutNl = JSON.stringify({ name: "x", version: "0.0.1" }, null, 2);
  assert.ok(bumpPackageJsonContent(withNl, "0.0.2").endsWith("\n"));
  assert.ok(!bumpPackageJsonContent(withoutNl, "0.0.2").endsWith("\n"));
});

test("bumpPackageJsonContent validates the new version through parseVersion", () => {
  const input = JSON.stringify({ name: "x", version: "0.0.1" }, null, 2);
  assert.throws(() => bumpPackageJsonContent(input, "v0.2.0"));
  assert.throws(() => bumpPackageJsonContent(input, "0.2"));
});

test("bumpPackageLockContent updates root and workspace package versions", () => {
  const input = `${JSON.stringify(
    {
      name: "h2a",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "h2a", version: "0.1.0" },
        "packages/h2a": { name: "@sentropic/h2a", version: "0.1.0" },
        "packages/h2a-cli": {
          name: "@sentropic/h2a-cli",
          version: "0.1.1",
          dependencies: { "@sentropic/h2a": "^0.1.0" }
        }
      }
    },
    null,
    2
  )}\n`;
  const out = bumpPackageLockContent(input, "0.2.0");
  const parsed = JSON.parse(out);
  assert.equal(parsed.version, "0.2.0");
  assert.equal(parsed.packages[""].version, "0.2.0");
  assert.equal(parsed.packages["packages/h2a"].version, "0.2.0");
  assert.equal(parsed.packages["packages/h2a-cli"].version, "0.2.0");
  assert.equal(
    parsed.packages["packages/h2a-cli"].dependencies["@sentropic/h2a"],
    "^0.2.0"
  );
  assert.ok(out.endsWith("\n"));
});

test("bumpPackageLockContent bumps packages/track and rewrites its caret in packages/h2a", () => {
  const input = `${JSON.stringify(
    {
      name: "h2a",
      version: "0.82.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "h2a", version: "0.82.0" },
        "packages/h2a": {
          name: "@sentropic/h2a",
          version: "0.82.0",
          dependencies: { "@sentropic/track": "^0.26.0", hono: "^4.12.23" }
        },
        "packages/track": { name: "@sentropic/track", version: "0.26.0" },
        // A transitive registry copy of track (nested under another dep) must
        // NOT be touched — only workspace `packages/*` entries are lockstep.
        "node_modules/@sentropic/focus/node_modules/@sentropic/track": {
          version: "0.17.0"
        }
      }
    },
    null,
    2
  )}\n`;
  const out = bumpPackageLockContent(input, "0.83.0");
  const parsed = JSON.parse(out);
  assert.equal(parsed.packages["packages/track"].version, "0.83.0");
  assert.equal(parsed.packages["packages/h2a"].version, "0.83.0");
  assert.equal(
    parsed.packages["packages/h2a"].dependencies["@sentropic/track"],
    "^0.83.0"
  );
  assert.equal(parsed.packages["packages/h2a"].dependencies.hono, "^4.12.23");
  // The nested registry copy keeps its own version.
  assert.equal(
    parsed.packages[
      "node_modules/@sentropic/focus/node_modules/@sentropic/track"
    ].version,
    "0.17.0"
  );
});

test("bumpPackageLockContent validates the new version through parseVersion", () => {
  const input = JSON.stringify({ name: "h2a", version: "0.1.0", packages: {} });
  assert.throws(() => bumpPackageLockContent(input, "01.2.3"));
});

test("gitStatusIsClean accepts empty porcelain output only", () => {
  assert.equal(gitStatusIsClean(""), true);
  assert.equal(gitStatusIsClean("\n"), true);
  assert.equal(gitStatusIsClean(" M package.json\n"), false);
  assert.equal(gitStatusIsClean("?? scripts/release.mjs\n"), false);
});

// PR-only `main` (branch protection applies to admins too): the version
// commit must land on a branch, go through a PR with green CI, and the tag is
// created only AFTER the merge, on the merged commit verified on origin/main.

test("resolveReleaseBranch creates release/vX.Y.Z when launched from main", () => {
  assert.deepEqual(resolveReleaseBranch("main", "0.2.0"), {
    branch: "release/v0.2.0",
    create: true
  });
});

test("resolveReleaseBranch keeps the current non-main branch (bump inside the feature PR)", () => {
  assert.deepEqual(resolveReleaseBranch("feat/foo", "0.2.0"), {
    branch: "feat/foo",
    create: false
  });
  assert.deepEqual(resolveReleaseBranch("release/v0.2.0", "0.2.0"), {
    branch: "release/v0.2.0",
    create: false
  });
});

test("resolveReleaseBranch refuses a detached HEAD or an empty branch name", () => {
  assert.throws(() => resolveReleaseBranch("HEAD", "0.2.0"), /detached/i);
  assert.throws(() => resolveReleaseBranch("", "0.2.0"), /detached/i);
  assert.throws(() => resolveReleaseBranch("main", "v0.2.0"));
});

test("planReleaseGitSteps from main switches to release/vX.Y.Z before committing", () => {
  const { branch, steps } = planReleaseGitSteps({ version: "0.2.0", currentBranch: "main" });
  assert.equal(branch, "release/v0.2.0");
  const switchIdx = steps.findIndex(
    (s) => s.command === "git" && s.args[0] === "switch" && s.args.includes("release/v0.2.0")
  );
  const commitIdx = steps.findIndex((s) => s.command === "git" && s.args[0] === "commit");
  assert.ok(switchIdx >= 0, "expected a `git switch -c release/v0.2.0` step");
  assert.ok(commitIdx > switchIdx, "commit must happen after leaving main");
  assert.deepEqual(steps[commitIdx].args, ["commit", "-m", "release: v0.2.0"]);
});

test("planReleaseGitSteps never commits on main and never creates a tag", () => {
  for (const currentBranch of ["main", "feat/foo"]) {
    const { steps } = planReleaseGitSteps({ version: "0.2.0", currentBranch });
    assert.equal(
      steps.some((s) => s.command === "git" && s.args[0] === "tag"),
      false,
      `no local tag before merge (from ${currentBranch})`
    );
    assert.equal(
      steps.some((s) => s.command === "git" && s.args[0] === "push"),
      false,
      "the script never touches the network"
    );
  }
  const fromFeature = planReleaseGitSteps({ version: "0.2.0", currentBranch: "feat/foo" });
  assert.equal(fromFeature.branch, "feat/foo");
  assert.equal(
    fromFeature.steps.some((s) => s.args[0] === "switch"),
    false,
    "stays on the feature branch"
  );
});

test("formatNextSteps describes branch push -> PR -> CI -> merge -> tag on merged commit", () => {
  const text = formatNextSteps({ version: "0.2.0", branch: "release/v0.2.0" });
  assert.equal(text.includes("git push origin HEAD"), false, "direct push to main is refused");
  const order = [
    "git push -u origin release/v0.2.0",
    "gh pr create",
    "gh pr checks release/v0.2.0 --watch",
    "gh pr merge release/v0.2.0",
    "git fetch origin main",
    "git merge-base --is-ancestor",
    "git tag -a v0.2.0",
    "git push origin v0.2.0"
  ];
  let cursor = -1;
  for (const needle of order) {
    const at = text.indexOf(needle);
    assert.ok(at > cursor, `expected "${needle}" after previous step`);
    cursor = at;
  }
});

test("formatNextSteps uses a signed tag when requested", () => {
  const text = formatNextSteps({ version: "0.2.0", branch: "feat/foo", signTag: true });
  assert.match(text, /git tag -s -a v0\.2\.0/);
});
