import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const runtime = "../../h2a-runtime/src/";

test("host obtains and mounts its engine through cluster-mesh composition", () => {
  const host = source(`${runtime}gateway-host/host.ts`);
  assert.match(host, /createClusterMeshModules/);
  assert.match(host, /createGatewayNamespaceModule/);
  assert.match(host, /authMode: "host"/);
  assert.match(host, /mounts: \{ "\/gw": "\/" \}/);
  assert.doesNotMatch(host, /import\s*\{[^}]*createGatewayRouter/s);
});

test("account presentation, public config and daemon have separate modules", () => {
  for (const path of ["llm-mesh-accounts.ts", "gateway-host/config-file.ts", "gateway-host/daemon.ts"]) {
    assert.ok(existsSync(new URL(runtime + path, import.meta.url)), path);
  }
  const oldFile = ["llm", "mesh.ts"].join("-");
  assert.ok(!existsSync(new URL(runtime + oldFile, import.meta.url)));
  assert.doesNotMatch(source(`${runtime}index.ts`), /LlmMeshManager/);
});

test("routing preferences delegate policy validation to the upstream API", () => {
  const preferences = source(`${runtime}routing-preferences.ts`);
  assert.match(preferences, /validateRoutePolicy/);
  assert.match(preferences, /InMemoryRoutePolicyProfiles/);
  assert.doesNotMatch(preferences, /const names = new Set/);
});

function verifyRetainedAdapter(entry) {
  const date = entry.decision?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  assert.ok(date, `dated owner decision required: ${entry.file}`);
  assert.equal(new Date(date).toISOString().slice(0, 10), date, 'the decision date must be valid');
  if (entry.specifier.startsWith('@sentropic/')) {
    assert.ok(entry.file.startsWith('scripts/xcli-') || entry.file === 'packages/h2a/focus-kit/test/distribution-fixture.mjs',
      'upstream bench exceptions must stay outside production sources');
    const [scope, provider, ...segments] = entry.specifier.split('/');
    assert.equal(scope, '@sentropic');
    assert.equal(provider, 'llm-mesh', 'only the retained mesh API is authorized for the bench');
    assert.ok(segments.every(segment => /^[a-zA-Z0-9_.-]+$/.test(segment) && !['.', '..'].includes(segment)));
    assert.match(entry.decision, /Owner directive/);
  } else assert.doesNotMatch(entry.specifier, /^@/);
}

test("only negative controls and owner-retained adapters remain allowed", () => {
  const allowlist = JSON.parse(source("../../../scripts/gateway-eradication-allowlist.json"));
  assert.ok(allowlist.every(({ classification }) => ["negative-assertion", "retained-h2a-adapter"].includes(classification)));
  for (const entry of allowlist.filter(({ classification }) => classification === "retained-h2a-adapter")) {
    verifyRetainedAdapter(entry);
  }
});

test('bench exceptions reject undated decisions, production imports, other providers and traversal', () => {
  const allowlist = JSON.parse(source('../../../scripts/gateway-eradication-allowlist.json'));
  const entry = allowlist.find(row => row.file === 'scripts/xcli-llm-mesh-seats.mjs' && row.specifier.endsWith('/facade'));
  assert.ok(entry);
  for (const changed of [
    { decision: undefined },
    { decision: 'Owner directive 2026-02-30: invalid date' },
    { file: 'packages/h2a/src/cli.ts' },
    { specifier: entry.specifier.replace('llm-mesh', 'llm-gateway') },
    { specifier: entry.specifier + '/../outside' },
  ]) assert.throws(() => verifyRetainedAdapter({ ...entry, ...changed }));
});

