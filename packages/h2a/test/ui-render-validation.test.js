import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createUiRenderValidator,
  loadUiRenderAssets,
  FOCUS_DECISION_DOSSIER_V1_SHA256
} from "../dist/index.js";

/**
 * json-render L3.1 — the 9-step envelope validation pipeline (DS §4.3–§4.5,
 * h2a spec §4.2.3): every RED case pins one closed diagnostic code, source and
 * RFC 6901 path, in the exact check order of createEnvelopeValidatorCore.
 */

const CATALOG_ID = "https://design-system.sent-tech.ca/catalogs/elements/v1/catalog.json";

let assets;
test.before(async () => {
  assets = await loadUiRenderAssets();
});

function barChartRoot(overrides = {}) {
  return {
    id: "root",
    component: "BarChart",
    label: "Revenue (M€)",
    data: [
      { label: "Q1", value: 12 },
      { label: "Q2", value: 18 }
    ],
    ...overrides
  };
}

test("assets: the vendored catalogue is the pinned f2358a8f snapshot", async () => {
  assert.equal(assets.catalog.catalogId, CATALOG_ID);
  assert.equal(assets.catalog.components.BarChart["x-sentropic"].engine, "core");
  assert.equal(assets.catalog.components.DecisionDossier["x-sentropic"].engine, "lazy:focus");
  assert.equal(
    assets.catalog.components.DecisionDossier["x-sentropic"].semantic.sha256,
    FOCUS_DECISION_DOSSIER_V1_SHA256
  );
});

test("step 1: an envelope over the 1 MiB UTF-8 budget refuses payload-too-large", () => {
  const validator = createUiRenderValidator({ assets });
  const huge = {
    contract: "1.0",
    root: { ...barChartRoot(), label: "x".repeat(1_100_000) }
  };
  const diagnostics = validator.validate(huge);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "payload-too-large");
  assert.equal(diagnostics[0].source, "catalog");
  assert.equal(diagnostics[0].path, "");
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].detail.limitBytes, 1_048_576);
  assert.ok(diagnostics[0].detail.actualBytes > 1_048_576);
});

test("step 2: legacy { props, fallbackText } arguments refuse schema-violation on /props", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "1.0",
    props: { data: [] },
    fallbackText: "legacy",
    root: { ...barChartRoot() }
  });
  assert.equal(diagnostics.length, 2);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.code, "schema-violation");
    assert.equal(diagnostic.source, "catalog");
    assert.equal(diagnostic.detail.keyword, "unevaluatedProperties");
  }
  assert.deepEqual(diagnostics.map((d) => d.path).sort(), ["/fallbackText", "/props"]);
});

test("step 2: root.id other than \"root\" refuses schema-violation on /root/id", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "1.0",
    root: { ...barChartRoot(), id: "chart-1" }
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "schema-violation");
  assert.equal(diagnostics[0].source, "catalog");
  assert.ok(diagnostics[0].path.startsWith("/root/id"), `path was ${diagnostics[0].path}`);
  assert.equal(diagnostics[0].detail.keyword, "const");
});

test("step 3: a present but foreign catalogId refuses schema-violation on /catalogId", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    catalogId: "https://example.com/other/catalog.json",
    contract: "1.0",
    root: barChartRoot()
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "schema-violation");
  assert.equal(diagnostics[0].path, "/catalogId");
  assert.equal(diagnostics[0].detail.expected, CATALOG_ID);
  assert.equal(diagnostics[0].detail.found, "https://example.com/other/catalog.json");
});

test("step 4: mode \"preview\" refuses unsupported-mode on /mode", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "1.0",
    mode: "preview",
    root: barChartRoot()
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "unsupported-mode");
  assert.equal(diagnostics[0].path, "/mode");
  assert.equal(diagnostics[0].detail.mode, "preview");
});

test("step 5: an uncatalogued root.component refuses unknown-component on /root/component", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "1.0",
    root: { ...barChartRoot(), component: "PieChart" }
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "unknown-component");
  assert.equal(diagnostics[0].path, "/root/component");
  assert.equal(diagnostics[0].detail.component, "PieChart");
});

test("step 6: a placeholder entry (x-sentropic.status unknown) refuses component-unavailable", () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-uirender-placeholder-"));
  try {
    const catalog = structuredClone(assets.catalog);
    catalog.components.BarChart["x-sentropic"].status = "unknown";
    const validator = createUiRenderValidator({ assets: { ...assets, catalog } });
    const diagnostics = validator.validate({
      contract: "1.0",
      root: barChartRoot()
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "component-unavailable");
    assert.equal(diagnostics[0].path, "/root/component");
    assert.equal(diagnostics[0].severity, "error");
    assert.equal(diagnostics[0].source, "catalog");
    assert.equal(diagnostics[0].detail.component, "BarChart");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("step 7: a newer envelope minor refuses unsupported-contract on /contract", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "1.1",
    root: barChartRoot()
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "unsupported-contract");
  assert.equal(diagnostics[0].path, "/contract");
  assert.equal(diagnostics[0].detail.expected, "1.0");
  assert.equal(diagnostics[0].detail.found, "1.1");
});

test("step 7: an OLDER envelope minor is accepted against a newer entry (§4.4)", () => {
  const catalog = structuredClone(assets.catalog);
  catalog.components.BarChart["x-sentropic"].contract = "1.2";
  const validator = createUiRenderValidator({ assets: { ...assets, catalog } });
  const diagnostics = validator.validate({
    contract: "1.0",
    root: barChartRoot()
  });
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
});

test("step 7: another major refuses unsupported-contract", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "2.0",
    root: barChartRoot()
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "unsupported-contract");
  assert.equal(diagnostics[0].path, "/contract");
});

test("step 8: an invalid BarChart bar value refuses schema-violation on /root/data/0/value", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "1.0",
    root: barChartRoot({
      data: [{ label: "Q1", value: "twelve" }]
    })
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "schema-violation");
  assert.equal(diagnostics[0].path, "/root/data/0/value");
  assert.equal(diagnostics[0].source, "catalog");
});

test("step 8: an uncatalogued root property refuses schema-violation (unevaluatedProperties)", () => {
  const validator = createUiRenderValidator({ assets });
  const diagnostics = validator.validate({
    contract: "1.0",
    root: { ...barChartRoot(), props: { hidden: true } }
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "schema-violation");
  assert.equal(diagnostics[0].detail.keyword, "unevaluatedProperties");
  assert.ok(diagnostics[0].path.startsWith("/root/props"), `path was ${diagnostics[0].path}`);
});

test("step 9: an invalid DecisionDossier target refuses semantic-invalid through the focus port", () => {
  const validator = createUiRenderValidator({ assets });
  const example = assets.catalog.components.DecisionDossier["x-sentropic"].example;
  const document = structuredClone(example.document);
  // Break what ONLY the focus validator owns: a duplicated section id is
  // structurally valid for the catalogue's JSON Schema (each section object
  // conforms), but focus flags it as duplicate_id at the JSON path.
  document.sections[1] = structuredClone(document.sections[0]);
  const diagnostics = validator.validate({
    contract: "1.0",
    root: { id: "root", component: "DecisionDossier", document }
  });
  assert.ok(
    diagnostics.some(
      (d) => d.code === "semantic-invalid" && d.source === "focus" && d.severity === "error"
    ),
    `expected a focus semantic-invalid diagnostic, got ${JSON.stringify(diagnostics)}`
  );
  const focusIssue = diagnostics.find((d) => d.code === "semantic-invalid");
  assert.equal(focusIssue.path, "/root/document/sections/1/id");
  assert.equal(focusIssue.detail.code, "duplicate_id");
});

test("step 9: a clean DecisionDossier example validates with zero errors", () => {
  const validator = createUiRenderValidator({ assets });
  const example = assets.catalog.components.DecisionDossier["x-sentropic"].example;
  const diagnostics = validator.validate({
    contract: "1.0",
    root: { ...example, id: "root" }
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === "error"),
    []
  );
});

test("step 9: a lazy engine without an injected port refuses host-capability-missing", () => {
  const validator = createUiRenderValidator({ assets, ports: {} });
  const example = assets.catalog.components.BpmnCanvas["x-sentropic"].example;
  const diagnostics = validator.validate({
    contract: "1.0",
    root: { ...example, id: "root" }
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "host-capability-missing");
  assert.equal(diagnostics[0].source, "host");
  assert.equal(diagnostics[0].path, "/root/document");
  assert.equal(diagnostics[0].detail.chunk, "bpmn-canvas");
  assert.equal(diagnostics[0].detail.engine, "lazy:bpmn-canvas");
});

test("a valid BarChart envelope validates with zero diagnostics", () => {
  const validator = createUiRenderValidator({ assets });
  assert.deepEqual(validator.validate({ contract: "1.0", root: barChartRoot() }), []);
});

test("the default validator wires the focus port (DecisionDossier semantic errors surface)", () => {
  const validator = createUiRenderValidator({ assets });
  const example = assets.catalog.components.DecisionDossier["x-sentropic"].example;
  const document = structuredClone(example.document);
  document.sections[1] = structuredClone(document.sections[0]);
  const diagnostics = validator.validate({
    contract: "1.0",
    root: { id: "root", component: "DecisionDossier", document }
  });
  assert.ok(diagnostics.some((d) => d.code === "semantic-invalid" && d.source === "focus"));
});
