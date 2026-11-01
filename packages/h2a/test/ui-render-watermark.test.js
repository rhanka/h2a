import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildResourceHostConfig,
  serializeHostConfigScript
} from "../dist/index.js";

/**
 * json-render L3.1 — W3/W4 server-side watermark gate (DS §13.4, h2a spec §6):
 * SENTROPIC_BPMN_WATERMARK_LICENSE is a server-side secret that must NEVER
 * reach the browser, any output, or any tracked file. Only the non-secret
 * SENTROPIC_BPMN_WATERMARK_REFERENCE may be written into #st-host-config,
 * and only when the license gate is non-blank.
 */

const CANARY = "CANARY-WM-SECRET-DO-NOT-EMIT-9f3a";

test("buildResourceHostConfig: defaults when no watermark variables are set", () => {
  const config = buildResourceHostConfig({});
  assert.deepEqual(config, {
    theme: "sent-tech",
    colorScheme: "light",
    locale: "fr",
    assetBase: "https://cdn.jsdelivr.net/npm/@sentropic/bpmn-canvas@0.3.0/dist/assets/"
  });
  assert.equal("bpmn" in config, false);
});

test("W4 canary: the license secret is never emitted; the reference is, when gated", () => {
  const config = buildResourceHostConfig({
    SENTROPIC_BPMN_WATERMARK_LICENSE: CANARY,
    SENTROPIC_BPMN_WATERMARK_REFERENCE: "REF-PUBLIC-2026"
  });
  assert.equal(config.bpmn.watermark.license, "REF-PUBLIC-2026");
  const html = serializeHostConfigScript(config);
  assert.ok(html.includes("REF-PUBLIC-2026"));
  assert.equal(html.includes(CANARY), false, "the license secret leaked into #st-host-config");
});

test("a blank reference or a blank license gate suppresses bpmn.watermark entirely", () => {
  const blankReference = buildResourceHostConfig({
    SENTROPIC_BPMN_WATERMARK_LICENSE: CANARY,
    SENTROPIC_BPMN_WATERMARK_REFERENCE: "   "
  });
  assert.equal("bpmn" in blankReference, false);
  const blankLicense = buildResourceHostConfig({
    SENTROPIC_BPMN_WATERMARK_LICENSE: "  ",
    SENTROPIC_BPMN_WATERMARK_REFERENCE: "REF-PUBLIC-2026"
  });
  assert.equal("bpmn" in blankLicense, false);
});

test("W4 misconfiguration guard: reference === license suppresses emission", () => {
  const config = buildResourceHostConfig({
    SENTROPIC_BPMN_WATERMARK_LICENSE: CANARY,
    SENTROPIC_BPMN_WATERMARK_REFERENCE: CANARY
  });
  assert.equal("bpmn" in config, false);
  assert.equal(serializeHostConfigScript(config).includes(CANARY), false);
});

test("serializeHostConfigScript: the config script escapes < and carries the st-host-config id", () => {
  const html = serializeHostConfigScript({
    theme: "sent-tech",
    colorScheme: "dark",
    locale: "fr",
    assetBase: "https://cdn.jsdelivr.net/npm/@sentropic/bpmn-canvas@0.3.0/dist/assets/"
  });
  assert.ok(html.startsWith('<script type="application/json" id="st-host-config">'));
  assert.ok(html.endsWith("</script>"));
  const json = html.slice('<script type="application/json" id="st-host-config">'.length, -"</script>".length);
  assert.equal(json.includes("<"), false, "an unescaped < inside a script block can close it early");
  assert.deepEqual(JSON.parse(json), {
    theme: "sent-tech",
    colorScheme: "dark",
    locale: "fr",
    assetBase: "https://cdn.jsdelivr.net/npm/@sentropic/bpmn-canvas@0.3.0/dist/assets/"
  });
});

test("W4 tracked-file guard: no tracked file carries a license value or the canary", () => {
  const tracked = execFileSync("git", ["ls-files", "packages/h2a"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
  assert.ok(tracked.length > 100, "git ls-files returned no tracked files");
  const offenders = [];
  for (const file of tracked) {
    let text;
    try {
      text = readFileSync(join(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    if (text.includes(CANARY) && !file.endsWith("test/ui-render-watermark.test.js")) {
      offenders.push(`${file}: canary literal`);
    }
    const assignment = /SENTROPIC_BPMN_WATERMARK_(LICENSE|REFERENCE)\s*=\s*(?!"<)/;
    const match = assignment.exec(text);
    if (match !== null && !file.endsWith("test/ui-render-watermark.test.js")) {
      offenders.push(`${file}: literal watermark ${match[1]} assignment`);
    }
  }
  assert.deepEqual(offenders, []);
});
