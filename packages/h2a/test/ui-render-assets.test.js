import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FOCUS_DECISION_DOSSIER_V1_SHA256,
  loadUiRenderAssets
} from "../dist/index.js";

/**
 * json-render L3.1 — the vendored asset loader (h2a spec §7.2): every file of
 * packages/h2a/vendor/design-system-elements is verified by sha256 against
 * manifest.json before the module serves anything; a tampered or foreign file
 * refuses with a deterministic integrity_mismatch error.
 */

test("loadUiRenderAssets: the vendored snapshot loads and exposes the pinned artifacts", async () => {
  const assets = await loadUiRenderAssets();
  assert.equal(assets.manifest.format, "h2a.ds-elements-vendor/v1");
  assert.equal(assets.manifest.sourceCommit, "cc29be886b543ffa29592afbc6b4482c104b1fb4");
  assert.equal(
    assets.manifest.sourceTar.sha256,
    "7b20326c2bc8219d44648979e3a94c1f8519bb3938bea7e9a0d2f2de47bb99d4"
  );
  assert.equal(
    assets.manifest.sourceTar.manifestSha256,
    "a50eb84e0b470c5d57c1da6101e1032ce602ae43ea5c399a5d76e6e55b33a965"
  );
  assert.equal(Object.keys(assets.manifest.files).length, 29);
  assert.equal(
    assets.manifest.files["catalog.json"].sha256,
    "f2358a8f96cdf28949d1b17f7c29c287201efb53c6b8ba709b4a27165206a36c"
  );
  assert.equal(
    assets.manifest.files["envelope.json"].sha256,
    "6bf3351ba45c90a0dd3b40a7e7eddf019e72379a4551acc07a89f4436fc6cf2e"
  );
  assert.equal(assets.manifest.packageVersion, "0.1.0");
  assert.equal(assets.sri.version, "0.1.0");
  assert.equal(
    assets.manifest.files["dist/browser/sri.json"].sha256,
    "0979a58b9c10fc9d02189ac20d43f070a645e897e5966b5b4ddfcf93b2bc9193"
  );
  assert.equal(assets.catalog.catalogId, "https://design-system.sent-tech.ca/catalogs/elements/v1/catalog.json");
  assert.equal(assets.envelopeSchema.$id, "https://design-system.sent-tech.ca/catalogs/elements/v1/envelope.json");
  assert.deepEqual(Object.keys(assets.schemas).sort(), ["BarChart", "BpmnCanvas", "DecisionDossier"]);
  assert.ok(assets.sri.files["elements.js"].integrity.startsWith("sha384-"));
});

test("a tampered catalog.json refuses integrity_mismatch", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-uirender-tamper-"));
  try {
    const vendorCopy = join(scratch, "vendor");
    cpSync(new URL("../vendor/design-system-elements", import.meta.url), vendorCopy, { recursive: true });
    const catalogPath = join(vendorCopy, "catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalog.components.BarChart["x-sentropic"].contract = "9.9";
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
    await assert.rejects(
      () => loadUiRenderAssets({ vendorDir: vendorCopy }),
      (error) => {
        assert.match(error.message, /integrity_mismatch/);
        return true;
      }
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("an extra file inside the vendor tree refuses integrity_mismatch (nothing else may be vendored)", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-uirender-extra-"));
  try {
    const vendorCopy = join(scratch, "vendor");
    cpSync(new URL("../vendor/design-system-elements", import.meta.url), vendorCopy, { recursive: true });
    writeFileSync(join(vendorCopy, "extra.txt"), "not part of the pinned build\n");
    await assert.rejects(
      () => loadUiRenderAssets({ vendorDir: vendorCopy }),
      (error) => {
        assert.match(error.message, /integrity_mismatch/);
        return true;
      }
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a missing file refuses integrity_mismatch", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-uirender-missing-"));
  try {
    const vendorCopy = join(scratch, "vendor");
    cpSync(new URL("../vendor/design-system-elements", import.meta.url), vendorCopy, { recursive: true });
    rmSync(join(vendorCopy, "schemas", "BarChart.v1.json"));
    await assert.rejects(
      () => loadUiRenderAssets({ vendorDir: vendorCopy }),
      (error) => {
        assert.match(error.message, /integrity_mismatch/);
        return true;
      }
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the catalogued focus semantic digest must equal the pinned @sentropic/focus v1 schema digest", async () => {
  const assets = await loadUiRenderAssets();
  const declared = assets.catalog.components.DecisionDossier["x-sentropic"].semantic.sha256;
  assert.equal(declared, FOCUS_DECISION_DOSSIER_V1_SHA256);
  assert.equal(
    FOCUS_DECISION_DOSSIER_V1_SHA256,
    "725bc07e7c6b6ad51a1f720cc9fb02649d8f31bc54e71c61c350fd20058c8852"
  );
});

test("loadUiRenderAssets verifies the declared focus digest, refusing a disagreeing catalog", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-uirender-semantic-"));
  try {
    const vendorCopy = join(scratch, "vendor");
    cpSync(new URL("../vendor/design-system-elements", import.meta.url), vendorCopy, { recursive: true });
    // Rewrite the catalog with a wrong semantic digest, then re-pin its
    // manifest entry so ONLY the semantic check can refuse.
    const catalogPath = join(vendorCopy, "catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalog.components.DecisionDossier["x-sentropic"].semantic.sha256 = "0".repeat(64);
    const catalogText = JSON.stringify(catalog, null, 2) + "\n";
    writeFileSync(catalogPath, catalogText);
    const manifestPath = join(vendorCopy, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { createHash } = await import("node:crypto");
    manifest.files["catalog.json"].sha256 = createHash("sha256").update(catalogText).digest("hex");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    await assert.rejects(
      () => loadUiRenderAssets({ vendorDir: vendorCopy }),
      (error) => {
        assert.match(error.message, /integrity_mismatch/);
        return true;
      }
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the developer workspace override is refused unless its pinned digests match", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-uirender-workspace-"));
  try {
    const workspace = join(scratch, "elements-build");
    mkdirSync(workspace, { recursive: true });
    // An arbitrary build that disagrees with the pinned catalog digest.
    const catalog = { catalogId: "https://example.com/foreign.json", components: {} };
    writeFileSync(join(workspace, "catalog.json"), JSON.stringify(catalog));
    await assert.rejects(
      () => loadUiRenderAssets({ workspaceDir: workspace }),
      (error) => {
        assert.match(error.message, /integrity_mismatch/);
        return true;
      }
    );
    // The real vendored files, laid out as a workspace dir, ARE admitted.
    const healthy = join(scratch, "healthy-build");
    mkdirSync(healthy, { recursive: true });
    const vendorDir = new URL("../vendor/design-system-elements", import.meta.url);
    for (const rel of ["catalog.json", "envelope.json", "dist/browser/sri.json"]) {
      const target = join(healthy, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      cpSync(join(vendorDir.pathname, rel), target);
    }
    const assets = await loadUiRenderAssets({ workspaceDir: healthy });
    assert.equal(assets.catalog.catalogId, "https://design-system.sent-tech.ca/catalogs/elements/v1/catalog.json");
    assert.equal(assets.workspace, true);
    assert.equal(existsSync(join(healthy, "schemas")), false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
