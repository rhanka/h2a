#!/usr/bin/env node
/**
 * CI & local guard: validates 100% of exported MCP tool schemas and ui-render
 * `get_schema` outputs against the 6 qualified CLI host profiles (`claude`,
 * `codex`, `gemini`, `vibe`, `agy`, `muse`) plus standalone Ajv 2020-12
 * compilation.
 *
 * Loads EXCLUSIVELY built artifacts under `packages/h2a/dist/` and
 * `packages/track/dist/` (pattern of `scripts/check-public-contract.sh`).
 * Exits 1 if `dist/` is missing or on any schema violation.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const H2A_DIST = join(ROOT, "packages/h2a/dist/index.js");
const H2A_EMBEDDED_DIST = join(ROOT, "packages/h2a/dist/runtime/mcp-central-descriptor.js");
const TRACK_MCP_DIST = join(ROOT, "packages/track/dist/mcp/serve.js");

const requiredArtifacts = [H2A_DIST, H2A_EMBEDDED_DIST, TRACK_MCP_DIST];
for (const artifact of requiredArtifacts) {
  if (!existsSync(artifact)) {
    console.error(`✗ build local absent (${artifact}); run npm run build`);
    process.exit(1);
  }
}

const require = createRequire(H2A_DIST);
const { Ajv2020 } = require("ajv/dist/2020.js");

const h2a = await import(pathToFileURL(H2A_DIST).href);
const { embeddedTools } = await import(pathToFileURL(H2A_EMBEDDED_DIST).href);
const { TRACK_READ_TOOL_DESCRIPTORS } = await import(pathToFileURL(TRACK_MCP_DIST).href);

const {
  createMcpServer,
  createUiRenderModule,
  lintMcpToolSchemas,
  MCP_HOST_SCHEMA_PROFILES
} = h2a;

const tempRoot = mkdtempSync(join(tmpdir(), "h2a-check-mcp-schemas-"));
let failed = false;

try {
  const uiRender = createUiRenderModule();
  const server = createMcpServer({ root: tempRoot, storeInitialize: false, uiRender });
  const serverTools = server.listTools();

  const getSchemaDescriptors = [];
  for (const component of Object.keys(uiRender.assets.schemas).sort()) {
    const res = uiRender.tools.callTool("get_schema", { component });
    if (!res || res.isError || !res.structuredContent?.schema) {
      console.error(`✗ get_schema(${component}) failed or returned no schema`);
      failed = true;
      continue;
    }
    getSchemaDescriptors.push({
      name: `get_schema_${component}`,
      description: `Standalone JSON Schema returned by get_schema(${component}).`,
      inputSchema: res.structuredContent.schema
    });
  }

  const suites = [
    { label: "createMcpServer(uiRender).listTools()", tools: serverTools },
    { label: "uiRender.get_schema(*)", tools: getSchemaDescriptors },
    { label: "embeddedTools (mcp-central-descriptor)", tools: embeddedTools },
    { label: "TRACK_READ_TOOL_DESCRIPTORS (@sentropic/track/mcp)", tools: TRACK_READ_TOOL_DESCRIPTORS }
  ];

  let overallMaxBytes = 0;
  for (const suite of suites) {
    const report = lintMcpToolSchemas(suite.tools);
    if (report.maxBytes > overallMaxBytes) overallMaxBytes = report.maxBytes;

    // Compile every schema in a fresh standalone Ajv2020 instance (zero external schemas).
    const ajvErrors = [];
    for (const tool of suite.tools) {
      try {
        const ajv = new Ajv2020({ allErrors: true, strict: false });
        ajv.compile(tool.inputSchema);
      } catch (err) {
        ajvErrors.push({
          tool: tool.name,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }

    if (!report.ok || ajvErrors.length > 0) {
      failed = true;
      console.error(
        `✗ ${suite.label}: ${report.violations.length} lint violation(s), ${ajvErrors.length} Ajv compile error(s) across ${suite.tools.length} tool(s)`
      );
      for (const v of report.violations) {
        console.error(
          `  - [${v.rule}] (${v.profiles.join(",")}) ${v.tool}${v.path ? ` @ ${v.path}` : ""}: ${v.message}`
        );
      }
      for (const e of ajvErrors) {
        console.error(`  - [ajv2020] ${e.tool}: ${e.message}`);
      }
    } else {
      console.log(
        `✓ ${suite.label}: ${suite.tools.length} schema(s) OK across ${report.profiles.length} profiles (max ${report.maxBytes} B)`
      );
    }
  }

  const profileNames = Object.keys(MCP_HOST_SCHEMA_PROFILES);
  if (failed) {
    console.error(`MCP SCHEMAS CHECK FAILED (profiles: ${profileNames.join(", ")})`);
    process.exit(1);
  }
  console.log(
    `MCP SCHEMAS OK (${serverTools.length} tools + ${getSchemaDescriptors.length} get_schema, profiles: ${profileNames.join(", ")}, max: ${overallMaxBytes} B)`
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
