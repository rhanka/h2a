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

test("only negative controls and owner-retained adapters remain allowed", () => {
  const allowlist = JSON.parse(source("../../../scripts/gateway-eradication-allowlist.json"));
  assert.ok(allowlist.every(({ classification }) => ["negative-assertion", "retained-h2a-adapter"].includes(classification)));
  for (const entry of allowlist.filter(({ classification }) => classification === "retained-h2a-adapter")) {
    assert.match(entry.decision, /2026-10-03/);
    assert.doesNotMatch(entry.specifier, /@sentropic/);
  }
});

