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
  gitStatusIsClean,
  parseVersion
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
