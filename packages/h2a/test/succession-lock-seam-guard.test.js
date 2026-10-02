import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const seamName = "succession-lock-test-seam.mjs";
const seamFragment = "succession-lock-test-";

// Forbid the seam's name fragment anywhere in non-test code, even when the
// destination is split or interpolated. Also inspect decoded literal fragments
// so URL encoding and JavaScript escapes cannot hide the fragment.
function violations(source) {
  const file = ts.createSourceFile("consumer.ts", source, ts.ScriptTarget.Latest, true);
  const found = source.includes(seamFragment) ? [seamFragment] : [];
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      let destination = node.text;
      try { destination = decodeURIComponent(destination); } catch { /* Not a URL. */ }
      if (destination.includes(seamFragment)) found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function isTest(file) {
  return file.split("/").some((part) => ["test", "tests", "__tests__", "__fixtures__"].includes(part))
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

test("T-guard: no code outside tests depends on the separate lock seam", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0");
  const found = [];
  for (const file of tracked) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || isTest(file)) continue;
    for (const destination of violations(readFileSync(join(root, file), "utf8"))) {
      found.push({ file, destination });
    }
  }
  assert.deepEqual(found, []);
});

test("T-guard: every literal destination is rejected regardless of import syntax", () => {
  for (const source of [
    `import { __test } from "../test/${seamName}";`,
    `export * from "../test/${seamName}";`,
    `import("../test/${seamName}?rr3");`,
    `const load = createRequire(import.meta.url); load("../test/${seamName}");`,
    `const r = createRequire(import.meta.url); const alias = r; alias("../test/${seamName}#x");`,
    `new URL("../test/${seamName}", import.meta.url);`,
    `import("file:///repo/test/%73uccession-lock-test-seam.mjs?rr3");`,
    'import("../test/\\u0073uccession-lock-test-seam.mjs");',
    `import(\`../test/${seamName}?rr3\`);`,
    `import(\`../test/${seamName}?\${revision}\`);`
  ]) assert.notDeepEqual(violations(source), [], source);
  assert.deepEqual(violations('import("./succession-lock.js?rr3");'), []);
});

test("T-guard: split literals cannot reference the seam", () => {
  const source = 'import("../../test/succession-lock-test-" + "seam.mjs");';
  assert.notDeepEqual(violations(source), [], source);
});

test("T-guard: interpolated templates cannot reference the seam", () => {
  const source = 'import(`../../test/succession-lock-test-${n}.mjs`);';
  assert.notDeepEqual(violations(source), [], source);
});

test("T-guard: dist, the npm pack tarball and package exports cannot load the seam", async () => {
  const dist = join(root, "packages/h2a/dist");
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        assert.equal(entry.name.includes(seamFragment), false, path);
        const source = readFileSync(path, "utf8");
        assert.equal(source.includes(seamFragment), false, path);
        if (/\.[cm]?[jt]s$/.test(entry.name)) assert.deepEqual(violations(source), [], path);
      }
    }
  }
  walk(dist);
  const packed = mkdtempSync(join(tmpdir(), "h2a-seam-pack-"));
  try {
    execFileSync("npm", ["pack", "--json", "--pack-destination", packed], {
      cwd: join(root, "packages/h2a"), encoding: "utf8"
    });
    const archives = readdirSync(packed).filter((name) => name.endsWith(".tgz"));
    assert.equal(archives.length, 1);
    execFileSync("tar", ["-xzf", join(packed, archives[0]), "-C", packed]);
    walk(join(packed, "package"));
  } finally {
    rmSync(packed, { recursive: true, force: true });
  }
  assert.equal(existsSync(join(dist, "runtime/local-files", seamName)), false);
  await assert.rejects(import("@sentropic/h2a/test/succession-lock-test-seam.mjs"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  const manifest = JSON.parse(readFileSync(join(root, "packages/h2a/package.json"), "utf8"));
  for (const entry of manifest.files) {
    assert.equal(resolve(root, "packages/h2a", "test", seamName).startsWith(resolve(root, "packages/h2a", entry) + "/"), false, entry);
  }
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  for (const suffix of ["", "?rr3"]) {
    const runtime = await import(new URL(`../dist/runtime/local-files/succession-lock.js${suffix}`, import.meta.url));
    assert.equal(Object.hasOwn(runtime, "__test"), false);
    assert.equal(Object.hasOwn(runtime, "PrefixLockHooks"), false);
    assert.equal(Object.hasOwn(runtime, "PrefixLockHookContext"), false);
  }
});
