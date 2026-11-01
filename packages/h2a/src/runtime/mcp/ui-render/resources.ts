/**
 * The ui:// resource surface (h2a spec §3): the five pinned resource
 * descriptors (`resources/list`) and the exact-URI `resources/read`
 * handler. The pilot MCP App shell is assembled server-side from the
 * vendored build — the core runtime (and, for per-component resources, the
 * requested component's transitive engine/theme closure) is inlined together
 * with `#st-host-config`, and the SEP-1865 postMessage bridge script
 * (h2a spec §3.3) implements `ui/initialize`, `ui/notifications/tool-input`
 * / `tool-result` / `host-context-changed`, the §4.4 contract check, the
 * `st-intent` whitelist and the `submit_intent` bridge.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readInlineModule } from "./inline.js";

import type { UiRenderAssets, UiRenderCatalogEntry, UiRenderSriDocument } from "./assets.js";
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

/** The resource serving mode (SPEC-H2A-UIRENDER-CDN §5.1). */
export type UiRenderResourceMode = "auto" | "pilot-inline" | "pilot-per-component" | "cdn-sri";

/** The resolved serving mode: `auto` never survives resolution. */
export type ResolvedUiRenderResourceMode = "cdn-sri" | "pilot-inline" | "pilot-per-component";

/** Strict exact semver (no range, no tag): the only pinnable CDN version. */
const EXACT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/** `sha384-<base64>` (48 digest bytes, no padding): the only admitted SRI form. */
const SRI_SHA384_PATTERN = /^sha384-[A-Za-z0-9+/]{64}$/;

/** A deterministic `integrity_mismatch` refusal (h2a spec §7.2). */
function integrityMismatch(detail: string): Error {
  return new Error(`integrity_mismatch: ${detail}`);
}

/**
 * Guards the pinned CDN version (SPEC-H2A-UIRENDER-CDN §4): an exact semver
 * that is neither `"0.0.0"` (pre-L7a) nor `"latest"` nor a range, with every
 * `sri.files` entry carrying a valid `sha384-...` digest. Returns the version
 * the immutable CDN base URL is derived from. `cdnVersionOverride` stages
 * `cdn-sri` while `sri.version` is still `"0.0.0"` (lots CDN-1/CDN-2); the
 * integrity digests always come from the verified local `sri.files`.
 */
export function assertCdnSriVersion(
  sri: UiRenderSriDocument,
  cdnVersionOverride?: string
): string {
  const version = cdnVersionOverride ?? sri.version;
  if (typeof version !== "string" || !EXACT_SEMVER_PATTERN.test(version) || version === "0.0.0") {
    throw integrityMismatch(
      `cdn-sri mode requires an exact published design-system version, not ${JSON.stringify(version)}`
    );
  }
  const files = (sri as { files?: unknown }).files;
  if (files === undefined || files === null || typeof files !== "object") {
    throw integrityMismatch("cdn-sri mode requires an sri files integrity map");
  }
  for (const [file, entry] of Object.entries(files as Record<string, unknown>)) {
    const integrity = (entry as { integrity?: unknown } | null | undefined)?.integrity;
    if (typeof integrity !== "string" || !SRI_SHA384_PATTERN.test(integrity)) {
      throw integrityMismatch(
        `cdn-sri mode requires a valid sha384 integrity for ${JSON.stringify(file)}`
      );
    }
  }
  return version;
}

/**
 * The immutable CDN base URL for one pinned version. Only relative paths
 * present as keys in `sri.files` may be addressed under it (§4).
 */
export function cdnBaseForVersion(version: string): string {
  if (!EXACT_SEMVER_PATTERN.test(version) || version === "0.0.0") {
    throw integrityMismatch(
      `the CDN base URL requires an exact published design-system version, not ${JSON.stringify(version)}`
    );
  }
  return `https://cdn.jsdelivr.net/npm/@sentropic/design-system-elements@${version}/dist/browser/`;
}

/**
 * Resolves the effective serving mode (SPEC-H2A-UIRENDER-CDN §5.1): forced
 * offline (`H2A_UI_RENDER_OFFLINE=1`) always wins; otherwise the explicit
 * mode (option or `H2A_UI_RENDER_MODE`) wins; `auto` selects `cdn-sri` once
 * the SRI index carries a published version, `pilot-inline` before L7a.
 */
export function resolveUiRenderMode(
  assets: UiRenderAssets,
  env: Record<string, string | undefined>,
  mode?: UiRenderResourceMode
): ResolvedUiRenderResourceMode {
  if (env["H2A_UI_RENDER_OFFLINE"] === "1") return "pilot-inline";
  const requested = mode ?? env["H2A_UI_RENDER_MODE"] ?? "auto";
  if (requested === "pilot-inline" || requested === "pilot-per-component") return requested;
  if (requested === "cdn-sri") return "cdn-sri";
  return assets.sri.version === "0.0.0" ? "pilot-inline" : "cdn-sri";
}

/** Parses the inline byte ceiling (`H2A_UI_RENDER_INLINE_MAX_BYTES`, default 960 KiB). */
function resolveInlineMaxBytes(
  env: Record<string, string | undefined>,
  inlineMaxBytes?: number
): number {
  if (inlineMaxBytes !== undefined) return inlineMaxBytes;
  const raw = env["H2A_UI_RENDER_INLINE_MAX_BYTES"]?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 960 * 1024;
}

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
  /**
   * The serving mode; defaults to `auto` (`H2A_UI_RENDER_MODE` when unset).
   * `H2A_UI_RENDER_OFFLINE=1` always forces the offline inline behaviour.
   */
  readonly mode?: UiRenderResourceMode;
  /**
   * The inline byte ceiling before the bounded degraded alert
   * (`H2A_UI_RENDER_INLINE_MAX_BYTES` when unset, default 960 KiB).
   */
  readonly inlineMaxBytes?: number;
  /**
   * A staged CDN version for `cdn-sri` while `sri.version` is still
   * `"0.0.0"` (lots CDN-1/CDN-2); integrity digests always stay local.
   */
  readonly cdnVersionOverride?: string;
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

/**
 * The SEP-1865 shell protocol script (h2a spec §3.3). Plain classic script:
 * no imports, no eval, no template literals — it only bridges postMessage
 * traffic and mounts the custom element the vendored core defines. In
 * `cdn-sri` shells `cdnJson` carries the verified CDN plan (base URL, SRI
 * digests, lazy engines, themes) and the bridge preloads lazy engine/theme
 * chunks from jsDelivr with SRI, falling back to a deterministic DOM summary
 * on any load failure (SPEC-H2A-UIRENDER-CDN §5.2) — never a blank surface.
 */
function shellScript(metaJson: string, cdnJson: string | null): string {
  return `
(function () {
  "use strict";
  var META = ${metaJson};
  var CDN = ${cdnJson === null ? "null" : cdnJson};
  var configElement = document.getElementById("st-host-config");
  var hostConfig = {};
  try { hostConfig = JSON.parse(configElement ? configElement.textContent : "{}") || {}; } catch (error) { hostConfig = {}; }
  var root = document.getElementById("st-root");
  var envelope = null;
  var toolInputEnvelope = null;
  var mountedElement = null;
  var resultRevision = 0;
  var diagnostics = [];
  var requestCounter = 0;
  var loadGeneration = 0;
  var pendingLoad = null;

  function postToHost(message) {
    try { window.parent.postMessage(message, "*"); } catch (error) { /* the bridge is best-effort */ }
  }
  function nextRequestId() { requestCounter += 1; return "st-shell-" + requestCounter; }

  function applyHostContext(context) {
    if (!context || typeof context !== "object") return;
    if (context.colorScheme === "dark" || context.colorScheme === "light") {
      document.documentElement.setAttribute("data-st-color-scheme", context.colorScheme);
      hostConfig = Object.assign({}, hostConfig, { colorScheme: context.colorScheme });
    }
    if (typeof context.locale === "string" && context.locale.trim()) {
      hostConfig = Object.assign({}, hostConfig, { locale: context.locale });
    }
    if (mountedElement) mountedElement.hostConfig = hostConfig;
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
    mountedElement = null;
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

  function mountElement(component, effectiveConfig) {
    var element = document.createElement(META.tags[component]);
    element.hostConfig = effectiveConfig;
    element.envelope = envelope;
    element.addEventListener("st-intent", onIntent);
    while (root.firstChild) root.removeChild(root.firstChild);
    mountedElement = element;
    root.appendChild(element);
  }

  function componentOf() {
    if (!envelope || typeof envelope !== "object") return "";
    var target = envelope.root || {};
    return typeof target.component === "string" ? target.component : "";
  }

  function headElement() {
    if (document.head) return document.head;
    var heads = document.getElementsByTagName("head");
    return heads && heads[0] ? heads[0] : null;
  }

  function cdnGroupChunks(group) {
    var out = [];
    var files = CDN.sriFiles;
    for (var path in files) {
      if (!Object.prototype.hasOwnProperty.call(files, path)) continue;
      if (path.slice(-3) !== ".js" || path.indexOf("chunks/") !== 0) continue;
      var entry = files[path];
      if (entry && entry.group === group) out.push(path);
    }
    return out;
  }

  function injectPreload(url, integrity) {
    var link = document.createElement("link");
    link.setAttribute("rel", "modulepreload");
    link.setAttribute("href", url);
    link.setAttribute("integrity", integrity);
    link.setAttribute("crossorigin", "anonymous");
    var head = headElement();
    if (head) head.appendChild(link);
  }

  function injectModule(url, integrity, onLoad, onError) {
    var script = document.createElement("script");
    script.setAttribute("type", "module");
    script.setAttribute("src", url);
    script.setAttribute("integrity", integrity);
    script.setAttribute("crossorigin", "anonymous");
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    var head = headElement();
    if (head) head.appendChild(script);
    else onError();
  }

  function textChild(tag, text) {
    var element = document.createElement(tag);
    element.textContent = String(text === undefined || text === null ? "" : text);
    return element;
  }

  function dossierFallbackSection(documentNode) {
    var section = document.createElement("section");
    section.setAttribute("data-st-offline-fallback", "DecisionDossier");
    section.appendChild(textChild("h2", documentNode.title || "Decision dossier"));
    if (documentNode.subject) section.appendChild(textChild("p", documentNode.subject));
    var sections = documentNode.sections;
    if (Array.isArray(sections)) {
      for (var index = 0; index < sections.length; index += 1) {
        var entry = sections[index] || {};
        if (entry.title) section.appendChild(textChild("h3", entry.title));
        if (entry.question) section.appendChild(textChild("p", "Question : " + entry.question));
        var options = entry.options;
        if (Array.isArray(options)) {
          var list = document.createElement("ul");
          for (var option = 0; option < options.length; option += 1) {
            var item = options[option] || {};
            list.appendChild(textChild("li", item.label || item.id || ""));
          }
          section.appendChild(list);
        }
      }
    }
    section.appendChild(textChild("p", "Full interactive rendering stays available offline in render_DecisionDossier (ui://sentropic/DecisionDossier/v1)."));
    return section;
  }

  function bpmnFallbackSection(documentNode) {
    var section = document.createElement("section");
    section.setAttribute("data-st-offline-fallback", "BpmnCanvas");
    section.appendChild(textChild("h2", "BPMN process"));
    section.appendChild(textChild("p", "id : " + (documentNode.id || "")));
    section.appendChild(textChild("p", "targetNamespace : " + (documentNode.targetNamespace || "")));
    var roots = Array.isArray(documentNode.rootElements) ? documentNode.rootElements : [];
    var participants = 0;
    var processes = 0;
    var flowElements = 0;
    var sequenceFlows = 0;
    var rows = [];
    for (var index = 0; index < roots.length; index += 1) {
      var node = roots[index] || {};
      var type = typeof node.$type === "string" ? node.$type : "";
      if (type.slice(-13) === ":Participant" || type === "Participant") participants += 1;
      if (type.slice(-8) === ":Process" || type === "Process") {
        processes += 1;
        var elements = Array.isArray(node.flowElements) ? node.flowElements : [];
        flowElements += elements.length;
        for (var cell = 0; cell < elements.length; cell += 1) {
          var child = elements[cell] || {};
          var childType = typeof child.$type === "string" ? child.$type : "";
          if (childType.indexOf("SequenceFlow") !== -1) sequenceFlows += 1;
          if (child.name && (childType.indexOf("Task") !== -1 || childType.indexOf("Event") !== -1 || childType.indexOf("Gateway") !== -1)) {
            rows.push([childType, child.id || "", child.name]);
          }
        }
      }
      if (type.indexOf("SequenceFlow") !== -1) sequenceFlows += 1;
    }
    section.appendChild(textChild("p", "participants : " + participants + ", processes : " + processes +
      ", flowElements : " + flowElements + ", sequenceFlows : " + sequenceFlows));
    if (rows.length > 0) {
      var table = document.createElement("table");
      var headRow = document.createElement("tr");
      headRow.appendChild(textChild("th", "type"));
      headRow.appendChild(textChild("th", "id"));
      headRow.appendChild(textChild("th", "name"));
      table.appendChild(headRow);
      for (var row = 0; row < rows.length; row += 1) {
        var line = document.createElement("tr");
        line.appendChild(textChild("td", rows[row][0]));
        line.appendChild(textChild("td", rows[row][1]));
        line.appendChild(textChild("td", rows[row][2]));
        table.appendChild(line);
      }
      section.appendChild(table);
    }
    section.appendChild(textChild("p", "Full interactive rendering stays available offline through the non-UI text fallback."));
    return section;
  }

  function showEngineFallback(component, chunk, cause) {
    mountedElement = null;
    diagnostics = [{
      code: "engine-load-failed",
      path: "/root/document",
      message: "failed to load the \\"" + chunk + "\\" engine chunk from cdn.jsdelivr.net",
      severity: "error",
      source: "host",
      detail: { chunk: chunk, cause: cause }
    }];
    var panel = document.createElement("div");
    panel.setAttribute("role", "alert");
    panel.setAttribute("data-st-diagnostics", "1");
    var title = document.createElement("p");
    title.textContent = "The lazy engine chunk failed to load; showing the offline summary:";
    panel.appendChild(title);
    var line = document.createElement("p");
    line.textContent = "engine-load-failed /root/document failed to load the \\"" + chunk + "\\" engine chunk from cdn.jsdelivr.net";
    panel.appendChild(line);
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(panel);
    var target = (envelope && envelope.root && envelope.root.document) || {};
    if (component === "DecisionDossier") root.appendChild(dossierFallbackSection(target));
    else root.appendChild(bpmnFallbackSection(target));
  }

  function ensureLazy(component, engine, theme, config, generation) {
    var effective = config;
    var remaining = 0;
    var finished = false;
    var job = { generation: generation, component: component, chunk: engine ? engine.facade : theme.file };
    pendingLoad = job;
    function finishOk() {
      if (finished || generation !== loadGeneration) return;
      finished = true;
      pendingLoad = null;
      clearTimeout(timer);
      mountElement(component, effective);
    }
    function fail(cause) {
      if (finished || generation !== loadGeneration) return;
      finished = true;
      pendingLoad = null;
      clearTimeout(timer);
      showEngineFallback(component, job.chunk, cause);
    }
    job.fail = fail;
    var timer = setTimeout(function () { fail("timeout"); }, 10000);
    function awaitChunk(file, integrity, kind) {
      remaining += 1;
      injectModule(CDN.base + file, integrity,
        function onLoad() {
          remaining -= 1;
          if (remaining === 0) finishOk();
        },
        function onError() {
          if (kind === "theme") {
            effective = Object.assign({}, config, { theme: "sent-tech" });
            remaining -= 1;
            if (remaining === 0) finishOk();
          } else {
            fail("error");
          }
        });
    }
    if (engine) {
      var preloads = cdnGroupChunks(engine.group);
      for (var index = 0; index < preloads.length; index += 1) {
        if (preloads[index] === engine.facade) continue;
        injectPreload(CDN.base + preloads[index], CDN.sriFiles[preloads[index]].integrity);
      }
      awaitChunk(engine.facade, CDN.sriFiles[engine.facade].integrity, "engine");
    }
    if (theme) awaitChunk(theme.file, theme.integrity, "theme");
  }

  function render() {
    if (hasErrorDiagnostics()) { showDiagnostics(); return; }
    var component = componentOf();
    if (!component) return;
    if (!Object.prototype.hasOwnProperty.call(META.tags, component) ||
        !contractAccepted(META.contracts[component])) {
      diagnostics = [{ code: "unknown-component", path: "/root/component", message: "the shell cannot mount " + component, severity: "error", source: "catalog" }];
      showDiagnostics();
      return;
    }
    if (CDN === null) { mountElement(component, hostConfig); return; }
    var engine = Object.prototype.hasOwnProperty.call(CDN.engines, component) ? CDN.engines[component] : null;
    var theme = (hostConfig.theme === "forge" || hostConfig.theme === "entropic") &&
      Object.prototype.hasOwnProperty.call(CDN.themes, hostConfig.theme) ? CDN.themes[hostConfig.theme] : null;
    if (!engine && !theme) { mountElement(component, hostConfig); return; }
    loadGeneration += 1;
    ensureLazy(component, engine, theme, hostConfig, loadGeneration);
  }

  if (CDN !== null) {
    document.addEventListener("securitypolicyviolation", function (event) {
      var blocked = event && event.blockedURI;
      if (pendingLoad && typeof blocked === "string" && blocked.indexOf(CDN.base) === 0) {
        var job = pendingLoad;
        job.fail("securitypolicyviolation");
      }
    });
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
      context: Object.assign({ component: component }, detail.context && typeof detail.context === "object" ? detail.context : {})
    };
    postToHost({ jsonrpc: "2.0", id: nextRequestId(), method: "tools/call", params: { name: "submit_intent", arguments: intent } });
    if (name === "select" || name === "choose-option" || name === "open") {
      postToHost({ jsonrpc: "2.0", method: "ui/update-model-context", params: { context: intent } });
    }
    if (name === "comment") {
      postToHost({ jsonrpc: "2.0", method: "ui/message", params: { message: JSON.stringify(intent) } });
    }
  }

  async function verifyInputDigest(expected, input) {
    function failure(code, message) {
      return { code: code, path: "", message: message, severity: "error", source: "host" };
    }
    if (!input || typeof input !== "object") {
      return failure("schema-violation", "SHA-256 verification requires a retained tool-input envelope");
    }
    if (typeof crypto === "undefined" || !crypto || !crypto.subtle || typeof TextEncoder === "undefined") {
      return failure("host-capability-missing", "SHA-256 verification requires Web Crypto and TextEncoder");
    }
    try {
      var hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))));
      var actual = "";
      for (var index = 0; index < hash.length; index += 1) actual += hash[index].toString(16).padStart(2, "0");
      if (actual !== expected) return failure("schema-violation", "SHA-256 does not match the retained tool-input envelope");
    } catch (error) {
      return failure("host-capability-missing", "SHA-256 verification failed in the host");
    }
    return null;
  }

  window.addEventListener("message", async function (event) {
    var message = event.data;
    if (!message || typeof message !== "object") return;
    if (typeof message.method === "string" && message.method.indexOf("ui/notifications/") === 0) {
      var params = message.params && typeof message.params === "object" ? message.params : {};
      if (message.method === "ui/notifications/tool-input") {
        resultRevision += 1;
        toolInputEnvelope = params.arguments;
        envelope = toolInputEnvelope; // retained in memory (DS §8.2)
        diagnostics = [];
        render();
      } else if (message.method === "ui/notifications/tool-result") {
        var revision = ++resultRevision;
        var structured = params.structuredContent;
        if (structured && typeof structured === "object") {
          var nextDiagnostics = Array.isArray(structured.diagnostics) ? structured.diagnostics : [];
          if (structured.envelope && typeof structured.envelope === "object") {
            envelope = structured.envelope;
          } else if (typeof structured.envelopeSha256 === "string") {
            var retained = toolInputEnvelope;
            var failure = await verifyInputDigest(structured.envelopeSha256, retained);
            if (revision !== resultRevision) return; // a newer input/result owns the surface
            if (failure) nextDiagnostics = nextDiagnostics.concat([failure]);
            else envelope = retained;
          }
          diagnostics = nextDiagnostics;
        }
        render();
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
export function buildShellHtml(assets: UiRenderAssets, hostConfigScript: string, component?: string): string {
  const core = readInlineModule(assets, component);
  const html = `<!DOCTYPE html>
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
<script>
${shellScript(shellComponentMeta(assets), null)}
</script>
</body>
</html>
`;
  return html;
}

/** One lazy engine entry of the verified CDN plan embedded in the shell. */
interface CdnEnginePlan {
  readonly facade: string;
  readonly group: string;
}

/** The verified CDN plan the `cdn-sri` bridge script consumes. */
interface CdnShellPlan {
  readonly base: string;
  readonly sriFiles: Readonly<Record<string, { readonly integrity: string; readonly group?: string }>>;
  readonly engines: Readonly<Record<string, CdnEnginePlan>>;
  readonly themes: Readonly<Record<string, { readonly file: string; readonly integrity: string }>>;
}

/** Finds the single chunk under `dist/browser/chunks/` starting with `prefix`. */
function findCdnChunk(sri: UiRenderSriDocument, prefix: string): string {
  const hit = Object.keys(sri.files)
    .filter((file) => file.startsWith("chunks/") && file.endsWith(".js"))
    .find((file) => file.startsWith(prefix));
  if (hit === undefined) {
    throw integrityMismatch(`cdn-sri mode requires a ${JSON.stringify(prefix)} chunk in sri.files`);
  }
  return hit;
}

/**
 * Reads the verified core runtime (`dist/browser/elements.js`) the `cdn-sri`
 * shell inlines: SHA-256 against the manifest pin and SHA-384 against the
 * SRI index, both recomputed on the local bytes.
 */
function readCdnCore(assets: UiRenderAssets): string {
  const rel = "dist/browser/elements.js";
  let text: string;
  try {
    text = readFileSync(join(fileURLToPath(assets.vendorDir), rel), "utf8");
  } catch {
    throw integrityMismatch(`the vendored core ${JSON.stringify(rel)} is not readable`);
  }
  if (createHash("sha256").update(text).digest("hex") !== assets.manifest.files[rel]?.sha256) {
    throw integrityMismatch(`the vendored core ${JSON.stringify(rel)} does not match the pinned sha256`);
  }
  if (
    `sha384-${createHash("sha384").update(text).digest("base64")}` !==
    assets.sri.files["elements.js"]?.integrity
  ) {
    throw integrityMismatch(`the vendored core ${JSON.stringify(rel)} does not match the pinned sri sha384`);
  }
  return text;
}

/**
 * Assembles the `cdn-sri` MCP App shell HTML (SPEC-H2A-UIRENDER-CDN §3.1,
 * §4): the verified `elements.js` core inlined with every relative chunk
 * specifier rewritten to the immutable pinned CDN base, a `<script
 * type="importmap">` carrying the exact `sha384-...` integrity of every
 * chunk, `#st-host-config`, and the lazy-preloading bridge script. The
 * per-component offline closures stay served by `buildShellHtml`.
 */
export function buildCdnShellHtml(
  assets: UiRenderAssets,
  hostConfigScript: string,
  cdnVersionOverride?: string
): string {
  const version = assertCdnSriVersion(assets.sri, cdnVersionOverride);
  const base = cdnBaseForVersion(version);
  const core = readCdnCore(assets);
  if (!core.includes("./chunks/")) {
    throw integrityMismatch("the vendored core carries no relative chunk specifier to rewrite");
  }
  const rewritten = core.split("./chunks/").join(`${base}chunks/`);
  if (rewritten.includes("./chunks/")) {
    throw integrityMismatch("a relative chunk specifier survived the CDN rewrite");
  }
  const chunkFiles = Object.keys(assets.sri.files)
    .filter((file) => file.startsWith("chunks/") && file.endsWith(".js"))
    .sort();
  const imports: Record<string, string> = {};
  const integrity: Record<string, string> = {};
  for (const file of chunkFiles) {
    const url = `${base}${file}`;
    imports[url] = url;
    integrity[url] = assets.sri.files[file].integrity;
  }
  const importmap = JSON.stringify({ imports, integrity });
  const sriFiles: Record<string, { integrity: string; group?: string }> = {};
  for (const file of chunkFiles) {
    const entry = assets.sri.files[file];
    sriFiles[file] =
      entry.group === undefined ? { integrity: entry.integrity } : { integrity: entry.integrity, group: entry.group };
  }
  const engineFacade = (prefix: string): CdnEnginePlan => {
    const facade = findCdnChunk(assets.sri, prefix);
    const group = assets.sri.files[facade].group;
    if (typeof group !== "string" || group.length === 0) {
      throw integrityMismatch(`cdn-sri mode requires a group tag for ${JSON.stringify(facade)}`);
    }
    return { facade, group };
  };
  const themeChunk = (prefix: string): { file: string; integrity: string } => {
    const file = findCdnChunk(assets.sri, prefix);
    return { file, integrity: assets.sri.files[file].integrity };
  };
  const plan: CdnShellPlan = {
    base,
    sriFiles,
    engines: {
      BpmnCanvas: engineFacade("chunks/bpmn-canvas-"),
      DecisionDossier: engineFacade("chunks/focus-renderer-")
    },
    themes: {
      forge: themeChunk("chunks/forge-"),
      entropic: themeChunk("chunks/entropic-")
    }
  };
  const html = `<!DOCTYPE html>
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
<script type="importmap">
${importmap}
</script>
</head>
<body>
<div id="st-root"></div>
${hostConfigScript}
<script type="module">
${rewritten}
</script>
<script>
${shellScript(shellComponentMeta(assets), JSON.stringify(plan))}
</script>
</body>
</html>
`;
  return html;
}

/** The `resources/read` contents entry for one ui:// shell resource. */
function shellContents(uri: string, html: string, inlineMaxBytes: number): McpResourceContents {
  const bytes = Buffer.byteLength(html);
  if (bytes > inlineMaxBytes) {
    const fallback = uri === UI_RENDER_RESOURCE_URI
      ? "Use render_BarChart, render_DecisionDossier or render_BpmnCanvas (per-component resources, DS §8.3)."
      : "The complete BPMN module also exceeds the frame budget. Use the non-UI text fallback.";
    const hostConfigScript = html.match(/<script type="application\/json" id="st-host-config">[\s\S]*?<\/script>/)?.[0] ?? "";
    html = `<!DOCTYPE html><html lang="en"><body><div role="alert" data-st-resource-degraded="true">Complete resource: ${bytes} bytes; limit: 983040 bytes. ${fallback}</div>${hostConfigScript}<script>window.parent.postMessage({jsonrpc:"2.0",id:"st-degraded",method:"ui/initialize",params:{}},"*");</script></body></html>`;
  }
  return { uri, mimeType: UI_MIME_TYPE, text: html, _meta: { ui: { csp: PILOT_CSP } } };
}

export function createUiRenderResources(options: CreateUiRenderResourcesOptions): UiRenderResources {
  const assets = options.assets;
  const env = options.env ?? process.env;
  const components = Object.keys(assets.catalog.components);
  const mode = resolveUiRenderMode(assets, env, options.mode);
  const inlineMaxBytes = resolveInlineMaxBytes(env, options.inlineMaxBytes);
  // Fail fast: a requested `cdn-sri` mode on a placeholder, floating or
  // range version refuses here, before anything is served.
  if (mode === "cdn-sri") assertCdnSriVersion(assets.sri, options.cdnVersionOverride);

  function perComponentUri(component: string): string {
    return `ui://sentropic/${component}/v1`;
  }

  function combinedShell(hostConfigScript: string): string {
    if (mode === "cdn-sri") {
      return buildCdnShellHtml(assets, hostConfigScript, options.cdnVersionOverride);
    }
    return buildShellHtml(assets, hostConfigScript);
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
        contents: [
          shellContents(
            uri,
            combinedShell(serializeHostConfigScript(buildResourceHostConfig(env))),
            inlineMaxBytes
          )
        ]
      };
    }
    if (uri === A2UI_CATALOG_RESOURCE_URI) {
      return { contents: [{ uri, mimeType: CATALOG_MIME_TYPE, text: assets.catalogText }] };
    }
    for (const component of components) {
      if (uri === perComponentUri(component)) {
        // BarChart and DecisionDossier stay 100% self-contained inline
        // closures in every mode (100% offline); render/v1 and BpmnCanvas/v1
        // serve the CDN-backed shell in `cdn-sri` mode.
        const cdnComponent = mode === "cdn-sri" && component === "BpmnCanvas";
        return {
          contents: [
            shellContents(
              uri,
              cdnComponent
                ? buildCdnShellHtml(
                    assets,
                    serializeHostConfigScript(buildResourceHostConfig(env)),
                    options.cdnVersionOverride
                  )
                : buildShellHtml(
                    assets,
                    serializeHostConfigScript(buildResourceHostConfig(env)),
                    component
                  ),
              inlineMaxBytes
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
