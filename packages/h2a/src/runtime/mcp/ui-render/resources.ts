/**
 * The ui:// resource surface (h2a spec §3): the five pinned resource
 * descriptors (`resources/list`) and the exact-URI `resources/read`
 * handler. The pilot MCP App shell is assembled server-side from the
 * vendored build — the core runtime (and, for per-component resources, the
 * requested component's engine chunk) is inlined into the HTML together
 * with `#st-host-config`, and the SEP-1865 postMessage bridge script
 * (h2a spec §3.3) implements `ui/initialize`, `ui/notifications/tool-input`
 * / `tool-result` / `host-context-changed`, the §4.4 contract check, the
 * `st-intent` whitelist and the `submit_intent` bridge.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { UiRenderAssets, UiRenderCatalogEntry } from "./assets.js";
import { buildResourceHostConfig, serializeHostConfigScript } from "./watermark.js";
import {
  CATALOG_MIME_TYPE,
  PILOT_RESOURCE_DOMAIN,
  UI_MIME_TYPE,
  UnknownResourceError,
  type McpReadResourceResult,
  type McpResourceContents,
  type McpResourceDescriptor,
  type UiExtensionCapability,
  type UiRenderCallContext
} from "./types.js";

/** The primary MCP App renderer resource (h2a spec §3.1). */
export const UI_RENDER_RESOURCE_URI = "ui://sentropic/render/v1";

/** The A2UI / JSON Schema catalogue resource (h2a spec §3.2). */
export const A2UI_CATALOG_RESOURCE_URI = "a2ui://sentropic/catalog/v1";

/** The pilot CSP declaration every ui:// resource carries (DS §6.4 U-12). */
const PILOT_CSP = { resourceDomains: [PILOT_RESOURCE_DOMAIN], connectDomains: [] } as const;

/** Options of the resource handlers. */
export interface CreateUiRenderResourcesOptions {
  /** The verified asset set (`loadUiRenderAssets`). */
  readonly assets: UiRenderAssets;
  /** The environment the watermark gate reads; defaults to `process.env` (live). */
  readonly env?: Record<string, string | undefined>;
}

/** The `resources/list` + `resources/read` handlers for one asset set. */
export interface UiRenderResources {
  listResources(context?: UiRenderCallContext): { resources: McpResourceDescriptor[] };
  readResource(uri: string, context?: UiRenderCallContext): McpReadResourceResult;
}

/** The custom element tag of one component (st- + kebab-case name). */
function componentTag(component: string): string {
  return `st-${component.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

/** The x-sentropic metadata block of one catalogue entry. */
function sentropicOf(entry: UiRenderCatalogEntry | undefined): {
  readonly contract?: unknown;
  readonly engine?: unknown;
  readonly events?: unknown;
  readonly status?: unknown;
} {
  return entry?.["x-sentropic"] as ReturnType<typeof sentropicOf>;
}

/**
 * The sri chunk file (relative to `dist/browser`) that implements one
 * `lazy:<chunk>` engine's entry point: the chunk file whose basename starts
 * with `<chunk>-`. `core` engines have no chunk.
 */
function entryChunkFile(assets: UiRenderAssets, component: string): string | undefined {
  const engine = sentropicOf(assets.catalog.components[component])?.engine;
  if (typeof engine !== "string" || !engine.startsWith("lazy:")) return undefined;
  const chunk = engine.slice("lazy:".length);
  for (const file of Object.keys(assets.sri.files)) {
    const base = file.split("/").pop() ?? "";
    if (file.startsWith("chunks/") && base.startsWith(`${chunk}-`)) return file;
  }
  return undefined;
}

/** The derived per-component metadata the shell script embeds (§3.3). */
function shellComponentMeta(assets: UiRenderAssets): string {
  const events: Record<string, string[]> = {};
  const contracts: Record<string, string> = {};
  const engines: Record<string, string> = {};
  const tags: Record<string, string> = {};
  for (const [name, entry] of Object.entries(assets.catalog.components)) {
    const sentropic = sentropicOf(entry);
    events[name] = Array.isArray(sentropic?.events)
      ? sentropic.events.filter((event): event is string => typeof event === "string")
      : [];
    contracts[name] = typeof sentropic?.contract === "string" ? sentropic.contract : "";
    engines[name] = typeof sentropic?.engine === "string" ? sentropic.engine : "";
    tags[name] = componentTag(name);
  }
  return JSON.stringify({ events, contracts, engines, tags });
}

/** Cached vendored file texts (keyed by vendor dir + file). */
const textCache = new Map<string, string>();

function readVendorText(assets: UiRenderAssets, relative: string): string | undefined {
  const cacheKey = `${assets.vendorDir.href}::${relative}`;
  const cached = textCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const text = readFileSync(join(fileURLToPath(assets.vendorDir), relative), "utf8");
    textCache.set(cacheKey, text);
    return text;
  } catch {
    // A workspace overlay may legitimately miss dist files; the shell is
    // served without the missing piece rather than refused whole.
    return undefined;
  }
}

/**
 * The SEP-1865 shell protocol script (h2a spec §3.3). Plain classic script:
 * no imports, no eval, no template literals — it only bridges postMessage
 * traffic and mounts the custom element the vendored core defines.
 */
function shellScript(metaJson: string): string {
  return `
(function () {
  "use strict";
  var META = ${metaJson};
  var configElement = document.getElementById("st-host-config");
  var hostConfig = {};
  try { hostConfig = JSON.parse(configElement ? configElement.textContent : "{}") || {}; } catch (error) { hostConfig = {}; }
  var root = document.getElementById("st-root");
  var envelope = null;
  var diagnostics = [];
  var requestCounter = 0;

  function postToHost(message) {
    try { window.parent.postMessage(message, "*"); } catch (error) { /* the bridge is best-effort */ }
  }
  function nextRequestId() { requestCounter += 1; return "st-shell-" + requestCounter; }

  function applyHostContext(context) {
    if (!context || typeof context !== "object") return;
    if (context.colorScheme === "dark" || context.colorScheme === "light") {
      document.documentElement.setAttribute("data-st-color-scheme", context.colorScheme);
    }
    var variables = context.cssVariables || context.variables;
    if (variables && typeof variables === "object") {
      for (var name in variables) {
        if (Object.prototype.hasOwnProperty.call(variables, name) && name.indexOf("--") === 0) {
          document.documentElement.style.setProperty(name, String(variables[name]));
        }
      }
    }
  }

  function hasErrorDiagnostics() {
    for (var index = 0; index < diagnostics.length; index += 1) {
      if (diagnostics[index] && diagnostics[index].severity === "error") return true;
    }
    return false;
  }

  function showDiagnostics() {
    var panel = document.createElement("div");
    panel.setAttribute("role", "alert");
    panel.setAttribute("data-st-diagnostics", String(diagnostics.length));
    var title = document.createElement("p");
    title.textContent = "The envelope was refused by the renderer:";
    panel.appendChild(title);
    for (var index = 0; index < diagnostics.length; index += 1) {
      var item = diagnostics[index];
      if (!item) continue;
      var line = document.createElement("p");
      line.textContent = String(item.code || "schema-violation") + " " + String(item.path || "") + " " + String(item.message || "");
      panel.appendChild(line);
    }
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(panel);
  }

  function parseContract(value) {
    var parts = String(value || "").split(".");
    if (parts.length !== 2) return null;
    var major = Number(parts[0]);
    var minor = Number(parts[1]);
    if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
    return { major: major, minor: minor };
  }

  function contractAccepted(entryContract) {
    var parsedEntry = parseContract(entryContract);
    var parsedEnvelope = envelope ? parseContract(envelope.contract) : null;
    return Boolean(parsedEntry && parsedEnvelope &&
      parsedEnvelope.major === parsedEntry.major &&
      parsedEnvelope.minor <= parsedEntry.minor);
  }

  function mount() {
    if (!envelope || typeof envelope !== "object") return;
    if (hasErrorDiagnostics()) { showDiagnostics(); return; }
    var target = envelope.root || {};
    var component = typeof target.component === "string" ? target.component : "";
    if (!Object.prototype.hasOwnProperty.call(META.tags, component) ||
        !contractAccepted(META.contracts[component])) {
      diagnostics = [{ code: "unknown-component", path: "/root/component", message: "the shell cannot mount " + component, severity: "error", source: "catalog" }];
      showDiagnostics();
      return;
    }
    var element = document.createElement(META.tags[component]);
    element.hostConfig = hostConfig;
    element.envelope = envelope;
    element.addEventListener("st-intent", onIntent);
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(element);
  }

  function onIntent(event) {
    var detail = event && event.detail;
    if (!detail || typeof detail !== "object") return;
    var name = typeof detail.name === "string" ? detail.name : "";
    var component = envelope && envelope.root && typeof envelope.root.component === "string" ? envelope.root.component : "";
    var allowed = META.events[component] || [];
    if (allowed.indexOf(name) === -1) return; // unlisted intents are dropped (§3.3.3)
    var intent = {
      event: "intent",
      name: name,
      target: typeof detail.target === "string" ? detail.target : "",
      context: detail.context && typeof detail.context === "object" ? detail.context : {}
    };
    postToHost({ jsonrpc: "2.0", id: nextRequestId(), method: "tools/call", params: { name: "submit_intent", arguments: intent } });
    if (name === "select" || name === "choose-option" || name === "open") {
      postToHost({ jsonrpc: "2.0", method: "ui/update-model-context", params: { context: intent } });
    }
    if (name === "comment") {
      postToHost({ jsonrpc: "2.0", method: "ui/message", params: { message: JSON.stringify(intent) } });
    }
  }

  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || typeof message !== "object") return;
    if (typeof message.method === "string" && message.method.indexOf("ui/notifications/") === 0) {
      var params = message.params && typeof message.params === "object" ? message.params : {};
      if (message.method === "ui/notifications/tool-input") {
        envelope = params.arguments; // retained in memory (DS §8.2)
        diagnostics = [];
        mount();
      } else if (message.method === "ui/notifications/tool-result") {
        var structured = params.structuredContent;
        if (structured && typeof structured === "object") {
          if (structured.envelope && typeof structured.envelope === "object") envelope = structured.envelope;
          if (Array.isArray(structured.diagnostics)) diagnostics = structured.diagnostics;
        }
        mount();
      } else if (message.method === "ui/notifications/host-context-changed") {
        applyHostContext(params);
      }
      return;
    }
    if (typeof message.id === "string" && message.id.indexOf("st-shell-") === 0) {
      applyHostContext(message.result); // the ui/initialize result carries the host context
    }
  });

  postToHost({ jsonrpc: "2.0", id: nextRequestId(), method: "ui/initialize", params: {} });
})();
`;
}

/** Assembles the pilot MCP App shell HTML for the full or per-component resource. */
function buildShellHtml(assets: UiRenderAssets, hostConfigScript: string, component?: string): string {
  const core = readVendorText(assets, "dist/browser/elements.js") ?? "";
  let chunkScript = "";
  if (component !== undefined) {
    const chunkFile = entryChunkFile(assets, component);
    if (chunkFile !== undefined) {
      const chunkText = readVendorText(assets, join("dist/browser", chunkFile));
      if (chunkText !== undefined) {
        chunkScript = `<script type="module">\n${chunkText}\n</script>\n`;
      }
    }
  }
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Sentropic Design-System JSON Renderer (v1)</title>
<style>
html, body { margin: 0; padding: 0; background: #ffffff; color: #111111;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
#st-root { min-height: 100vh; }
[data-st-diagnostics] { padding: 16px; }
[data-st-diagnostics] p { margin: 4px 0; }
</style>
</head>
<body>
<div id="st-root"></div>
${hostConfigScript}
<script type="module">
${core}
</script>
${chunkScript}<script>
${shellScript(shellComponentMeta(assets))}
</script>
</body>
</html>
`;
}

/** The `resources/read` contents entry for one ui:// shell resource. */
function shellContents(uri: string, html: string): McpResourceContents {
  return { uri, mimeType: UI_MIME_TYPE, text: html, _meta: { ui: { csp: PILOT_CSP } } };
}

export function createUiRenderResources(options: CreateUiRenderResourcesOptions): UiRenderResources {
  const assets = options.assets;
  const env = options.env ?? process.env;
  const components = Object.keys(assets.catalog.components);

  function perComponentUri(component: string): string {
    return `ui://sentropic/${component}/v1`;
  }

  function listResources(_context?: UiRenderCallContext): { resources: McpResourceDescriptor[] } {
    const resources: McpResourceDescriptor[] = [
      {
        uri: UI_RENDER_RESOURCE_URI,
        name: "Sentropic Design-System JSON Renderer (v1)",
        description: `Sandboxed SEP-1865 MCP App shell hosting @sentropic/design-system-elements (${components
          .map(componentTag)
          .map((tag) => `<${tag}>`)
          .join(", ")}).`,
        mimeType: UI_MIME_TYPE,
        _meta: { ui: { csp: PILOT_CSP } }
      },
      {
        uri: A2UI_CATALOG_RESOURCE_URI,
        name: "Sentropic Design-System Elements Catalogue (v1)",
        description: `Machine-readable JSON Schema 2020-12 component catalogue ($id: ${assets.catalog.catalogId}).`,
        mimeType: CATALOG_MIME_TYPE
      }
    ];
    for (const component of components) {
      resources.push({
        uri: perComponentUri(component),
        name: `Sentropic Design-System ${component} Renderer (v1)`,
        description: `Single-component MCP App shell inlining the core runtime, the ${component} engine chunk and #st-host-config.`,
        mimeType: UI_MIME_TYPE,
        _meta: { ui: { csp: PILOT_CSP } }
      });
    }
    return { resources };
  }

  function readResource(uri: string, _context?: UiRenderCallContext): McpReadResourceResult {
    if (uri === UI_RENDER_RESOURCE_URI) {
      return {
        contents: [shellContents(uri, buildShellHtml(assets, serializeHostConfigScript(buildResourceHostConfig(env))))]
      };
    }
    if (uri === A2UI_CATALOG_RESOURCE_URI) {
      return { contents: [{ uri, mimeType: CATALOG_MIME_TYPE, text: assets.catalogText }] };
    }
    for (const component of components) {
      if (uri === perComponentUri(component)) {
        return {
          contents: [
            shellContents(
              uri,
              buildShellHtml(assets, serializeHostConfigScript(buildResourceHostConfig(env)), component)
            )
          ]
        };
      }
    }
    // No filesystem path traversal or arbitrary URI scheme is ever read.
    throw new UnknownResourceError(uri);
  }

  return { listResources, readResource };
}
