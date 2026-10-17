import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const REPO_ROOT = new URL("../../../", import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, REPO_ROOT), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const H2A_PKG = readJson("packages/h2a/package.json");
const TRACK_PKG = readJson("packages/track/package.json");

// Normative parameter bodies: contract registry-entry-contract-v8 §5.4.
const NORMATIVE_PARAMS = {
  "sentropic.h2a": {
    schemaVersion: "1.1.0",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:sentropic:registry:parameters:sentropic.h2a:1.1.0",
      type: "object",
      additionalProperties: false,
      required: ["mode", "serviceBindingRef"],
      properties: {
        mode: { enum: ["shared-central", "hosted-read-only"] },
        serviceBindingRef: { type: "string", minLength: 1, maxLength: 96, pattern: "^[a-z0-9][a-z0-9._-]*$" }
      }
    },
    defaults: { mode: "shared-central" }
  },
  "sentropic.track": {
    schemaVersion: "1.0.0",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:sentropic:registry:parameters:sentropic.track:1.0.0",
      type: "object",
      additionalProperties: false,
      required: ["access", "repositoryBindingRef"],
      properties: {
        access: { const: "read-only" },
        repositoryBindingRef: { type: "string", minLength: 1, maxLength: 96, pattern: "^[a-z0-9][a-z0-9._-]*$" }
      }
    },
    defaults: { access: "read-only" }
  }
};

async function loadLib() {
  return import("../dist/registry/descriptors.js");
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r5-desc-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("R5 descriptors: h2a and track entries.v1.json exist with contract envelope", async () => {
  const { validateRegistryEntry } = await loadLib();
  for (const [rel, pkgDir, pkg] of [
    ["packages/h2a/registry/entries.v1.json", "packages/h2a", H2A_PKG],
    ["packages/track/registry/entries.v1.json", "packages/track", TRACK_PKG]
  ]) {
    const raw = readFileSync(new URL(rel, REPO_ROOT));
    const wrapper = JSON.parse(raw.toString("utf8"));
    assert.equal(wrapper.format, "sentropic.registry-package/v1");
    assert.equal(wrapper.entries.length, 1);
    const checked = validateRegistryEntry(wrapper.entries[0]);
    assert.equal(checked.entry.format, "sentropic.registry-entry/v1");
    assert.equal(checked.entry.contractVersion, "1.1.4");
    assert.equal(checked.entry.kind, "mcp");
    assert.equal(typeof checked.digest, "string");
    assert.match(checked.digest, /^[0-9a-f]{64}$/);
    assert.equal(checked.entry.publisher.packageVersion, pkg.version);
    void pkgDir;
  }
});

test("R5 descriptors: exact entry ids and parameter profiles", async () => {
  const { validateRegistryEntry } = await loadLib();
  const h2a = validateRegistryEntry(readJson("packages/h2a/registry/entries.v1.json").entries[0]).entry;
  const track = validateRegistryEntry(readJson("packages/track/registry/entries.v1.json").entries[0]).entry;
  assert.equal(h2a.id, "sentropic.h2a");
  assert.equal(track.id, "sentropic.track");
  for (const entry of [h2a, track]) {
    const normative = NORMATIVE_PARAMS[entry.id];
    assert.deepEqual(entry.parameters.schemaVersion, normative.schemaVersion);
    assert.deepEqual(entry.parameters.schema, normative.schema);
    assert.deepEqual(entry.parameters.defaults, normative.defaults);
  }
});

test("R5 descriptors: asset digests verify over exact file bytes", async () => {
  const { validateRegistryEntry, verifyAssetClosure } = await loadLib();
  for (const pkgDir of ["packages/h2a", "packages/track"]) {
    const wrapper = readJson(`${pkgDir}/registry/entries.v1.json`);
    const checked = validateRegistryEntry(wrapper.entries[0]);
    for (const asset of checked.entry.assets) {
      const bytes = readFileSync(new URL(`${pkgDir}/${asset.path}`, REPO_ROOT));
      assert.equal(sha256(bytes), asset.sha256, `${pkgDir}/${asset.path} digest`);
    }
    verifyAssetClosure(checked.entry, pkgDir, (rel) => readFileSync(new URL(`${pkgDir}/${rel}`, REPO_ROOT)));
  }
});

test("R5 descriptors: entry digest is stable and tamper-evident", async () => {
  const { validateRegistryEntry, digestDescriptor } = await loadLib();
  const entry = readJson("packages/h2a/registry/entries.v1.json").entries[0];
  assert.equal(digestDescriptor(entry), digestDescriptor(structuredClone(entry)));
  const tampered = structuredClone(entry);
  tampered.description += "!";
  assert.notEqual(digestDescriptor(tampered), digestDescriptor(entry));
  assert.throws(
    () => validateRegistryEntry(tampered, { expectedDigest: digestDescriptor(entry) }),
    /integrity_mismatch/
  );
});

test("R5 descriptors: publisher package ships registry files and exports", () => {
  for (const [pkg, dir] of [[H2A_PKG, "packages/h2a"], [TRACK_PKG, "packages/track"]]) {
    assert.ok((pkg.files ?? []).some((f) => f.startsWith("registry")), `${dir} files[] ships registry/`);
    assert.ok(pkg.exports?.["./registry/manifest"], `${dir} exports ./registry/manifest`);
  }
  assert.ok(H2A_PKG.exports?.["./registry/definitions"], "packages/h2a exports ./registry/definitions");
});

test("R5 descriptors: closed envelope refuses unknown fields and bad contract", async () => {
  const { validateRegistryEntry } = await loadLib();
  const entry = readJson("packages/h2a/registry/entries.v1.json").entries[0];
  assert.throws(() => validateRegistryEntry({ ...structuredClone(entry), unknownField: 1 }), /invalid_entry/);
  assert.throws(() => validateRegistryEntry({ ...structuredClone(entry), contractVersion: "9.9.9" }), /incompatible_version|invalid_entry/);
  assert.throws(
    () => validateRegistryEntry({ ...structuredClone(entry), parameters: { schemaVersion: "9.9.9", schema: {}, defaults: {} } }),
    /invalid_parameters|unsupported_schema_profile|invalid_entry/
  );
});

test("R5 descriptors: tampered asset bytes fail closure in an isolated copy", async () => {
  const { validateRegistryEntry, verifyAssetClosure } = await loadLib();
  await withTempDir((dir) => {
    const entry = validateRegistryEntry(readJson("packages/h2a/registry/entries.v1.json").entries[0]).entry;
    const asset = entry.assets[0];
    const original = readFileSync(new URL(`packages/h2a/${asset.path}`, REPO_ROOT));
    const copy = join(dir, "manifest.json");
    writeFileSync(copy, Buffer.concat([original, Buffer.from(" ")]));
    assert.throws(
      () => verifyAssetClosure(entry, ".", (rel) => (rel === asset.path ? readFileSync(copy) : original)),
      /integrity_mismatch/
    );
  });
});
