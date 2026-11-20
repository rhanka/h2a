import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateDecisionDossierForPresentation } from "@sentropic/focus/validate";

import {
  createMcpServer,
  handleH2aFocusBuild,
  handleH2aFocusTemplate,
  runMcpStdio,
  validateFocusBuildRequest
} from "../dist/index.js";

const KIT_DIR = fileURLToPath(new URL("../focus-kit/", import.meta.url));
const DENY_HOOK = fileURLToPath(new URL("../hooks/deny-manual-h2a-cli.mjs", import.meta.url));

function readFixture(name) {
  return JSON.parse(readFileSync(join(KIT_DIR, name), "utf8"));
}

function withWorkspace(fn) {
  const fixtureParent = mkdtempSync(join(realpathSync(process.cwd()), ".h2a-focus-mcp-test-"));
  const workspaceRoot = join(fixtureParent, "workspace");
  const outsideDir = join(fixtureParent, "outside");
  const storeRoot = join(fixtureParent, "store");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  mkdirSync(storeRoot, { recursive: true });
  try {
    return fn({ workspaceRoot, workspace: workspaceRoot, outsideDir, storeRoot });
  } finally {
    rmSync(fixtureParent, { recursive: true, force: true });
  }
}

async function withWorkspaceAsync(fn) {
  const fixtureParent = mkdtempSync(join(realpathSync(process.cwd()), ".h2a-focus-mcp-test-"));
  const workspaceRoot = join(fixtureParent, "workspace");
  const outsideDir = join(fixtureParent, "outside");
  const storeRoot = join(fixtureParent, "store");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  mkdirSync(storeRoot, { recursive: true });
  try {
    return await fn({ workspaceRoot, workspace: workspaceRoot, outsideDir, storeRoot });
  } finally {
    rmSync(fixtureParent, { recursive: true, force: true });
  }
}

test("h2a_focus_build and h2a_focus_template descriptors are advertised with strict schemas", () => {
  withWorkspace(({ workspaceRoot, storeRoot }) => {
    const server = createMcpServer({ root: storeRoot, workspaceRoot });
    const tools = server.listTools();

    const buildDesc = tools.find((t) => t.name === "h2a_focus_build");
    assert.ok(buildDesc, "h2a_focus_build must be listed");
    assert.equal(buildDesc.inputSchema.additionalProperties, false);
    assert.deepEqual(buildDesc.inputSchema.required, ["input", "output"]);
    assert.equal(buildDesc.inputSchema.properties.input.type, "string");
    assert.equal(buildDesc.inputSchema.properties.output.type, "string");

    const tplDesc = tools.find((t) => t.name === "h2a_focus_template");
    assert.ok(tplDesc, "h2a_focus_template must be listed");
    assert.equal(tplDesc.inputSchema.additionalProperties, false);
    assert.deepEqual(tplDesc.inputSchema.properties.kind.enum, ["dossier", "evidence", "all"]);
  });
});

test("h2a_focus_template returns the exact shipped focus-kit templates and rejects invalid args", () => {
  const expectedDossier = readFixture("dossier.template.json");
  const expectedEvidence = readFixture("dossier.evidence.template.json");

  const allDefault = handleH2aFocusTemplate(undefined);
  assert.equal(allDefault.ok, true);
  assert.equal(allDefault.kind, "all");
  assert.deepEqual(allDefault.templates.dossier, expectedDossier);
  assert.deepEqual(allDefault.templates.evidence, expectedEvidence);
  assert.equal(allDefault.schemas.dossier, "focus-kit/dossier.schema.json");
  assert.equal(allDefault.schemas.evidence, "focus-kit/dossier.v2.schema.json");

  const dossierOnly = handleH2aFocusTemplate({ kind: "dossier" });
  assert.equal(dossierOnly.ok, true);
  assert.equal(dossierOnly.kind, "dossier");
  assert.deepEqual(dossierOnly.template, expectedDossier);

  const evidenceOnly = handleH2aFocusTemplate({ kind: "evidence" });
  assert.equal(evidenceOnly.ok, true);
  assert.equal(evidenceOnly.kind, "evidence");
  assert.deepEqual(evidenceOnly.template, expectedEvidence);

  const badKind = handleH2aFocusTemplate({ kind: "unknown" });
  assert.equal(badKind.ok, false);
  assert.match(badKind.error, /dossier\|evidence\|all/);

  const unknownField = handleH2aFocusTemplate({ kind: "dossier", extra: true });
  assert.equal(unknownField.ok, false);
  assert.match(unknownField.error, /unknown field/i);
});

test("h2a_focus_build compiles v1 and v2 fixture dossiers in-process with exact bytes and valid HTML", async () => {
  await withWorkspaceAsync(async ({ workspaceRoot, workspace, storeRoot }) => {
    const server = createMcpServer({ root: storeRoot, workspaceRoot });

    for (const [label, fixtureName] of [
      ["v1", "dossier.template.json"],
      ["v2-evidence", "dossier.evidence.template.json"]
    ]) {
      const input = join(workspace, `${label}.json`);
      const output = join(workspace, `${label}.html`);
      writeFileSync(input, JSON.stringify(readFixture(fixtureName)), "utf8");

      const result = await server.callTool("h2a_focus_build", { input, output });
      assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
      assert.equal(result.output, realpathSync(output));
      assert.deepEqual(result.warnings, []);

      const html = readFileSync(output, "utf8");
      assert.equal(result.bytes, Buffer.byteLength(html, "utf8"));
      assert.match(html, /<title>Décision dossiers — format de présentation<\/title>/);
      const match = html.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/);
      assert.ok(match, "embedded focus payload script present");
      const embedded = JSON.parse(match[1]);
      assert.equal(validateDecisionDossierForPresentation(embedded.document).ok, true);
    }
  });
});

test("h2a_focus_build returns all builder refusal messages verbatim and preserves prior HTML", async () => {
  await withWorkspaceAsync(async ({ workspaceRoot, workspace, storeRoot }) => {
    const server = createMcpServer({ root: storeRoot, workspaceRoot });

    const badDoc = readFixture("dossier.template.json");
    delete badDoc.readability;
    badDoc.title = "Apply L06b under MH-L3";

    const input = join(workspace, "bad.json");
    const output = join(workspace, "existing.html");
    writeFileSync(input, JSON.stringify(badDoc), "utf8");
    writeFileSync(output, "<!-- previous intact revision -->", "utf8");

    const result = await server.callTool("h2a_focus_build", { input, output });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
    assert.match(result.error, /invalid DecisionDossierDocument:/);
    assert.match(result.error, /missing_owner_request/);
    assert.match(result.error, /undefined_code/);
    assert.ok(Array.isArray(result.refusals) && result.refusals.length >= 2);
    assert.ok(result.refusals.some((r) => r.code === "missing_owner_request"));
    assert.ok(result.refusals.some((r) => r.code === "undefined_code"));
    for (const r of result.refusals) {
      assert.ok(result.error.includes(r.message), `verbatim refusal present: ${r.message}`);
    }
    // Previous HTML file must remain untouched byte-for-byte.
    assert.equal(readFileSync(output, "utf8"), "<!-- previous intact revision -->");

    // Diagram refusal (unknown ecosystem scene) also surfaces verbatim.
    const badScene = readFixture("dossier.template.json");
    badScene.sections.find((s) => s.kind === "diagram").source = "ecosystem:nonexistent";
    const sceneInput = join(workspace, "bad-scene.json");
    const sceneOutput = join(workspace, "never-created.html");
    writeFileSync(sceneInput, JSON.stringify(badScene), "utf8");
    const sceneRes = await server.callTool("h2a_focus_build", { input: sceneInput, output: sceneOutput });
    assert.equal(sceneRes.ok, false);
    assert.match(sceneRes.error, /Unknown ecosystem scene: nonexistent/);
    assert.equal(existsSync(sceneOutput), false);
  });
});

test("h2a_focus_build path policy enforces workspace containment, refuses /tmp, symlinks out, and non-.html targets", async () => {
  await withWorkspaceAsync(async ({ workspaceRoot, workspace, outsideDir }) => {
    const validInput = join(workspace, "dossier.json");
    const validOutput = join(workspace, "dossier.html");
    writeFileSync(validInput, JSON.stringify(readFixture("dossier.template.json")), "utf8");

    // 1. Relative paths refused.
    assert.throws(
      () => validateFocusBuildRequest({ input: "dossier.json", output: validOutput }, workspaceRoot),
      /must be an absolute path/i
    );
    assert.throws(
      () => validateFocusBuildRequest({ input: validInput, output: "dossier.html" }, workspaceRoot),
      /must be an absolute path/i
    );

    // 2. Non-.html outputs refused (never overwrite non-.html files).
    const nonHtmlFile = join(workspace, "keep.txt");
    writeFileSync(nonHtmlFile, "precious text", "utf8");
    for (const badOut of [
      nonHtmlFile,
      join(workspace, "out.json"),
      join(workspace, "out.htm"),
      join(workspace, "out"),
      join(workspace, ".html"),
      `${validOutput}/`
    ]) {
      const res = await handleH2aFocusBuild({ input: validInput, output: badOut }, workspaceRoot);
      assert.equal(res.ok, false, `must refuse non-.html output ${badOut}`);
      assert.match(res.error, /\.html/i);
    }
    assert.equal(readFileSync(nonHtmlFile, "utf8"), "precious text");

    // 3. Outside workspace refused (sibling directory and .. traversal).
    const outsideInput = join(outsideDir, "outside.json");
    const outsideOutput = join(outsideDir, "outside.html");
    writeFileSync(outsideInput, JSON.stringify(readFixture("dossier.template.json")), "utf8");

    const resOutsideIn = await handleH2aFocusBuild({ input: outsideInput, output: validOutput }, workspaceRoot);
    assert.equal(resOutsideIn.ok, false);
    assert.match(resOutsideIn.error, /within the MCP startup workspace/i);

    const resOutsideOut = await handleH2aFocusBuild({ input: validInput, output: outsideOutput }, workspaceRoot);
    assert.equal(resOutsideOut.ok, false);
    assert.match(resOutsideOut.error, /within the MCP startup workspace/i);
    assert.equal(existsSync(outsideOutput), false);

    const resTraversal = await handleH2aFocusBuild(
      { input: validInput, output: join(workspace, "..", "outside", "traversal.html") },
      workspaceRoot
    );
    assert.equal(resTraversal.ok, false);
    assert.match(resTraversal.error, /within the MCP startup workspace/i);

    // 4. OS temporary directory / /tmp refused even if workspaceRoot itself is in temp.
    const tempDir = mkdtempSync(join(tmpdir(), "h2a-focus-tmp-refuse-"));
    try {
      const tempIn = join(tempDir, "in.json");
      const tempOut = join(tempDir, "out.html");
      writeFileSync(tempIn, JSON.stringify(readFixture("dossier.template.json")), "utf8");
      const resTmpRoot = await handleH2aFocusBuild({ input: tempIn, output: tempOut }, tempDir);
      assert.equal(resTmpRoot.ok, false);
      assert.match(resTmpRoot.error, /temporary directory|\/tmp/i);
      assert.equal(existsSync(tempOut), false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (process.platform !== "win32") {
      const resSlashTmp = await handleH2aFocusBuild(
        { input: validInput, output: "/tmp/h2a-must-never-write.html" },
        workspaceRoot
      );
      assert.equal(resSlashTmp.ok, false);
      assert.match(resSlashTmp.error, /within the MCP startup workspace|temporary directory|\/tmp/i);
    }

    // 5. Symlink input inside workspace pointing outside workspace refused.
    const escapedInputLink = join(workspace, "escape-in.json");
    symlinkSync(outsideInput, escapedInputLink);
    const resSymIn = await handleH2aFocusBuild({ input: escapedInputLink, output: validOutput }, workspaceRoot);
    assert.equal(resSymIn.ok, false);
    assert.match(resSymIn.error, /symbolic link|within the MCP startup workspace/i);

    // 6. Symlink directory inside workspace pointing outside workspace refused for output.
    const escapedDirLink = join(workspace, "escape-dir");
    symlinkSync(outsideDir, escapedDirLink);
    const resSymDirOut = await handleH2aFocusBuild(
      { input: validInput, output: join(escapedDirLink, "escaped.html") },
      workspaceRoot
    );
    assert.equal(resSymDirOut.ok, false);
    assert.match(resSymDirOut.error, /symbolic link|within the MCP startup workspace/i);
    assert.equal(existsSync(join(outsideDir, "escaped.html")), false);

    // 7. Output that is itself a symlink (even pointing to a non-.html file inside workspace) refused.
    const symOutToTxt = join(workspace, "sneaky.html");
    symlinkSync(nonHtmlFile, symOutToTxt);
    const resSymOut = await handleH2aFocusBuild({ input: validInput, output: symOutToTxt }, workspaceRoot);
    assert.equal(resSymOut.ok, false);
    assert.match(resSymOut.error, /symbolic link/i);
    assert.equal(readFileSync(nonHtmlFile, "utf8"), "precious text");

    // 8. Output equal to input refused (even if input ends with .html).
    const sameHtml = join(workspace, "same.html");
    writeFileSync(sameHtml, JSON.stringify(readFixture("dossier.template.json")), "utf8");
    const resSame = await handleH2aFocusBuild({ input: sameHtml, output: sameHtml }, workspaceRoot);
    assert.equal(resSame.ok, false);
    assert.match(resSame.error, /Output must differ from the input dossier/);

    // 9. Unknown fields refused.
    const resUnknown = await handleH2aFocusBuild(
      { input: validInput, output: validOutput, force: true },
      workspaceRoot
    );
    assert.equal(resUnknown.ok, false);
    assert.match(resUnknown.error, /unknown field/i);
  });
});

test("h2a_focus_build and h2a_focus_template stay available while MCP identity is identity_pending", async () => {
  await withWorkspaceAsync(async ({ workspaceRoot, workspace, storeRoot }) => {
    const pendingIdentity = {
      status: () => ({ state: "identity_pending", attemptId: "att-1", elapsedMs: 10, timeoutMs: 20_000 }),
      start: () => {},
      cancel: () => {},
      retry: () => false
    };
    const server = createMcpServer({ root: storeRoot, workspaceRoot, identity: pendingIdentity });
    const tpl = server.callTool("h2a_focus_template", { kind: "dossier" });
    assert.equal(tpl.ok, true);

    const input = join(workspace, "pending.json");
    const output = join(workspace, "pending.html");
    writeFileSync(input, JSON.stringify(readFixture("dossier.template.json")), "utf8");
    const built = await server.callTool("h2a_focus_build", { input, output });
    assert.equal(built.ok, true);
    assert.equal(existsSync(output), true);
  });
});

test("MCP stdio integration: tools/list advertises Focus tools, template & build succeed, invalid dossier and outside path refuse", async () => {
  await withWorkspaceAsync(async ({ workspaceRoot, workspace, outsideDir, storeRoot }) => {
    const validInput = join(workspace, "fixture.json");
    const validOutput = join(workspace, "fixture.html");
    writeFileSync(validInput, JSON.stringify(readFixture("dossier.template.json")), "utf8");

    const invalidDoc = readFixture("dossier.template.json");
    delete invalidDoc.readability;
    invalidDoc.title = "Apply L06b under MH-L3";
    const invalidInput = join(workspace, "invalid.json");
    const invalidOutput = join(workspace, "invalid.html");
    writeFileSync(invalidInput, JSON.stringify(invalidDoc), "utf8");

    const outsideOutput = join(outsideDir, "escaped.html");

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let rawOut = "";
    stdout.on("data", (chunk) => {
      rawOut += chunk.toString("utf8");
    });

    const done = runMcpStdio({
      root: storeRoot,
      workspaceRoot,
      stdin,
      stdout,
      stderr
    });

    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "h2a_focus_template", arguments: { kind: "dossier" } }
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "h2a_focus_build", arguments: { input: validInput, output: validOutput } }
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "h2a_focus_build", arguments: { input: invalidInput, output: invalidOutput } }
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "h2a_focus_build", arguments: { input: validInput, output: outsideOutput } }
      }
    ];
    stdin.end(`${requests.map((r) => JSON.stringify(r)).join("\n")}\n`);
    await done;

    const byId = new Map(
      rawOut
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((msg) => [msg.id, msg])
    );

    // tools/list contains both Focus tools.
    const listedNames = byId.get(2).result.tools.map((t) => t.name);
    assert.ok(listedNames.includes("h2a_focus_build"), "tools/list must include h2a_focus_build");
    assert.ok(listedNames.includes("h2a_focus_template"), "tools/list must include h2a_focus_template");

    // h2a_focus_template over stdio succeeds.
    const tplResp = byId.get(3).result;
    assert.equal(tplResp.isError, false);
    const tplPayload = JSON.parse(tplResp.content[0].text);
    assert.equal(tplPayload.ok, true);
    assert.deepEqual(tplPayload.template, readFixture("dossier.template.json"));

    // h2a_focus_build of valid fixture succeeds.
    const okResp = byId.get(4).result;
    assert.equal(okResp.isError, false);
    const okPayload = JSON.parse(okResp.content[0].text);
    assert.equal(okPayload.ok, true);
    assert.equal(okPayload.output, realpathSync(validOutput));
    assert.equal(okPayload.bytes, Buffer.byteLength(readFileSync(validOutput, "utf8"), "utf8"));
    assert.deepEqual(okPayload.warnings, []);

    // h2a_focus_build of invalid dossier returns builder refusals verbatim.
    const badResp = byId.get(5).result;
    assert.equal(badResp.isError, true);
    const badPayload = JSON.parse(badResp.content[0].text);
    assert.equal(badPayload.ok, false);
    assert.match(badPayload.error, /missing_owner_request/);
    assert.match(badPayload.error, /undefined_code/);
    assert.ok(badPayload.refusals.some((r) => r.code === "missing_owner_request"));
    assert.ok(badPayload.refusals.some((r) => r.code === "undefined_code"));
    assert.equal(existsSync(invalidOutput), false);

    // h2a_focus_build with output outside workspace is refused.
    const escResp = byId.get(6).result;
    assert.equal(escResp.isError, true);
    const escPayload = JSON.parse(escResp.content[0].text);
    assert.equal(escPayload.ok, false);
    assert.match(escPayload.error, /within the MCP startup workspace/i);
    assert.equal(existsSync(outsideOutput), false);
  });
});

test("deny-manual-h2a-cli.mjs hook remains intact and still blocks `h2a focus build` from Bash", () => {
  for (const command of ["h2a focus build dossier.json -o dossier.html", "h2a focus template -o dossier.json"]) {
    const r = spawnSync(process.execPath, [DENY_HOOK], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: "utf8"
    });
    assert.equal(r.status, 2, command);
    assert.match(r.stderr, /Blocked manual `h2a` CLI use/);
  }
});
