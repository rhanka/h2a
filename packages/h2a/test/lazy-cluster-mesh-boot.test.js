import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const BIN = new URL("../dist/bin.js", import.meta.url);

function runLightCommand(loader, trace, args, input) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-loader", pathToFileURL(loader).href, fileURLToPath(BIN), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, H2A_IMPORT_TRACE: trace },
      input
    }
  );
}

test("light hook commands boot without resolving the cluster-mesh OUTER path", () => {
  const fixture = mkdtempSync(join(tmpdir(), "h2a-lazy-cluster-mesh-"));
  const loader = join(fixture, "reject-cluster-mesh.mjs");
  const trace = join(fixture, "imports.log");
  const root = join(fixture, "state");
  writeFileSync(
    loader,
    `import { appendFileSync } from "node:fs";

appendFileSync(process.env.H2A_IMPORT_TRACE, "");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@sentropic/cluster-mesh") {
    appendFileSync(process.env.H2A_IMPORT_TRACE, specifier + "\\n");
    const error = new Error(
      "Cannot find package '@sentropic/cluster-mesh' imported from " + context.parentURL
    );
    error.code = "ERR_MODULE_NOT_FOUND";
    throw error;
  }
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.includes("cluster-mesh-outer")) {
    appendFileSync(process.env.H2A_IMPORT_TRACE, resolved.url + "\\n");
  }
  return resolved;
}
`
  );

  try {
    const drumbeat = runLightCommand(loader, trace, [
      "drumbeat",
      "record",
      "--root",
      root,
      "--instance",
      "codex:lazy-import-test",
      "--status",
      "done"
    ]);
    const receive = runLightCommand(
      loader,
      trace,
      [
        "drive",
        "receive",
        "--root",
        root,
        "--to",
        "codex:lazy-import-test",
        "--stdin",
        "--ignore-non-drive"
      ],
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "ordinary prompt" })
    );
    const evidence = JSON.stringify(
      {
        drumbeat: { status: drumbeat.status, stderr: drumbeat.stderr },
        receive: { status: receive.status, stderr: receive.stderr }
      },
      null,
      2
    );

    assert.deepEqual([drumbeat.status, receive.status], [0, 0], evidence);
    const mcp = runLightCommand(loader, trace,
      ["mcp-serve", "--root", root, "--auto-open", "--host", "claude"],
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) + "\n");
    assert.equal(mcp.status, 0, mcp.stderr);
    assert.match(mcp.stdout, /serverInfo/);
    assert.doesNotMatch(
      readFileSync(trace, "utf8"),
      /cluster-mesh-outer|@sentropic\/cluster-mesh/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
