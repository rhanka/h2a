import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createUiRenderModule } from "../dist/index.js";

class Element {
  children = [];
  attributes = {};
  events = {};
  textContent = "";
  constructor(tag) { this.tag = tag; }
  get firstChild() { return this.children[0] ?? null; }
  appendChild(child) { this.children.push(child); }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
}

function shell(module, crypto = webcrypto) {
  const html = module.resources.readResource("ui://sentropic/BarChart/v1").contents[0].text;
  const configText = html.match(/id="st-host-config">([\s\S]*?)<\/script>/)[1];
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const root = new Element("div");
  const documentElement = new Element("html");
  const variables = {};
  documentElement.style = { setProperty(name, value) { variables[name] = value; } };
  const messages = [];
  let receive;
  const window = { parent: { postMessage(message) { messages.push(message); } },
    addEventListener(name, handler) { assert.equal(name, "message"); receive = handler; } };
  const document = { documentElement,
    getElementById(id) { return id === "st-root" ? root : { textContent: configText }; },
    createElement(tag) { return new Element(tag); } };
  runInNewContext(script, { document, window, crypto, TextEncoder });
  return { root, variables, messages,
    post(method, params) { return Promise.resolve(receive({ data: { method, params } })); },
    initialize(context) { return Promise.resolve(receive({ data: { id: messages[0].id, result: context } })); } };
}

let module;
test.before(() => { module = createUiRenderModule({ env: {} }); });
function envelope() {
  const root = structuredClone(module.assets.catalog.components.BarChart["x-sentropic"].example);
  root.data[0].label = "Été 🍁";
  return { contract: "1.0", root };
}
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const panelText = host => host.root.firstChild.children.map(child => child.textContent).join("\n");

test("shell propagates initialize context into the first element hostConfig", async () => {
  const host = shell(module);
  await host.initialize({ colorScheme: "dark", locale: "en-CA", cssVariables: { "--st-test": "value" } });
  await host.post("ui/notifications/tool-input", { arguments: envelope() });
  assert.equal(host.root.firstChild.hostConfig.colorScheme, "dark");
  assert.equal(host.root.firstChild.hostConfig.locale, "en-CA");
  assert.equal(host.variables["--st-test"], "value");
});

test("shell updates a mounted element hostConfig on host-context-changed", async () => {
  const host = shell(module);
  await host.post("ui/notifications/tool-input", { arguments: envelope() });
  const element = host.root.firstChild;
  await host.post("ui/notifications/host-context-changed", { colorScheme: "dark", locale: "en-GB" });
  assert.equal(host.root.firstChild, element);
  assert.equal(element.hostConfig.colorScheme, "dark");
  assert.equal(element.hostConfig.locale, "en-GB");
  assert.equal(element.hostConfig.theme, "sent-tech");
  await host.post("ui/notifications/host-context-changed", { colorScheme: "invalid", locale: " " });
  assert.equal(element.hostConfig.colorScheme, "dark");
  assert.equal(element.hostConfig.locale, "en-GB");
});

test("shell enriches allowed intents with the active component and preserves context", async () => {
  const host = shell(module);
  await host.post("ui/notifications/tool-input", { arguments: envelope() });
  host.root.firstChild.events["st-intent"]({ detail: { name: "select", target: "Q1", context: { value: 4 } } });
  const call = host.messages.find(message => message.method === "tools/call");
  assert.equal(call.params.arguments.context.component, "BarChart");
  assert.equal(call.params.arguments.context.value, 4);
  const before = host.messages.length;
  host.root.firstChild.events["st-intent"]({ detail: { name: "choose-option", target: "Q1", context: {} } });
  assert.equal(host.messages.length, before);
});

test("shell verifies the UTF-8 SHA-256 of the retained tool-input envelope", async () => {
  const host = shell(module);
  const input = envelope();
  await host.post("ui/notifications/tool-input", { arguments: input });
  await host.post("ui/notifications/tool-result", { structuredContent: { envelopeSha256: digest(input), diagnostics: [] } });
  assert.equal(host.root.firstChild.tag, "st-bar-chart");
  assert.deepEqual(host.root.firstChild.envelope, input);
});

test("shell refuses a mismatched envelope digest with a visible diagnostic", async () => {
  const host = shell(module);
  await host.post("ui/notifications/tool-input", { arguments: envelope() });
  await host.post("ui/notifications/tool-result", { structuredContent: { envelopeSha256: "0".repeat(64), diagnostics: [] } });
  assert.equal(host.root.firstChild.attributes.role, "alert");
  assert.match(panelText(host), /schema-violation.*SHA-256/);
});

test("shell refuses hash-only results without a tool-input even after an inline result", async () => {
  const host = shell(module);
  const input = envelope();
  await host.post("ui/notifications/tool-result", { structuredContent: { envelope: input, diagnostics: [] } });
  await host.post("ui/notifications/tool-result", { structuredContent: { envelopeSha256: digest(input), diagnostics: [] } });
  assert.equal(host.root.firstChild.attributes.role, "alert");
  assert.match(panelText(host), /tool-input/);
});

test("shell refuses digest verification when Web Crypto is unavailable", async () => {
  const host = shell(module, null);
  const input = envelope();
  await host.post("ui/notifications/tool-input", { arguments: input });
  await host.post("ui/notifications/tool-result", { structuredContent: { envelopeSha256: digest(input), diagnostics: [] } });
  assert.equal(host.root.firstChild.attributes.role, "alert");
  assert.match(panelText(host), /host-capability-missing/);
});

test("shell ignores an obsolete digest result when a newer tool-input arrives", async () => {
  let resolveDigest;
  const host = shell(module, { subtle: { digest() { return new Promise(resolve => { resolveDigest = resolve; }); } } });
  const input = envelope();
  await host.post("ui/notifications/tool-input", { arguments: input });
  const pending = host.post("ui/notifications/tool-result", { structuredContent: { envelopeSha256: "0".repeat(64), diagnostics: [] } });
  assert.equal(typeof resolveDigest, "function");
  const newer = envelope();
  newer.root.data[0].label = "newer";
  await host.post("ui/notifications/tool-input", { arguments: newer });
  resolveDigest(new Uint8Array(32).buffer);
  await pending;
  assert.equal(host.root.firstChild.tag, "st-bar-chart");
  assert.deepEqual(host.root.firstChild.envelope, newer);
});
