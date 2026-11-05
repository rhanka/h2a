// RC2.mesh-consumer registry slice (B6 lot 1) — cell-level gates.
//
// Runs under the root `node --test` discovery like every other
// `packages/h2a/test/*.test.js` file. Registry slice only: the lane slice
// stays blocked by relay-1. No route, no transport, gates §5 closed.
//
// Socle sans effet : aucune route, aucun transport, gates §5 fermées.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const RUNTIME_DIR = join(REPO_ROOT, "packages", "h2a-runtime");
const MODULE_SRC = join(RUNTIME_DIR, "src", "mesh-consumer-origin.ts");
const MODULE_DIST = join(RUNTIME_DIR, "dist", "mesh-consumer-origin.js");
const FIXTURES_DIR = join(
  RUNTIME_DIR,
  "src",
  "fixtures",
  "session-content",
  "v3",
  "mesh-consumer-origin",
);

const MANIFEST_SHA256 =
  "6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readSource() {
  try {
    return readFileSync(MODULE_SRC, "utf8");
  } catch (err) {
    assert.fail(
      `registry-slice module missing: ${MODULE_SRC} (${err.message})`,
    );
  }
}

test("registry slice exposes no lane or relay surface", () => {
  const source = readSource();
  for (const token of [
    "SessionRelayLaneClientV1",
    "SessionRelayEndpointConnectorPortV1",
    "SessionRelayEndpointBindV1",
    "SessionRelayEndpointBoundV1",
    "SessionRelayPrepareRequestV1",
    "SessionRelayOpenV1",
    "sourceCredentials",
    "relay-prepare",
    "relay-upgrade",
    "inner-bind",
    "chat-events",
    "typed-events",
    "pty-fragments",
    "archive-snapshot",
    "archive-segment",
    "action-stream",
    "action-claim",
    "action-result",
    "history-auth",
    "history-admission",
    "continuity-ack",
    "drive-binding",
    "Connector",
    "LaneClient",
  ]) {
    assert.ok(
      !source.includes(token),
      `lane/relay token leaks into the registry slice: ${token}`,
    );
  }
});

test("registry slice carries no route and no transport", () => {
  const source = readSource();
  for (const pattern of [
    /\bfrom\s+["']node:(net|tls|http|http2|dgram)["']/,
    /\bfrom\s+["'](ws|undici|node-fetch)["']/,
    /\bnew\s+WebSocket\s*\(/,
    /\bglobalThis\s*\.\s*fetch\s*\(/,
    /createServer\s*\(/,
    /\.listen\s*\(/,
  ]) {
    assert.ok(
      !pattern.test(source),
      `transport surface in the registry slice: ${pattern}`,
    );
  }
});

test("registry slice imports the published archive root only", () => {
  const source = readSource();
  assert.ok(!source.includes("cluster-mesh/src"));
  assert.ok(!/require\(\s*["']@sentropic\/cluster-mesh/.test(source));
  assert.ok(!/from\s+["']@sentropic\/cluster-mesh["']/.test(source));
  assert.match(
    source,
    /import\(\s*["']@sentropic\/cluster-mesh["']\s*\)/,
  );
  const deepUses = source.match(/@sentropic\/cluster-mesh\/[^"'`\s)]+/g) ?? [];
  for (const use of deepUses) {
    assert.equal(
      use,
      "@sentropic/cluster-mesh/package.json",
      `deep published path beyond the version metadata: ${use}`,
    );
  }
  assert.ok(!source.includes("remote-protocol"));
  assert.ok(!source.includes("remote-k8s-orchestrator"));
});

test("installed archive provides no origin-registry factory (incompatible-version)", async () => {
  const href = import.meta.resolve("@sentropic/cluster-mesh");
  let dir = dirname(fileURLToPath(href));
  let version = null;
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (meta.name === "@sentropic/cluster-mesh") {
        version = meta.version;
        break;
      }
    } catch {
      /* keep climbing past dist layouts */
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  assert.ok(typeof version === "string" && version.length > 0);
  const mesh = await import("@sentropic/cluster-mesh");
  assert.equal(
    typeof mesh.createSessionOriginRegistry,
    "undefined",
    "registry-bearing export unexpectedly present; slice must be re-cut",
  );
});

test("built composition refuses with the typed code and zero effect", async () => {
  let mod;
  try {
    mod = await import(MODULE_DIST);
  } catch (err) {
    assert.fail(
      `registry-slice dist missing (run tsc -b packages/h2a-runtime): ${err.message}`,
    );
  }
  assert.equal(
    mod.MESH_ORIGIN_R3_PIN.manifestSha256,
    MANIFEST_SHA256,
  );
  let resolveCalls = 0;
  const consumer = await mod.createMeshOriginConsumer({
    resolveSession: () => {
      resolveCalls += 1;
      return null;
    },
  });
  assert.equal(consumer.status, "unavailable");
  assert.equal(consumer.exportPresent, false);
  assert.equal(consumer.refusal.error.code, "relay_grant_unavailable");
  assert.equal(consumer.refusal.error.retryable, true);
  assert.equal(consumer.refusal.reason, "incompatible-version");
  const refused = await consumer.snapshot({ sessionRef: "fixture" });
  assert.equal(refused.status, "unavailable");
  assert.equal(resolveCalls, 0);
});

test("pinned registry vectors match the r3 bytes", () => {
  const pin = JSON.parse(readFileSync(join(FIXTURES_DIR, "pin.json"), "utf8"));
  assert.equal(pin.manifestSha256, MANIFEST_SHA256);
  assert.equal(pin.revision, "r3");
  const names = Object.keys(pin.vectors).sort();
  assert.deepEqual(names, [
    "port-SessionOriginRegistryPortV1-ingestCapabilities.json",
    "port-SessionOriginRegistryPortV1-ingestLifecycle.json",
    "port-SessionOriginRegistryPortV1-publishListing.json",
    "port-SessionOriginRegistryPortV1-renewFreshness.json",
    "port-SessionOriginRegistryPortV1-snapshot.json",
    "registry-revision-digests.json",
  ]);
  for (const name of names) {
    const bytes = readFileSync(join(FIXTURES_DIR, "vectors", name));
    assert.equal(sha256Hex(bytes), pin.vectors[name], `hash drift: ${name}`);
  }
});

test("mesh-consumer lot pins no new dependency", () => {
  const pkg = JSON.parse(
    readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"),
  );
  assert.equal(pkg.dependencies["@sentropic/cluster-mesh"], "0.22.4");
});
