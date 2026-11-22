import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createMcpServer,
  createUiRenderModule,
  findNonLocalSchemaRefs,
  findSchemaRefCycles,
  inlineExternalSchemaRefs,
  lintMcpToolSchemas,
  MCP_HOST_SCHEMA_PROFILES
} from "../dist/index.js";
import { QUALIFIED_CLIS } from "../dist/hosts/capture-qualification.js";

const require = createRequire(import.meta.url);
const { Ajv2020 } = require("ajv/dist/2020.js");

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../..");

function compileStandalone(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

test("T4.1: all 73 exported MCP tools and 3 get_schema outputs pass the 6-CLI schema linter with zero cycles and zero bare arrays", () => {
  assert.deepEqual(
    Object.keys(MCP_HOST_SCHEMA_PROFILES).sort(),
    [...QUALIFIED_CLIS].sort(),
    "MCP_HOST_SCHEMA_PROFILES must cover every CLI in QUALIFIED_CLIS"
  );

  const root = mkdtempSync(join(tmpdir(), "h2a-l4-t41-"));
  try {
    const uiRender = createUiRenderModule();
    const server = createMcpServer({ root, storeInitialize: false, uiRender });
    const tools = server.listTools();
    assert.equal(tools.length, 73, `expected 73 exported MCP tools, got ${tools.length}`);

    const toolsReport = lintMcpToolSchemas(tools);
    assert.equal(
      toolsReport.ok,
      true,
      `tools/list lint failed with ${toolsReport.violations.length} violation(s): ${JSON.stringify(toolsReport.violations)}`
    );
    assert.deepEqual(toolsReport.violations, []);
    assert.ok(
      toolsReport.maxBytes < 16 * 1024,
      `largest exported tool schema (${toolsReport.maxBytes} B) should stay < 16 KiB`
    );

    const getSchemaItems = [];
    for (const component of Object.keys(uiRender.assets.schemas).sort()) {
      const res = uiRender.tools.callTool("get_schema", { component });
      assert.ok(res && !res.isError, `get_schema(${component}) succeeded`);
      const schema = res.structuredContent.schema;
      assert.deepEqual(findNonLocalSchemaRefs(schema), [], `get_schema(${component}) has no non-local $ref`);
      assert.deepEqual(findSchemaRefCycles(schema), [], `get_schema(${component}) has no $ref cycle`);
      assert.doesNotThrow(() => compileStandalone(schema), `get_schema(${component}) compiles standalone`);
      getSchemaItems.push({
        name: `get_schema_${component}`,
        description: `Standalone schema for ${component}`,
        inputSchema: schema
      });
    }
    assert.equal(getSchemaItems.length, 3, "expected 3 get_schema outputs");

    const getSchemaReport = lintMcpToolSchemas(getSchemaItems);
    assert.equal(
      getSchemaReport.ok,
      true,
      `get_schema lint failed with ${getSchemaReport.violations.length} violation(s): ${JSON.stringify(getSchemaReport.violations)}`
    );
    assert.deepEqual(getSchemaReport.violations, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T4.2: negative corpus verifies unit detection across all 6 qualified CLI profiles", () => {
  // 1. Remote $ref -> agy, gemini, vibe
  const remoteRefReport = lintMcpToolSchemas([
    {
      name: "remote_ref_tool",
      description: "Tool with remote $ref",
      inputSchema: {
        type: "object",
        properties: {
          x: { $ref: "https://example.test/schema.json#/$defs/Foo" }
        }
      }
    }
  ]);
  assert.equal(remoteRefReport.ok, false);
  assert.ok(remoteRefReport.byProfile.agy.some((v) => v.rule === "nonLocalRef"));
  assert.ok(remoteRefReport.byProfile.gemini.some((v) => v.rule === "nonLocalRef"));
  assert.ok(remoteRefReport.byProfile.vibe.some((v) => v.rule === "nonLocalRef"));

  // 2. Direct cycle + orphan cyclic $defs -> muse, vibe
  const cycleReport = lintMcpToolSchemas([
    {
      name: "cyclic_tool",
      description: "Tool with direct and orphan cycles",
      inputSchema: {
        type: "object",
        $defs: {
          Node: {
            type: "object",
            properties: { next: { $ref: "#/$defs/Node" } }
          },
          OrphanLoop: {
            type: "object",
            properties: { self: { $ref: "#/$defs/OrphanLoop" } }
          }
        },
        properties: {
          head: { $ref: "#/$defs/Node" }
        }
      }
    }
  ]);
  assert.equal(cycleReport.ok, false);
  assert.equal(
    cycleReport.byProfile.muse.filter((v) => v.rule === "refCycle").length,
    2,
    "muse detects both reachable and orphan cycles"
  );
  assert.equal(
    cycleReport.byProfile.vibe.filter((v) => v.rule === "refCycle").length,
    2,
    "vibe detects both reachable and orphan cycles"
  );
  assert.ok(
    cycleReport.byProfile.muse.some((v) => v.rule === "orphanDef" && v.path === "/$defs/OrphanLoop"),
    "muse detects orphan $defs entry"
  );

  // 3. Bare array + dead local JSON Pointer -> codex, gemini, vibe
  const bareArrayAndDeadRefReport = lintMcpToolSchemas([
    {
      name: "bare_array_dead_ref_tool",
      description: "Tool with bare array and dead pointer",
      inputSchema: {
        type: "object",
        properties: {
          tags: { type: "array" },
          missing: { $ref: "#/$defs/DoesNotExist" }
        }
      }
    }
  ]);
  assert.equal(bareArrayAndDeadRefReport.ok, false);
  assert.ok(bareArrayAndDeadRefReport.byProfile.codex.some((v) => v.rule === "bareArray"));
  assert.ok(bareArrayAndDeadRefReport.byProfile.gemini.some((v) => v.rule === "bareArray"));
  assert.ok(bareArrayAndDeadRefReport.byProfile.codex.some((v) => v.rule === "unresolvedLocalRef"));
  assert.ok(bareArrayAndDeadRefReport.byProfile.vibe.some((v) => v.rule === "unresolvedLocalRef"));

  // 4. Root without type: "object" + invalid/empty metadata -> claude, codex, gemini, vibe
  const badRootReport = lintMcpToolSchemas([
    {
      name: "not_object_root",
      description: "",
      inputSchema: {
        properties: { a: { type: "string" } }
      }
    }
  ]);
  assert.equal(badRootReport.ok, false);
  assert.ok(badRootReport.byProfile.claude.some((v) => v.rule === "rootNotObject"));
  assert.ok(badRootReport.byProfile.codex.some((v) => v.rule === "rootNotObject"));
  assert.ok(badRootReport.byProfile.gemini.some((v) => v.rule === "rootNotObject"));
  assert.ok(badRootReport.byProfile.vibe.some((v) => v.rule === "rootNotObject"));
  assert.ok(badRootReport.byProfile.claude.some((v) => v.rule === "emptyDescription"));

  // 5. External $dynamicRef and $recursiveAnchor -> agy, gemini, muse
  const dynamicKwReport = lintMcpToolSchemas([
    {
      name: "dynamic_kw_tool",
      description: "Tool with dynamic/recursive keywords",
      inputSchema: {
        type: "object",
        $recursiveAnchor: true,
        properties: {
          ext: { $dynamicRef: "https://example.test/dyn.json#meta" }
        }
      }
    }
  ]);
  assert.equal(dynamicKwReport.ok, false);
  assert.ok(dynamicKwReport.byProfile.agy.some((v) => v.rule === "dynamicOrRecursiveKeyword"));
  assert.ok(dynamicKwReport.byProfile.gemini.some((v) => v.rule === "dynamicOrRecursiveKeyword"));
  assert.ok(dynamicKwReport.byProfile.muse.some((v) => v.rule === "dynamicOrRecursiveKeyword"));

  // 6. Oversize schema > 128 KiB -> claude
  const hugePadding = "x".repeat(132 * 1024);
  const oversizeReport = lintMcpToolSchemas([
    {
      name: "oversize_tool",
      description: "Schema exceeding 128 KiB",
      inputSchema: {
        type: "object",
        description: hugePadding,
        properties: {}
      }
    }
  ]);
  assert.equal(oversizeReport.ok, false);
  assert.ok(oversizeReport.byProfile.claude.some((v) => v.rule === "schemaTooLarge"));
});

test("T4.3: live recursive tree schema unfolds to depth 2 with zero cycles, normalizes imported bare arrays, and validates instances up to depth 2", () => {
  const externalTreeDoc = {
    $id: "https://example.test/tree.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: {
      TreeNode: {
        type: "object",
        required: ["label"],
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          tags: { type: "array" },
          children: {
            type: "array",
            items: { $ref: "#/$defs/TreeNode" }
          }
        }
      },
      UnusedOrphan: {
        type: "object",
        properties: { self: { $ref: "#/$defs/UnusedOrphan" } }
      }
    }
  };

  const rootSchema = {
    $id: "https://example.test/tree-envelope.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["tree"],
    properties: {
      tree: { $ref: "https://example.test/tree.json#/$defs/TreeNode" }
    }
  };

  const inlined = inlineExternalSchemaRefs(rootSchema, [externalTreeDoc]);

  assert.deepEqual(findNonLocalSchemaRefs(inlined), [], "no non-local $ref remains");
  assert.deepEqual(findSchemaRefCycles(inlined), [], "live recursive schema unfolds to a cycle-free DAG");
  assert.ok(inlined.$defs?.TreeNode, "depth-0 TreeNode preserved");
  assert.ok(inlined.$defs?.TreeNode__d1, "depth-1 unfolded TreeNode__d1 created");
  assert.ok(inlined.$defs?.TreeNode__d2, "depth-2 unfolded TreeNode__d2 created");
  assert.equal(inlined.$defs?.UnusedOrphan, undefined, "unreachable def is not imported/retained");
  assert.deepEqual(
    inlined.$defs?.TreeNode?.properties?.tags,
    { type: "array", items: {} },
    "imported bare array receives items: {}"
  );

  const lintReport = lintMcpToolSchemas([
    {
      name: "render_tree_probe",
      description: "Live recursive tree probe",
      inputSchema: inlined
    }
  ]);
  assert.equal(
    lintReport.ok,
    true,
    `unfolded tree schema must pass all 6 host profiles: ${JSON.stringify(lintReport.violations)}`
  );

  const validate = compileStandalone(inlined);

  // Depth 0 valid & invalid
  assert.equal(validate({ tree: { label: "root", tags: ["a", 1] } }), true);
  assert.equal(validate({ tree: { label: 42 } }), false);

  // Depth 1 valid & invalid
  assert.equal(validate({ tree: { label: "root", children: [{ label: "c1" }] } }), true);
  assert.equal(validate({ tree: { label: "root", children: [{ label: 99 }] } }), false);

  // Depth 2 valid & invalid
  assert.equal(
    validate({
      tree: {
        label: "root",
        children: [{ label: "c1", children: [{ label: "c2" }] }]
      }
    }),
    true
  );
  assert.equal(
    validate({
      tree: {
        label: "root",
        children: [{ label: "c1", children: [{ label: 123 }] }]
      }
    }),
    false
  );
});

test("T4.4: isolated h2a mcp-serve --host muse wire schemas and real muse binary (when installed) load without recursive JSON schema errors", () => {
  const h2aBin = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
  assert.ok(existsSync(h2aBin), `built h2a bin must exist at ${h2aBin}`);

  const workDir = mkdtempSync(join(tmpdir(), "h2a-l4-t44-muse-"));
  try {
    const configDir = join(workDir, ".config", "muse");
    const stateDir = join(workDir, ".local", "state");
    const runtimeDir = join(workDir, "run");
    const storeDir = join(workDir, "store");

    mkdirSync(configDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });

    const env = {
      ...process.env,
      HOME: workDir,
      XDG_CONFIG_HOME: join(workDir, ".config"),
      XDG_STATE_HOME: stateDir,
      XDG_RUNTIME_DIR: runtimeDir,
      H2A_ROOT: storeDir,
      H2A_MCP_MODE: "direct",
      TMPDIR: tmpdir()
    };

    // Always verify the built CLI binary wire `tools/list` for `--host muse` in isolated HOME.
    const wireInput = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "muse-wire-probe", version: "1.0.0" }
        }
      }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    ].join("\n") + "\n";

    const wireRes = spawnSync(
      process.execPath,
      [h2aBin, "mcp-serve", "--host", "muse", "--root", storeDir],
      { env, input: wireInput, encoding: "utf8", timeout: 20_000 }
    );
    assert.equal(
      wireRes.status,
      0,
      `h2a mcp-serve --host muse exited ${wireRes.status}: ${wireRes.stderr ?? ""}`
    );
    const wireMessages = (wireRes.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    const listMsg = wireMessages.find((msg) => msg.id === 2);
    assert.ok(listMsg?.result?.tools?.length === 73, `expected 73 tools from --host muse, got ${listMsg?.result?.tools?.length}`);
    const museWireReport = lintMcpToolSchemas(listMsg.result.tools, { profiles: ["muse"] });
    assert.equal(
      museWireReport.ok,
      true,
      `--host muse wire tools/list failed muse profile: ${JSON.stringify(museWireReport.violations)}`
    );

    // When ~/.local/bin/muse is present on the host, also run the real Muse binary in isolated HOME.
    const museBin = process.env.H2A_TEST_MUSE_BIN || join(homedir(), ".local", "bin", "muse");
    if (!existsSync(museBin)) return;

    const spawnedLog = join(workDir, "spawned.log");
    const wrapperPath = join(workDir, "mcp-wrapper.mjs");

    // Thin Node wrapper records spawn + delegates stdio verbatim to built h2a bin.
    writeFileSync(
      wrapperPath,
      [
        `import { appendFileSync } from "node:fs";`,
        `import { spawn } from "node:child_process";`,
        `appendFileSync(${JSON.stringify(spawnedLog)}, "spawned\\n");`,
        `const child = spawn(process.execPath, process.argv.slice(2), { stdio: "inherit", env: process.env });`,
        `child.on("exit", (code, sig) => { process.exit(code ?? (sig ? 1 : 0)); });`
      ].join("\n"),
      "utf8"
    );

    const settings = {
      schema_version: 1,
      mcpServers: {
        h2a: {
          command: process.execPath,
          args: [wrapperPath, h2aBin, "mcp-serve", "--host", "muse", "--root", storeDir],
          env: {
            H2A_MCP_MODE: "direct",
            H2A_ROOT: storeDir,
            TMPDIR: tmpdir()
          }
        }
      }
    };
    writeFileSync(join(configDir, "settings.json"), JSON.stringify(settings, null, 2), "utf8");

    const res = spawnSync(
      museBin,
      ["exec", "--provider", "echo", "--trust-workspace", "--workspace", workDir, "ping"],
      { env, encoding: "utf8", timeout: 30_000 }
    );

    const combined = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    assert.equal(
      res.status,
      0,
      `muse exec exited with ${res.status} (signal ${res.signal}): ${combined}`
    );
    assert.ok(
      !combined.includes("Recursive JSON schemas are not currently supported"),
      `muse reported recursive JSON schema error: ${combined}`
    );
    assert.ok(
      existsSync(spawnedLog) && readFileSync(spawnedLog, "utf8").includes("spawned"),
      "muse must actually spawn the configured h2a mcp-serve --host muse server"
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
