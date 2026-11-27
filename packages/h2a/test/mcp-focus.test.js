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
  const tmpBase = join(realpathSync(process.cwd()), "tmp");
  mkdirSync(tmpBase, { recursive: true });
  const fixtureParent = mkdtempSync(join(tmpBase, ".h2a-focus-mcp-test-"));
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
  const tmpBase = join(realpathSync(process.cwd()), "tmp");
  mkdirSync(tmpBase, { recursive: true });
  const fixtureParent = mkdtempSync(join(tmpBase, ".h2a-focus-mcp-test-"));
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
  for (const command of [
    "h2a focus build dossier.json -o dossier.html",
    "h2a focus template -o dossier.json",
    "h2a focus check dossier.json"
  ]) {
    const r = spawnSync(process.execPath, [DENY_HOOK], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: "utf8"
    });
    assert.equal(r.status, 2, command);
    assert.match(r.stderr, /Blocked manual `h2a` CLI use/);
  }
});

test("FA-H1: h2a_focus_check descriptor, identity-independence, R2-R6/bounds, path policy and zero mutation", async () => {
  const { createHash } = await import("node:crypto");
  const { readdirSync } = await import("node:fs");
  const { buildFocusArtifactManifest } = await import("@sentropic/focus/artifact");

  await withWorkspaceAsync(async ({ workspaceRoot, workspace, outsideDir, storeRoot }) => {
    const pendingIdentity = {
      status: () => ({ state: "identity_pending", attemptId: "att-1", elapsedMs: 10, timeoutMs: 20_000 }),
      start: () => {},
      cancel: () => {},
      retry: () => false
    };
    const server = createMcpServer({ root: storeRoot, workspaceRoot, identity: pendingIdentity });
    const tools = server.listTools();
    const checkDesc = tools.find((t) => t.name === "h2a_focus_check");
    assert.ok(checkDesc, "h2a_focus_check must be listed");
    assert.equal(checkDesc.inputSchema.additionalProperties, false);
    assert.deepEqual(checkDesc.inputSchema.required, ["input"]);
    assert.equal(checkDesc.inputSchema.properties.input.type, "string");
    assert.equal(checkDesc.inputSchema.properties.previousManifest.type, "string");

    const doc = readFixture("dossier.template.json");
    const input = join(workspace, "dossier.json");
    const output = join(workspace, "dossier.html");
    const raw = JSON.stringify(doc, null, 2);
    writeFileSync(input, raw, "utf8");
    const beforeFiles = readdirSync(workspace).sort();

    // Valid check without previousManifest, available while identity_pending, zero mutation.
    const okRes = await server.callTool("h2a_focus_check", { input });
    assert.equal(okRes.ok, true, JSON.stringify(okRes));
    assert.match(okRes.documentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(okRes.bindingName, `focus:${doc.ref}`);
    assert.equal(okRes.revisionSeq, 1);
    assert.deepEqual(okRes.retiredRefs, []);
    assert.deepEqual(readdirSync(workspace).sort(), beforeFiles);
    assert.equal(readFileSync(input, "utf8"), raw);

    // Build embeds the exact same un-enriched canonical documentDigest.
    const buildRes = await server.callTool("h2a_focus_build", { input, output });
    assert.equal(buildRes.ok, true, JSON.stringify(buildRes));
    const embedded = JSON.parse(
      readFileSync(output, "utf8").match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1]
    );
    assert.equal(embedded.build.documentDigest, okRes.documentDigest);
    const intactHtml = readFileSync(output, "utf8");

    // R5 & R6 refused identically by check and build (preserving prior HTML).
    const badR6 = structuredClone(doc);
    badR6.sections[0].id = badR6.ref;
    const badR6Path = join(workspace, "bad-r6.json");
    writeFileSync(badR6Path, JSON.stringify(badR6), "utf8");
    const cR6 = await server.callTool("h2a_focus_check", { input: badR6Path });
    assert.equal(cR6.ok, false);
    assert.ok(cR6.refusals.some((r) => r.code === "focus-anchor-equals-document-ref" && r.path === "$.sections[0].id"));
    const bR6 = await server.callTool("h2a_focus_build", { input: badR6Path, output });
    assert.equal(bR6.ok, false);
    assert.ok(bR6.refusals.some((r) => r.code === "focus-anchor-equals-document-ref" && r.path === "$.sections[0].id"));
    assert.equal(readFileSync(output, "utf8"), intactHtml);

    // Oversized canonical dossier (> 1 048 576 bytes) refused by h2a_focus_check.
    const huge = readFixture("dossier.evidence.template.json");
    const blob = Buffer.alloc(790_000, 0x61);
    huge.sources.push({
      id: "huge-blob",
      title: "Volume excessif",
      origin: { uri: "urn:fixture:huge" },
      mediaType: "text/plain",
      encoding: "base64",
      data: blob.toString("base64"),
      sha256: createHash("sha256").update(blob).digest("hex"),
      size: blob.byteLength
    });
    const hugePath = join(workspace, "huge.json");
    writeFileSync(hugePath, JSON.stringify(huge), "utf8");
    const cHuge = await server.callTool("h2a_focus_check", { input: hugePath });
    assert.equal(cHuge.ok, false);
    assert.ok(cHuge.refusals.some((r) => r.code === "focus-document-too-large" && r.path === "$"));

    // R3 & R4 with previousManifest.
    const manifest1 = buildFocusArtifactManifest({
      document: doc,
      renderer: { name: "@sentropic/design-system-elements", version: "0.3.0", entry: "renderer/dossier.js", digest: `sha256:${"a".repeat(64)}`, files: [], capabilities: [] },
      validator: { name: "@sentropic/focus", version: "0.6.1", digest: `sha256:${"b".repeat(64)}` },
      generator: { name: "@sentropic/h2a", version: "0.98.11" },
      createdAt: "2026-11-20T00:00:00Z"
    });
    const rev2 = structuredClone(doc);
    rev2.sections = rev2.sections.filter((s) => s.id !== "rationale");
    const manifest2 = buildFocusArtifactManifest({
      document: rev2,
      renderer: manifest1.renderer,
      validator: manifest1.validator,
      generator: manifest1.generator,
      previousManifest: manifest1,
      createdAt: "2026-11-20T01:00:00Z"
    });
    const m2Path = join(workspace, "prev-manifest.json");
    writeFileSync(m2Path, JSON.stringify(manifest2), "utf8");
    const cR4 = await server.callTool("h2a_focus_check", { input, previousManifest: m2Path });
    assert.equal(cR4.ok, false);
    assert.ok(cR4.refusals.some((r) => r.code === "focus-anchor-reused" && r.path === "$.sections[4].id"));

    // Path policy: outside workspace refused for both input and previousManifest.
    const outsideManifest = join(outsideDir, "outside-manifest.json");
    writeFileSync(outsideManifest, JSON.stringify(manifest2), "utf8");
    const escManifest = await server.callTool("h2a_focus_check", { input, previousManifest: outsideManifest });
    assert.equal(escManifest.ok, false);
    assert.match(escManifest.error, /within the MCP startup workspace/i);
  });
});

test("h2a_focus_build returns linear_chain_as_architecture_cards warnings on architecture chains and [] on workflows", async () => {
  await withWorkspaceAsync(async ({ workspaceRoot, workspace, storeRoot }) => {
    const server = createMcpServer({ root: storeRoot, workspaceRoot });
    const base = readFixture("dossier.template.json");
    const chainSource = [
      "flowchart LR",
      's1["Réception"]',
      's2["Tri"]',
      's3["Revue"]',
      's4["Validation"]',
      "s1 -->|brut| s2",
      "s2 -->|qualifié| s3",
      "s3 -->|validé| s4"
    ].join("\n");

    const wfDoc = structuredClone(base);
    wfDoc.sections.find((s) => s.kind === "diagram").source = chainSource;
    const wfInput = join(workspace, "workflow.json");
    const wfOutput = join(workspace, "workflow.html");
    writeFileSync(wfInput, JSON.stringify(wfDoc), "utf8");
    const wfRes = await server.callTool("h2a_focus_build", { input: wfInput, output: wfOutput });
    assert.equal(wfRes.ok, true, JSON.stringify(wfRes));
    assert.deepEqual(wfRes.warnings, []);

    const archDoc = structuredClone(base);
    Object.assign(archDoc.sections.find((s) => s.kind === "diagram"), {
      source: chainSource,
      diagramType: "architecture"
    });
    const archInput = join(workspace, "arch-chain.json");
    const archOutput = join(workspace, "arch-chain.html");
    writeFileSync(archInput, JSON.stringify(archDoc), "utf8");
    const archRes = await server.callTool("h2a_focus_build", { input: archInput, output: archOutput });
    assert.equal(archRes.ok, true, JSON.stringify(archRes));
    assert.deepEqual(archRes.warnings, [
      'linear_chain_as_architecture_cards: ecosystem (4 nodes, 0 containers) — set diagramType "workflow" if this describes a process'
    ]);

    const refusedDoc = structuredClone(base);
    refusedDoc.sections.find((s) => s.kind === "diagram").scene = {
      documentId: "document:assoc-refusal",
      schemaVersion: { major: 1, minor: 1 },
      revision: 0,
      profileRefs: ["generic@1"],
      typeDefinitions: {},
      entities: {
        "entity:a": { id: "entity:a", profile: "generic@1", type: "node", attributes: { name: { kind: "text", value: "Service A" } } },
        "entity:b": { id: "entity:b", profile: "generic@1", type: "node", attributes: { name: { kind: "text", value: "Service B" } } }
      },
      relations: {
        "relation:a.b": {
          id: "relation:a.b",
          profile: "generic@1",
          type: "association",
          endpoints: [{ role: "member", target: "entity:a" }, { role: "member", target: "entity:b" }],
          attributes: { label: { kind: "text", value: "relates" } }
        }
      },
      ports: {},
      resources: {},
      extensions: []
    };
    const refusedInput = join(workspace, "refused-layout.json");
    const refusedOutput = join(workspace, "refused-layout.html");
    writeFileSync(refusedInput, JSON.stringify(refusedDoc), "utf8");
    const refusedRes = await server.callTool("h2a_focus_build", { input: refusedInput, output: refusedOutput });
    assert.equal(refusedRes.ok, false);
    assert.ok(
      refusedRes.refusals.some((r) => r.code === "relation-type-unsupported" && r.sectionId === "ecosystem"),
      `Expected structured relation-type-unsupported refusal, got: ${JSON.stringify(refusedRes)}`
    );
    assert.equal(existsSync(refusedOutput), false);
  });
});
