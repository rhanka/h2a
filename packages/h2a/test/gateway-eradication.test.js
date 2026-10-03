import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compareAllowlist, scanRepository, scanSource } from "../../../scripts/gateway-eradication-guard.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("gateway eradication ratchet rejects new violations and obsolete allowances", () => {
  const allowlist = JSON.parse(readFileSync(new URL("../../../scripts/gateway-eradication-allowlist.json", import.meta.url), "utf8"));
  for (const entry of allowlist) {
    assert.ok(["historical", "negative-assertion"].includes(entry.classification), JSON.stringify(entry));
    assert.ok(entry.reason?.length > 0, JSON.stringify(entry));
  }
  assert.equal(new Set(allowlist.map(({ file, specifier }) => JSON.stringify([file, specifier]))).size, allowlist.length);
  assert.deepEqual(compareAllowlist(scanRepository(root), allowlist), { unexpected: [], stale: [] });
});

test("guard covers import forms, resolution strings and computed literals", () => {
  // These are negative controls, explicitly classified in the ratchet allowlist.
  const provider = "@sentropic/llm-mesh/facade";
  for (const code of [
    `import { facade } from '${provider}';`,
    `import type { Facade } from '${provider}';`,
    `export { facade } from '${provider}';`,
    `import('${provider}');`,
    `require('${provider}');`,
    `createRequire(import.meta.url)('${provider}');`,
    `import.meta.resolve('${provider}');`,
    `resolver.resolve('${provider}');`,
    "import('@sentropic/' + 'llm-gateway/auth');",
    "require('@sentropic/llm-\\u006desh');",
    "import(`@sentropic/${'llm-mesh'}/node`);",
  ]) {
    assert.ok(scanSource("fixture.ts", code).length > 0, code);
  }
  assert.deepEqual(scanSource("fixture.ts", "import('@sentropic/cluster-mesh/gateway');"), []);
  assert.ok(scanSource("fixture.sh", "ln -s other node_modules/@sentropic/llm-mesh").length > 0);
  assert.ok(scanSource("scripts/dev-test-local.sh", "ln -s other local").length > 0);
  assert.ok(scanSource("fixture.ts", "import './llm-gateway-runtime/index.js'").length > 0);
  assert.ok(scanSource("fixture.ts", "import './llm-mesh.js'; import './llm-routing-config.js'").length > 0);
  assert.ok(scanSource("fixture.mjs", "import './vitest.llm-mesh-pin.mjs'").length > 0);
});

test("ratchet requires shrinking and refuses unclassified additions", () => {
  const entry = { file: "fixture.ts", specifier: "blocked" };
  assert.deepEqual(compareAllowlist([entry], []), { unexpected: [entry], stale: [] });
  assert.deepEqual(compareAllowlist([], [entry]), { unexpected: [], stale: [entry] });
  assert.deepEqual(compareAllowlist([entry], [entry]), { unexpected: [], stale: [] });
});
