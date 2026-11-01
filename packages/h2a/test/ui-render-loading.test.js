import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CORE_DEPENDENCIES = [
  "@hono/mcp", "@hono/node-server", "@modelcontextprotocol/sdk",
  "@sentropic/cluster-mesh", "@sentropic/track", "hono", "toml-eslint-parser"
];

for (const layout of ["ui-dependencies-absent", "focus-unbuilt"]) {
  test(`core CLI and MCP remain available with ${layout}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "h2a-ui-loading-"));
    try {
      const modules = join(directory, "node_modules");
      const candidate = join(modules, "@sentropic/h2a");
      mkdirSync(candidate, { recursive: true });
      cpSync(join(ROOT, "packages/h2a/dist"), join(candidate, "dist"), { recursive: true });
      cpSync(join(ROOT, "packages/h2a/package.json"), join(candidate, "package.json"));
      symlinkSync(join(ROOT, "packages/h2a/vendor"), join(candidate, "vendor"), "dir");
      symlinkSync(join(ROOT, "packages/h2a/fixtures"), join(candidate, "fixtures"), "dir");
      const dependencies = layout === "focus-unbuilt" ? [...CORE_DEPENDENCIES, "ajv"] : CORE_DEPENDENCIES;
      for (const dependency of dependencies) {
        const destination = join(modules, dependency);
        mkdirSync(join(destination, ".."), { recursive: true });
        symlinkSync(join(ROOT, "node_modules", dependency), destination, "dir");
      }
      if (layout === "focus-unbuilt") {
        const focus = join(modules, "@sentropic/focus");
        mkdirSync(focus, { recursive: true });
        cpSync(join(ROOT, "packages/focus/package.json"), join(focus, "package.json"));
      }
      const env = {
        ...process.env, HOME: directory, TMPDIR: directory,
        XDG_RUNTIME_DIR: join(directory, "runtime"), H2A_ROOT: join(directory, "bus")
      };
      for (const args of [["--help"], ["focus", "serve", "--help"]]) {
        const result = spawnSync(process.execPath, [join(candidate, "dist/bin.js"), ...args], {
          cwd: directory, env, encoding: "utf8"
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /h2a/);
      }
      const probe = join(directory, "probe.mjs");
      writeFileSync(probe, `
        import assert from 'node:assert/strict';
        import { PassThrough } from 'node:stream';
        import { runMcpStdio, createUiRenderModule } from '@sentropic/h2a';
        assert.throws(() => createUiRenderModule(), /ajv|focus/);
        const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
        let output = '', diagnostics = '';
        stdout.on('data', chunk => output += chunk);
        stderr.on('data', chunk => diagnostics += chunk);
        const done = runMcpStdio({ root: process.env.H2A_ROOT, stdin, stdout, stderr });
        stdin.end([
          { jsonrpc: '2.0', id: 1, method: 'initialize' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          { jsonrpc: '2.0', id: 3, method: 'resources/list' }
        ].map(value => JSON.stringify(value) + '\\n').join(''));
        await done;
        const responses = output.trim().split('\\n').map(line => JSON.parse(line));
        const init = responses.find(value => value.id === 1).result;
        assert.equal(init.serverInfo.name, '@sentropic/h2a');
        assert.deepEqual(responses.find(value => value.id === 3).result.resources, []);
        const tools = responses.find(value => value.id === 2).result.tools;
        assert.equal(tools.length, 60);
        assert.ok(tools.some(tool => tool.name === 'h2a_send'));
        assert.ok(tools.every(tool => tool.name !== 'render'));
        assert.match(diagnostics, /ui-render assets unavailable/);
      `);
      const result = spawnSync(process.execPath, [probe], { cwd: directory, env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
