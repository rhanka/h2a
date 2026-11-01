import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import {
  A2UI_CATALOG_RESOURCE_URI,
  assertCdnSriVersion,
  buildCdnShellHtml,
  cdnBaseForVersion,
  createUiRenderResources,
  createUiRenderTools,
  loadUiRenderAssets,
  resolveUiRenderMode,
  UI_MIME_TYPE,
  UI_RENDER_RESOURCE_URI
} from "../dist/index.js";
import { buildResourceHostConfig, serializeHostConfigScript } from "../dist/runtime/mcp/ui-render/watermark.js";

/**
 * SPEC-H2A-UIRENDER-CDN §8.1 — jsDelivr lazy chunks with inline offline
 * fallback. Every test is offline (zero network I/O): the CDN shell is
 * verified statically (importmap, SRI, sizes) and its runtime behaviour
 * (lazy preload, offline DOM fallback) runs inside a `node:vm` DOM mock.
 */

const PILOT_CSP = { resourceDomains: ["https://cdn.jsdelivr.net"], connectDomains: [] };
const H2A_RAW_BUDGET = 960 * 1024;
const CORE_GZIP_BUDGET = 150 * 1024;
const EXPECTED_BASE = "https://cdn.jsdelivr.net/npm/@sentropic/design-system-elements@0.1.0/dist/browser/";

let assets;
test.before(async () => {
  assets = await loadUiRenderAssets();
});

function cdnResources(env = {}, extra = {}) {
  return createUiRenderResources({ assets, env, mode: "cdn-sri", ...extra });
}

function hostConfigScript() {
  return serializeHostConfigScript(buildResourceHostConfig({}));
}

// --- §8.1.1 CSP metadata ---------------------------------------------------

test("cdn: every ui:// descriptor carries the jsDelivr CSP declaration in list, read and tools", () => {
  for (const mode of ["cdn-sri", "pilot-inline"]) {
    const resources = createUiRenderResources({ assets, env: {}, mode });
    for (const entry of resources.listResources().resources) {
      if (entry.uri === A2UI_CATALOG_RESOURCE_URI) {
        assert.equal(entry._meta, undefined, `${mode}: catalog must stay bare JSON`);
      } else {
        assert.deepEqual(entry._meta.ui.csp, PILOT_CSP, `${mode} list ${entry.uri}`);
      }
    }
    for (const uri of [
      UI_RENDER_RESOURCE_URI,
      "ui://sentropic/BarChart/v1",
      "ui://sentropic/BpmnCanvas/v1",
      "ui://sentropic/DecisionDossier/v1"
    ]) {
      const [content] = resources.readResource(uri).contents;
      assert.equal(content.mimeType, UI_MIME_TYPE, uri);
      assert.deepEqual(content._meta.ui.csp, PILOT_CSP, `${mode} read ${uri}`);
    }
    const [catalog] = resources.readResource(A2UI_CATALOG_RESOURCE_URI).contents;
    assert.equal(catalog._meta, undefined);
  }
  const tools = createUiRenderTools({
    assets,
    validator: { validateEnvelope: () => ({ ok: true, diagnostics: [] }) }
  });
  const byName = new Map(tools.listTools().map((tool) => [tool.name, tool]));
  assert.deepEqual(byName.get("render")._meta.ui.csp, PILOT_CSP);
  for (const component of ["BarChart", "BpmnCanvas", "DecisionDossier"]) {
    assert.deepEqual(byName.get(`render_${component}`)._meta.ui.csp, PILOT_CSP, component);
  }
});

// --- §8.1.2 pinned version & SRI guard -------------------------------------

test("cdn: the pinned version is exactly 0.1.0 with a matching immutable CDN base", () => {
  assert.equal(assertCdnSriVersion(assets.sri), "0.1.0");
  assert.equal(assets.manifest.packageVersion, "0.1.0");
  assert.equal(
    cdnBaseForVersion(assertCdnSriVersion(assets.sri)),
    EXPECTED_BASE
  );
  assert.throws(() => cdnBaseForVersion("latest"), /integrity_mismatch/);
  assert.throws(() => cdnBaseForVersion("^0.1.0"), /integrity_mismatch/);
});

test("cdn: cdn-sri refuses placeholder, floating and range versions", () => {
  const files = assets.sri.files;
  for (const version of ["0.0.0", "latest", "^0.1.0", "~0.1.0", ">=0.1.0", "0.1.x", "*"]) {
    assert.throws(
      () => assertCdnSriVersion({ version, files }),
      /integrity_mismatch/,
      `version ${version} must be refused`
    );
  }
  assert.equal(assertCdnSriVersion({ version: "0.0.0", files }, "0.1.0"), "0.1.0");
});

test("cdn: cdn-sri refuses any sri entry without a valid sha384 integrity", () => {
  const files = { ...assets.sri.files, "chunks/forge-B8hrW4lA.js": { ...assets.sri.files["chunks/forge-B8hrW4lA.js"], integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } };
  assert.throws(() => assertCdnSriVersion({ version: "0.1.0", files }), /integrity_mismatch/);
  const missing = { ...assets.sri.files };
  delete missing["chunks/forge-B8hrW4lA.js"];
  void missing;
});

test("cdn: mode cdn-sri with a bad override refuses at resource creation", () => {
  assert.throws(
    () => createUiRenderResources({ assets, env: {}, mode: "cdn-sri", cdnVersionOverride: "latest" }),
    /integrity_mismatch/
  );
});

test("cdn: mode resolution prefers offline, then explicit mode, then auto", () => {
  assert.equal(resolveUiRenderMode(assets, {}, undefined), "cdn-sri");
  assert.equal(resolveUiRenderMode(assets, {}, "cdn-sri"), "cdn-sri");
  assert.equal(resolveUiRenderMode(assets, {}, "pilot-inline"), "pilot-inline");
  assert.equal(resolveUiRenderMode(assets, {}, "pilot-per-component"), "pilot-per-component");
  assert.equal(resolveUiRenderMode(assets, { H2A_UI_RENDER_OFFLINE: "1" }, undefined), "pilot-inline");
  assert.equal(resolveUiRenderMode(assets, { H2A_UI_RENDER_OFFLINE: "1" }, "cdn-sri"), "pilot-inline");
  assert.equal(resolveUiRenderMode(assets, { H2A_UI_RENDER_MODE: "pilot-inline" }, undefined), "pilot-inline");
});

// --- §8.1.2/§8.1.3 importmap, chunk rewrite, size budgets -------------------

function importmapOf(html) {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(match, "the cdn shell carries an importmap");
  return JSON.parse(match[1]);
}

function moduleSourceOf(html) {
  const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.equal(modules.length, 1, "one inline core module");
  return modules[0][1];
}

test("cdn: the importmap pins every chunk to its exact sha384 integrity", () => {
  for (const uri of [UI_RENDER_RESOURCE_URI, "ui://sentropic/BpmnCanvas/v1"]) {
    const [content] = cdnResources().readResource(uri).contents;
    const map = importmapOf(content.text);
    const chunks = Object.keys(assets.sri.files).filter(
      (file) => file.startsWith("chunks/") && file.endsWith(".js")
    );
    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      const url = `${EXPECTED_BASE}${chunk}`;
      assert.equal(map.imports[url], url, chunk);
      assert.equal(map.integrity[url], assets.sri.files[chunk].integrity, chunk);
    }
  }
});

test("cdn: the inlined core keeps zero relative chunk specifiers (AST scan)", () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const map = importmapOf(content.text);
  const source = moduleSourceOf(content.text);
  assert.equal(source.includes("./chunks/"), false, "no relative chunk specifier remains");
  const file = ts.createSourceFile("core.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const specifiers = [];
  function visit(node) {
    if (
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      specifiers.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const text of specifiers) {
    assert.equal(text.includes("./chunks/"), false, text);
  }
  const urls = [...source.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/@sentropic\/design-system-elements@[0-9.]+\/dist\/browser\/chunks\/[A-Za-z0-9_.-]+\.js/g)].map(
    (match) => match[0]
  );
  assert.ok(urls.length > 0, "rewritten chunk URLs are present");
  for (const url of new Set(urls)) {
    assert.ok(url in map.integrity, `${url} is covered by the importmap integrity table`);
  }
});

test("cdn: buildCdnShellHtml inlines only the verified core runtime", () => {
  const html = buildCdnShellHtml(assets, hostConfigScript());
  assert.ok(html.includes('id="st-host-config"'));
  assert.ok(html.includes("st-bar-chart"), "core registers the bar-chart element");
  assert.ok(!html.includes("data-st-resource-degraded"), "the cdn shell is not degraded");
  assert.ok(Buffer.byteLength(html) <= H2A_RAW_BUDGET);
});

test("cdn: every resource fits the frame ceiling with degraded=false in cdn-sri mode", () => {
  const resources = cdnResources();
  for (const uri of [
    UI_RENDER_RESOURCE_URI,
    A2UI_CATALOG_RESOURCE_URI,
    "ui://sentropic/BarChart/v1",
    "ui://sentropic/BpmnCanvas/v1",
    "ui://sentropic/DecisionDossier/v1"
  ]) {
    const [content] = resources.readResource(uri).contents;
    assert.ok(Buffer.byteLength(content.text) <= H2A_RAW_BUDGET, `${uri} exceeds the frame ceiling`);
    assert.equal(content.text.includes('data-st-resource-degraded="true"'), false, `${uri} degraded`);
  }
  for (const uri of [UI_RENDER_RESOURCE_URI, "ui://sentropic/BpmnCanvas/v1", "ui://sentropic/BarChart/v1"]) {
    const [content] = resources.readResource(uri).contents;
    assert.ok(
      gzipSync(content.text).length <= CORE_GZIP_BUDGET,
      `${uri} exceeds the 150 kB gzip budget`
    );
  }
});

test("cdn: pilot-inline keeps per-component shells fully offline and degrades combined shells", () => {
  const resources = createUiRenderResources({ assets, env: { H2A_UI_RENDER_OFFLINE: "1" } });
  for (const uri of ["ui://sentropic/BarChart/v1", "ui://sentropic/DecisionDossier/v1"]) {
    const [content] = resources.readResource(uri).contents;
    assert.equal(content.text.includes('data-st-resource-degraded="true"'), false, uri);
    const island = content.text.match(/<script type="application\/json" id="st-host-config">([\s\S]*?)<\/script>/);
    assert.ok(island, `${uri}: host-config island`);
    const withoutIsland = content.text.replace(island[0], "");
    assert.equal((withoutIsland.match(/https:\/\/cdn\.jsdelivr\.net/g) || []).length, 0, `${uri}: 0 CDN URLs`);
  }
  for (const uri of [UI_RENDER_RESOURCE_URI, "ui://sentropic/BpmnCanvas/v1"]) {
    const [content] = resources.readResource(uri).contents;
    assert.match(content.text, /data-st-resource-degraded="true"/, uri);
  }
  const full = createUiRenderResources({
    assets,
    env: { H2A_UI_RENDER_OFFLINE: "1" },
    inlineMaxBytes: 2_097_152
  });
  for (const uri of [UI_RENDER_RESOURCE_URI, "ui://sentropic/BpmnCanvas/v1"]) {
    const [content] = full.readResource(uri).contents;
    assert.equal(content.text.includes('data-st-resource-degraded="true"'), false, `${uri} full inline`);
    assert.ok(Buffer.byteLength(content.text) > H2A_RAW_BUDGET, `${uri} is the complete bundle`);
  }
});

// --- §8.1.4 VM shell: CDN load vs offline / CSP failure fallback -----------

function mockElement(tag) {
  const element = {
    tag,
    children: [],
    attributes: {},
    handlers: {},
    textContent: "",
    hostConfig: undefined,
    envelope: undefined,
    get firstChild() {
      return this.children[0] ?? null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    addEventListener(name, handler) {
      this.handlers[name] = handler;
    },
    style: { setProperty() {} }
  };
  return element;
}

function textOf(element) {
  const parts = [];
  (function visit(node) {
    if (typeof node.textContent === "string" && node.textContent.length > 0) parts.push(node.textContent);
    for (const child of node.children ?? []) visit(child);
  })(element);
  return parts.join("\n");
}

function findAll(root, predicate) {
  const found = [];
  (function visit(node) {
    if (predicate(node)) found.push(node);
    for (const child of node.children ?? []) visit(child);
  })(root);
  return found;
}

function cdnShellHarness(html) {
  const configText = html.match(/id="st-host-config">([\s\S]*?)<\/script>/)[1];
  const bridges = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(bridges.length >= 1, "the shell carries the classic bridge script");
  const bridge = bridges[bridges.length - 1][1];
  const document = {
    created: [],
    listeners: {},
    root: mockElement("div"),
    head: mockElement("head"),
    documentElement: mockElement("html"),
    getElementById(id) {
      if (id === "st-root") return this.root;
      if (id === "st-host-config") return { textContent: configText };
      return null;
    },
    createElement(tag) {
      const element = mockElement(tag);
      this.created.push(element);
      return element;
    },
    getElementsByTagName(tag) {
      return tag === "head" ? [this.head] : [];
    },
    addEventListener(name, handler) {
      (this.listeners[name] = this.listeners[name] || []).push(handler);
    }
  };
  document.documentElement.style = { setProperty() {} };
  const messages = [];
  let receive;
  const window = {
    parent: { postMessage(message) { messages.push(message); } },
    addEventListener(name, handler) {
      assert.equal(name, "message");
      receive = handler;
    }
  };
  const timers = [];
  const sandbox = {
    document,
    window,
    crypto: webcrypto,
    TextEncoder,
    setTimeout(callback, ms) {
      timers.push({ callback, ms });
      return timers.length;
    },
    clearTimeout() {},
    console
  };
  runInNewContext(bridge, sandbox);
  const flush = async () => {
    for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    document,
    messages,
    timers,
    cdnScripts() {
      return document.created.filter(
        (element) => element.tag === "script" && (element.attributes.src || "").includes("cdn.jsdelivr.net")
      );
    },
    cdnPreloads() {
      return document.created.filter(
        (element) => element.tag === "link" && (element.attributes.href || "").includes("cdn.jsdelivr.net")
      );
    },
    async post(method, params) {
      await receive({ data: { method, params } });
      await flush();
    },
    fireSecurityPolicyViolation(blockedURI) {
      for (const handler of document.listeners["securitypolicyviolation"] || []) {
        handler({ blockedURI });
      }
    }
  };
}

function exampleRoot(component) {
  return structuredClone(assets.catalog.components[component]["x-sentropic"].example);
}

function facadeUrlFor(component) {
  const prefix = component === "BpmnCanvas" ? "chunks/bpmn-canvas-" : "chunks/focus-renderer-";
  const chunk = Object.keys(assets.sri.files).find((file) => file.startsWith(prefix));
  return `${EXPECTED_BASE}${chunk}`;
}

test("cdn-vm: a BarChart envelope mounts from the inline core with 0 CDN tags", async () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: exampleRoot("BarChart") }
  });
  assert.equal(shell.cdnScripts().length, 0, "no CDN script for a core engine");
  assert.equal(shell.cdnPreloads().length, 0, "no CDN preload for a core engine");
  const mounted = shell.document.root.children.filter((child) => child.tag === "st-bar-chart");
  assert.equal(mounted.length, 1, "st-bar-chart is mounted");
});

test("cdn-vm: a BpmnCanvas envelope preloads the SRI engine chunk and mounts on load", async () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: exampleRoot("BpmnCanvas") }
  });
  const facade = facadeUrlFor("BpmnCanvas");
  const scripts = shell.cdnScripts().filter((element) => element.attributes.src === facade);
  assert.equal(scripts.length, 1, "the facade chunk is injected once");
  assert.equal(scripts[0].attributes.integrity, assets.sri.files["chunks/bpmn-canvas-DeAWdJFy.js"].integrity);
  assert.equal(scripts[0].attributes.crossorigin, "anonymous");
  assert.ok(shell.cdnPreloads().length > 0, "transitive chunks are preloaded");
  for (const link of shell.cdnPreloads()) {
    assert.match(link.attributes.integrity || "", /^sha384-/);
    assert.equal(link.attributes.crossorigin, "anonymous");
  }
  assert.ok(typeof scripts[0].handlers.load === "function", "the shell awaits load");
  scripts[0].handlers.load();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  const mounted = shell.document.root.children.filter((child) => child.tag === "st-bpmn-canvas");
  assert.equal(mounted.length, 1, "st-bpmn-canvas is mounted after the chunk loads");
});

test("cdn-vm: a failed forge theme chunk falls back to the inlined sent-tech theme", async () => {
  const forged = createUiRenderResources({ assets, env: { H2A_UI_THEME: "forge" }, mode: "cdn-sri" });
  const [content] = forged.readResource(UI_RENDER_RESOURCE_URI).contents;
  assert.ok(content.text.includes('"theme":"forge"'), "the shell starts on the forge theme");
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: exampleRoot("BpmnCanvas") }
  });
  const themeScripts = shell.cdnScripts().filter((element) => (element.attributes.src || "").includes("forge-"));
  assert.ok(themeScripts.length > 0, "the forge theme chunk is requested");
  themeScripts[0].handlers.error();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  const facade = shell.cdnScripts().filter((element) => element.attributes.src === facadeUrlFor("BpmnCanvas"));
  assert.equal(facade.length, 1);
  facade[0].handlers.load();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  const mounted = shell.document.root.children.filter((child) => child.tag === "st-bpmn-canvas");
  assert.equal(mounted.length, 1, "the canvas still mounts");
  assert.equal(mounted[0].hostConfig.theme, "sent-tech", "the theme falls back to the inlined sent-tech");
});

test("cdn-vm: a CDN error renders engine-load-failed with a DOM fallback, never a blank root", async () => {
  for (const component of ["BpmnCanvas", "DecisionDossier"]) {
    const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
    const shell = cdnShellHarness(content.text);
    await shell.post("ui/notifications/tool-input", {
      arguments: { contract: "1.0", root: exampleRoot(component) }
    });
    const scripts = shell.cdnScripts();
    assert.ok(scripts.length > 0, `${component}: a CDN script is injected`);
    assert.ok(typeof scripts[0].handlers.error === "function");
    scripts[0].handlers.error();
    for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
    const root = shell.document.root;
    assert.ok(root.children.length > 0, `${component}: the root is never left blank`);
    const alerts = findAll(root, (node) => node.attributes.role === "alert");
    assert.ok(alerts.length > 0, `${component}: a diagnostic alert is rendered`);
    assert.ok(textOf(root).includes("engine-load-failed"), `${component}: the alert names engine-load-failed`);
    const fallback = findAll(
      root,
      (node) => node.attributes["data-st-offline-fallback"] === component
    );
    assert.equal(fallback.length, 1, `${component}: the offline DOM fallback is rendered`);
    assert.ok(textOf(fallback[0]).length > 0, `${component}: the fallback carries content`);
  }
});

test("cdn-vm: a CSP securitypolicyviolation falls back like a network error", async () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: exampleRoot("BpmnCanvas") }
  });
  assert.ok(shell.cdnScripts().length > 0);
  shell.fireSecurityPolicyViolation(facadeUrlFor("BpmnCanvas"));
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(textOf(shell.document.root).includes("engine-load-failed"));
  assert.equal(
    findAll(shell.document.root, (node) => node.attributes["data-st-offline-fallback"] === "BpmnCanvas").length,
    1
  );
});

test("cdn-vm: the chunk-load timeout falls back without hanging the surface", async () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: exampleRoot("DecisionDossier") }
  });
  assert.ok(shell.cdnScripts().length > 0);
  const watchdog = shell.timers.find((timer) => timer.ms === 10000);
  assert.ok(watchdog, "a 10 s chunk-load watchdog is armed");
  watchdog.callback();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(textOf(shell.document.root).includes("engine-load-failed"));
});

test("cdn-vm: a DecisionDossier fallback carries the dossier title and sections", async () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: exampleRoot("DecisionDossier") }
  });
  shell.cdnScripts()[0].handlers.error();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  const [fallback] = findAll(
    shell.document.root,
    (node) => node.attributes["data-st-offline-fallback"] === "DecisionDossier"
  );
  const text = textOf(fallback);
  assert.ok(text.includes("Decision: adopt the JSON render standard"), "dossier title");
  assert.ok(text.includes("Adopt the JSON render standard for design-system rendering"), "dossier subject");
  assert.ok(text.includes("Which rendering contract do we adopt?"), "dossier question");
});

test("cdn-vm: a BpmnCanvas fallback carries the process summary", async () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: exampleRoot("BpmnCanvas") }
  });
  shell.cdnScripts()[0].handlers.error();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  const [fallback] = findAll(
    shell.document.root,
    (node) => node.attributes["data-st-offline-fallback"] === "BpmnCanvas"
  );
  const text = textOf(fallback);
  assert.ok(text.includes("definitions-1"), "process id");
  assert.ok(text.includes("https://example.com/bpmn"), "target namespace");
});

test("cdn-vm: an invalid envelope mounts the error panel from the core with 0 CDN tags", async () => {
  const [content] = cdnResources().readResource(UI_RENDER_RESOURCE_URI).contents;
  const shell = cdnShellHarness(content.text);
  await shell.post("ui/notifications/tool-input", {
    arguments: { contract: "1.0", root: { component: "Nope", id: "root" } }
  });
  assert.equal(shell.cdnScripts().length, 0, "invalid envelopes never touch the network");
  assert.equal(shell.cdnPreloads().length, 0, "invalid envelopes never touch the network");
  const alerts = findAll(shell.document.root, (node) => node.attributes.role === "alert");
  assert.ok(alerts.length > 0, "the refusal is announced");
});
