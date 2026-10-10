import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("CI selects existing runtime tests after the gateway module moves", () => {
  const root = new URL("../../../", import.meta.url);
  const ci = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
  const paths = [...ci.matchAll(/packages\/h2a-runtime\/src\/[\w/-]+\.test\.ts/g)].map(([path]) => path);
  assert.ok(paths.length > 0);
  for (const path of paths) assert.ok(existsSync(new URL(path, root)), path);
});

test("runtime builds clean their distribution before emitting renamed modules", () => {
  const runtime = JSON.parse(readFileSync(new URL("../../h2a-runtime/package.json", import.meta.url), "utf8"));
  assert.match(runtime.scripts?.build ?? "", /clean-workspace-dist/);
  const root = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(root.scripts.build, /npm run build -w @sentropic\/h2a-runtime/);
  assert.match(root.scripts.build, /npm exec -w @sentropic\/h2a-runtime --call "node [^&]*clean-workspace-dist\.mjs" && tsc -b --force$/);
  for (const filename of [["llm", "mesh.js"].join("-"), ["llm", "routing", "config.js"].join("-"), ["llm", "gateway", "runtime"].join("-")]) {
    assert.ok(!existsSync(new URL(`../../h2a-runtime/dist/${filename}`, import.meta.url)), filename);
  }
});
