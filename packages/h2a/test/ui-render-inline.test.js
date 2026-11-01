import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createUiRenderResources, loadUiRenderAssets } from "../dist/index.js";
import { buildShellHtml } from "../dist/runtime/mcp/ui-render/resources.js";

test("every pilot entry closes all static and lazy imports in one sandboxed module", async () => {
  const assets = await loadUiRenderAssets();
  const resources = createUiRenderResources({ assets, env: {}, mode: "pilot-inline" });
  for (const name of ["render", "BarChart", "BpmnCanvas", "DecisionDossier"]) {
    const served = resources.readResource(`ui://sentropic/${name}/v1`).contents[0].text;
    const html = buildShellHtml(assets, "", name === "render" ? undefined : name);
    if (Buffer.byteLength(html) > 960 * 1024) {
      assert.match(served, /data-st-resource-degraded="true"/);
      assert.match(served, /983040/);
      assert.ok(Buffer.byteLength(served) < 960 * 1024);
    } else assert.ok(served.includes(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]));
    const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
    assert.equal(modules.length, 1, `${name}: one inline entry`);
    const source = modules[0][1];
    const file = ts.createSourceFile(`${name}.js`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports = [];
    function visit(node) {
      if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
          (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) imports.push(node.getText(file));
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.deepEqual(imports, [], `${name}: unresolved import specifiers`);
    const compiled = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "-e", `
      import { SourceTextModule, createContext } from 'node:vm';
      let source = ''; for await (const part of process.stdin) source += part;
      const module = new SourceTextModule(source, { context: createContext({}),
        importModuleDynamically() { throw new Error('external dynamic import'); } });
      await module.link(specifier => { throw new Error('external import: ' + specifier); });
      if (module.status !== 'linked') throw new Error(module.status);
    `], { input: source, encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr);
  }
});

test("bundled entries include every requested engine and both theme closures", () => {
  const dir = new URL("../vendor/ui-render-inline/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
  for (const [name, file] of Object.entries(manifest.files)) {
    assert.ok(file.inputs.some(path => /forge-/.test(path)), name);
    assert.ok(file.inputs.some(path => /entropic-/.test(path)), name);
    assert.equal(file.inputs.some(path => /focus-renderer-/.test(path)), ["render.js", "DecisionDossier.js"].includes(name));
    assert.equal(file.inputs.some(path => /bpmn-canvas-/.test(path)), ["render.js", "BpmnCanvas.js"].includes(name));
    if (["render.js", "BpmnCanvas.js"].includes(name)) {
      for (const chunk of ["Modeler-", "Viewer-", "layout-", "legend-", "colored-", "dist-Co2"]) {
        assert.ok(file.inputs.some(path => path.includes(chunk)), `${name}: missing ${chunk}`);
      }
    }
  }
});
