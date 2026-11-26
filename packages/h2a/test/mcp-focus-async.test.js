import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";

import { fileURLToPath } from "node:url";

import {
  validateFocusArtifactManifest,
  validateFocusViewsDocument
} from "@sentropic/focus/artifact";
import { writeAuth } from "../../h2a-runtime/dist/sentropic/auth-token.js";
import { serverKey } from "../../h2a-runtime/dist/sentropic/auth-token.js";
import { resolvePublishConfig } from "../../h2a-runtime/dist/sentropic/publish-config.js";
import {
  configAuthScope
} from "../../h2a-runtime/dist/sentropic/publish-config.js";

import {
  createFocusBuildManager,
  createMcpServer,
  handleH2aFocusBuild,
  startCentralMcpServer
} from "../dist/index.js";
import { authenticatedHttpRequest } from "../dist/runtime/handover/authenticated-http.js";
const CENTRAL_PING_PATH = "/_h2a-central/ping";
const TEMPLATE_PATH = fileURLToPath(new URL("../focus-kit/dossier.template.json", import.meta.url));

function withTempFixture(fn) {
  const base = join(realpathSync(process.cwd()), ".tmp-focus-async-tests");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const rootDir = mkdtempSync(join(base, "run-"));
  const workspace = join(rootDir, "workspace");
  const state = join(rootDir, "state");
  const runtimeBase = join(rootDir, "runtime");
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  return Promise.resolve()
    .then(() => fn({ rootDir, workspace, state, runtimeBase }))
    .finally(() => {
      rmSync(rootDir, { recursive: true, force: true });
      try {
        if (readdirSync(base).length === 0) rmSync(base, { recursive: true, force: true });
      } catch {
        /* ignore cleanup race */
      }
    });
}

function buildHeavyGenericScene(sceneIdx, nodeCount = 30, edgeCount = 45) {
  const entities = {};
  const relations = {};
  const textAttr = (value) => ({ kind: "text", value });

  const containerCount = 3;
  for (let i = 0; i < containerCount; i++) {
    const id = `entity:grp-${sceneIdx}-${i}`;
    entities[id] = {
      id,
      profile: "generic@1",
      type: "container",
      attributes: {
        name: textAttr(`Zone ${i + 1}`),
        kicker: textAttr(`Layer ${i + 1}`)
      }
    };
  }

  const leafCount = nodeCount - containerCount;
  for (let i = 0; i < leafCount; i++) {
    const grp = i % containerCount;
    const id = `entity:n-${sceneIdx}-${i}`;
    const parentId = `entity:grp-${sceneIdx}-${grp}`;
    entities[id] = {
      id,
      profile: "generic@1",
      type: "node",
      attributes: {
        name: textAttr(`Node ${sceneIdx + 1}.${i + 1}`),
        kicker: textAttr(`Tier ${grp + 1}`),
        description: textAttr(`Synthetic component ${i + 1}.`)
      }
    };
    const cid = `relation:contains-${sceneIdx}-${i}`;
    relations[cid] = {
      id: cid,
      profile: "generic@1",
      type: "contains",
      endpoints: [
        { role: "parent", target: parentId },
        { role: "child", target: id }
      ],
      attributes: {}
    };
  }

  const usedPairs = new Set();
  for (let i = 0; i < edgeCount; i++) {
    const srcIdx = i % leafCount;
    let dstIdx = (i + 1 + Math.floor(i / leafCount) * 4 + (i % 3)) % leafCount;
    if (dstIdx === srcIdx || usedPairs.has(`${srcIdx}->${dstIdx}`)) {
      dstIdx = (srcIdx + 7 + (i % 5)) % leafCount;
      while (dstIdx === srcIdx) dstIdx = (dstIdx + 1) % leafCount;
    }
    usedPairs.add(`${srcIdx}->${dstIdx}`);
    const eid = `relation:link-${sceneIdx}-${i}`;
    relations[eid] = {
      id: eid,
      profile: "generic@1",
      type: "link",
      endpoints: [
        { role: "source", target: `entity:n-${sceneIdx}-${srcIdx}` },
        { role: "target", target: `entity:n-${sceneIdx}-${dstIdx}` }
      ],
      attributes: i % 5 === 0 ? { label: textAttr(`flow ${i + 1}`) } : {}
    };
  }

  return {
    documentId: `document:scene-${sceneIdx}`,
    schemaVersion: { major: 1, minor: 1 },
    revision: 0,
    profileRefs: ["generic@1"],
    typeDefinitions: {},
    ports: {},
    resources: {},
    extensions: [],
    entities,
    relations
  };
}

function buildHeavyDossier({ sceneCount = 3, nodesPerScene = 30, edgesPerScene = 45, ref = "dec-heavy-async" } = {}) {
  const base = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const diagramSections = [];
  for (let s = 0; s < sceneCount; s++) {
    const scene = buildHeavyGenericScene(s, nodesPerScene, edgesPerScene);
    diagramSections.push({
      id: `diagram_${s}`,
      targetRef: `diagram_${s}`,
      kind: "diagram",
      diagramType: "architecture",
      syntax: "mermaid",
      source: "flowchart LR\n  A[Start] --> B[End]",
      scene,
      alt: `Synthetic architecture view ${s + 1} with ${nodesPerScene} entities and ${edgesPerScene} links.`
    });
  }

  return {
    ...base,
    ref,
    title: "Asynchronous Off-Loop Dossier Generation",
    subject: "Render dense architecture diagrams cleanly in dedicated worker processes.",
    sections: base.sections.flatMap((section) => (section.kind === "diagram" ? diagramSections : [section]))
  };
}

function makeFakeJwt(claims) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "EdDSA", typ: "JWT" })}.${b64(claims)}.sig-${randomUUID()}`;
}

async function startFakeSentropicMcpServer() {
  const calls = [];
  const artifacts = new Map();
  let releaseCounter = 0;

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const msg = bodyText ? JSON.parse(bodyText) : {};

    if (msg.method === "initialize") {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sentropic-test-sess" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fake-sentropic", version: "1.0.0" }
          }
        })
      );
      return;
    }

    if (msg.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }

    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      const workspaceRef = msg.params?.workspaceRef;
      calls.push({ name, args, workspaceRef });

      if (name === "artifacts_ensure") {
        const artifactId = `11111111-1111-4111-8111-${String(artifacts.size + 1).padStart(12, "0")}`;
        artifacts.set(artifactId, { bindingName: args.bindingName, workspaceRef, releases: [] });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ ok: true, output: { artifactId, created: true, replayed: false } })
                }
              ]
            }
          })
        );
        return;
      }

      if (name === "artifacts_publish") {
        releaseCounter++;
        const artifactId = args.artifactId;
        const releaseId = `22222222-2222-4222-8222-${String(releaseCounter).padStart(12, "0")}`;
        const record = artifacts.get(artifactId) ?? { releases: [] };
        record.releases.push({ releaseId, args, workspaceRef });
        artifacts.set(artifactId, record);

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    output: {
                      artifactId,
                      releaseId,
                      digest: `sha256:${"d".repeat(64)}`,
                      stableUrl: `https://artifacts.local.test/${artifactId}`,
                      versionUrl: `https://artifacts.local.test/${artifactId}/r/${releaseId}`
                    }
                  })
                }
              ]
            }
          })
        );
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    mcpUrl: `http://127.0.0.1:${address.port}/api/v1/mcp`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function parseEnvelopePayload(html) {
  const match = /<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/u.exec(html);
  assert.ok(match, "built HTML must embed <script type=\"application/json\" data-focus-document>");
  return JSON.parse(match[1]);
}

test("async build compiles heavy 3x30x45 generic@1 dossier via submit/result with zero card problems", async () => {
  await withTempFixture(async ({ workspace, state }) => {
    const input = join(workspace, "heavy-3x30x45.json");
    const output = join(workspace, "heavy-3x30x45.html");
    writeFileSync(input, JSON.stringify(buildHeavyDossier({ sceneCount: 3, nodesPerScene: 30, edgesPerScene: 45 })), "utf8");

    const server = createMcpServer({ root: state, workspaceRoot: workspace });
    try {
      const t0 = performance.now();
      const submitted = await server.callTool("h2a_focus_submit_build", { input, output });
      const submitElapsed = performance.now() - t0;
      assert.equal(submitted.ok, true, JSON.stringify(submitted));
      assert.equal(submitted.state, "queued");
      assert.match(submitted.jobId, /^[0-9a-f-]{36}$/i);
      assert.ok(submitElapsed < 500, `submit must return immediately, took ${submitElapsed.toFixed(1)}ms`);

      const result = await server.callTool("h2a_focus_build_result", {
        jobId: submitted.jobId,
        waitMs: 15_000
      });
      const totalElapsed = performance.now() - t0;
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.state, "succeeded");
      assert.equal(result.jobId, submitted.jobId);
      assert.equal(result.output, output);
      assert.ok(result.bytes > 10_000);
      assert.ok(Array.isArray(result.warnings));
      assert.ok(existsSync(output), "output HTML file must be written on disk");

      const html = readFileSync(output, "utf8");
      const envelope = parseEnvelopePayload(html);
      for (const s of ["diagram_0", "diagram_1", "diagram_2"]) {
        const rendered = envelope.diagrams[s];
        assert.ok(rendered, `rendered diagram ${s} must be present`);
        assert.equal(rendered.wide.problems.length, 0, `${s} wide variant must have 0 geometry problems`);
        assert.equal(
          rendered.wide.cards.length + rendered.wide.zones.length,
          30,
          `${s} must preserve all 30 entities (cards + zones)`
        );
        assert.equal(rendered.wide.edges.length, 45, `${s} must route all 45 edges`);
        assert.match(rendered.wide.svg, /<svg\b/);
      }
      assert.ok(
        totalElapsed < 10_000,
        `3x30x45 build should remain cleanly bounded off-loop (took ${totalElapsed.toFixed(1)}ms)`
      );
    } finally {
      await server.focusBuildManager.close();
    }
  });
});

test("central HTTP remains responsive to pings during heavy/slow builds and jobs survive client reconnect", async () => {
  await withTempFixture(async ({ rootDir, workspace, state, runtimeBase }) => {
    const slowWorker = join(rootDir, "slow-worker.mjs");
    writeFileSync(
      slowWorker,
      `
import { readFileSync, writeFileSync } from "node:fs";
import { FOCUS_WORKER_RESULT_MARKER } from ${JSON.stringify(new URL("../dist/runtime/mcp/focus-jobs.js", import.meta.url).href)};
let buf = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) buf += chunk;
const payload = JSON.parse(buf);
await new Promise((r) => setTimeout(r, 450));
const html = "<!doctype html><html><title>Slow</title><body><p>" + JSON.parse(readFileSync(payload.input, "utf8")).title + "</p></body></html>";
writeFileSync(payload.output, html, "utf8");
process.stdout.write(FOCUS_WORKER_RESULT_MARKER + JSON.stringify({
  ok: true,
  output: payload.output,
  bytes: Buffer.byteLength(html, "utf8"),
  warnings: []
}) + "\\n");
`,
      "utf8"
    );

    const central = await startCentralMcpServer({
      root: state,
      runtimeBase,
      env: { ...process.env, HOME: rootDir },
      focusBuild: { workerScript: slowWorker }
    });
    assert.equal(central.kind, "started");
    try {
      const marker = JSON.parse(readFileSync(central.markerPath, "utf8"));
      const authHeaders = (attachmentId, sessionId) => ({
        "x-h2a-workspace": encodeURIComponent(workspace),
        "x-h2a-attachment-id": attachmentId,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      });

      const rpc = async (attachmentId, sessionId, frame) => {
        const res = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
          method: "POST",
          attachmentId,
          transportEpoch: 1,
          headers: authHeaders(attachmentId, sessionId),
          body: JSON.stringify(frame)
        });
        const text = await res.text();
        return {
          status: res.status,
          sessionId: res.headers.get("mcp-session-id"),
          body: text ? JSON.parse(text) : undefined
        };
      };

      const input = join(workspace, "reconnect-dossier.json");
      const output = join(workspace, "reconnect-dossier.html");
      writeFileSync(input, JSON.stringify(buildHeavyDossier({ sceneCount: 1, nodesPerScene: 6, edgesPerScene: 5 })), "utf8");

      // Session 1 connects and submits async job.
      const init1 = await rpc("client-1", undefined, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-c1", version: "1" } }
      });
      assert.equal(init1.status, 200);
      const sess1 = init1.sessionId;
      assert.ok(sess1, "Session 1 must receive mcp-session-id");

      await rpc("client-1", sess1, { jsonrpc: "2.0", method: "notifications/initialized" });

      const subRes = await rpc("client-1", sess1, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "h2a_focus_submit_build", arguments: { input, output } }
      });
      assert.equal(subRes.status, 200);
      const submitted = JSON.parse(subRes.body.result.content[0].text);
      assert.equal(submitted.ok, true);
      assert.equal(submitted.state, "queued");
      const { jobId } = submitted;

      // Central /_h2a-central/ping must stay fast while child worker runs.
      const pingTimes = [];
      for (let i = 0; i < 4; i++) {
        const p0 = performance.now();
        const ping = await fetch(new URL(CENTRAL_PING_PATH, central.endpoint));
        const pMs = performance.now() - p0;
        pingTimes.push(pMs);
        assert.equal(ping.status, 200);
        const pingJson = await ping.json();
        assert.equal(pingJson.generation, central.generation);
      }
      assert.ok(Math.max(...pingTimes) < 250, `central pings stayed fast during worker run: ${pingTimes.map((x) => x.toFixed(1))}`);

      // Session 1 disconnects completely.
      const del = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
        method: "DELETE",
        attachmentId: "client-1",
        transportEpoch: 1,
        headers: authHeaders("client-1", sess1)
      });
      assert.equal(del.status, 200);

      // Brand-new Session 2 connects after Session 1 vanished and retrieves the result.
      const init2 = await rpc("client-2", undefined, {
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-c2", version: "1" } }
      });
      assert.equal(init2.status, 200);
      const sess2 = init2.sessionId;
      assert.ok(sess2 && sess2 !== sess1);
      await rpc("client-2", sess2, { jsonrpc: "2.0", method: "notifications/initialized" });

      const resCall = await rpc("client-2", sess2, {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "h2a_focus_build_result", arguments: { jobId, waitMs: 5_000 } }
      });
      assert.equal(resCall.status, 200);
      const result = JSON.parse(resCall.body.result.content[0].text);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.state, "succeeded");
      assert.equal(result.jobId, jobId);
      assert.equal(result.output, output);
      assert.ok(existsSync(output));
    } finally {
      await central.stop();
    }

    // Also verify real heavy 3x30x45 worker through central HTTP stays off-loop for pings + reconnect.
    const realState = join(rootDir, "state-real");
    const realRuntime = join(rootDir, "runtime-real");
    mkdirSync(realState, { recursive: true, mode: 0o700 });
    mkdirSync(realRuntime, { recursive: true, mode: 0o700 });
    const centralReal = await startCentralMcpServer({
      root: realState,
      runtimeBase: realRuntime,
      env: { ...process.env, HOME: rootDir }
    });
    assert.equal(centralReal.kind, "started");
    try {
      const markerReal = JSON.parse(readFileSync(centralReal.markerPath, "utf8"));
      const authHeaders = (attachmentId, sessionId) => ({
        "x-h2a-workspace": encodeURIComponent(workspace),
        "x-h2a-attachment-id": attachmentId,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      });
      const rpcReal = async (attachmentId, sessionId, frame) => {
        const res = await authenticatedHttpRequest(centralReal.markerPath, markerReal, centralReal.endpoint, {
          method: "POST",
          attachmentId,
          transportEpoch: 1,
          headers: authHeaders(attachmentId, sessionId),
          body: JSON.stringify(frame)
        });
        const text = await res.text();
        return {
          status: res.status,
          sessionId: res.headers.get("mcp-session-id"),
          body: text ? JSON.parse(text) : undefined
        };
      };

      const heavyInput = join(workspace, "central-heavy-3x30x45.json");
      const heavyOutput = join(workspace, "central-heavy-3x30x45.html");
      writeFileSync(
        heavyInput,
        JSON.stringify(buildHeavyDossier({ sceneCount: 3, nodesPerScene: 30, edgesPerScene: 45, ref: "dec-central-3x30" })),
        "utf8"
      );

      const s1Init = await rpcReal("real-c1", undefined, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "real-c1", version: "1" } }
      });
      assert.equal(s1Init.status, 200);
      const s1 = s1Init.sessionId;
      await rpcReal("real-c1", s1, { jsonrpc: "2.0", method: "notifications/initialized" });

      const tSubmit = performance.now();
      const s1Submit = await rpcReal("real-c1", s1, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "h2a_focus_submit_build", arguments: { input: heavyInput, output: heavyOutput } }
      });
      const submittedReal = JSON.parse(s1Submit.body.result.content[0].text);
      assert.equal(submittedReal.ok, true, JSON.stringify(submittedReal));
      assert.equal(submittedReal.state, "queued");

      const realPingTimes = [];
      for (let i = 0; i < 4; i++) {
        const p0 = performance.now();
        const ping = await fetch(new URL(CENTRAL_PING_PATH, centralReal.endpoint));
        realPingTimes.push(performance.now() - p0);
        assert.equal(ping.status, 200);
      }
      assert.ok(
        Math.max(...realPingTimes) < 250,
        `central ping must remain fast during real 3x30x45 build: ${realPingTimes.map((x) => x.toFixed(1))}`
      );

      await authenticatedHttpRequest(centralReal.markerPath, markerReal, centralReal.endpoint, {
        method: "DELETE",
        attachmentId: "real-c1",
        transportEpoch: 1,
        headers: authHeaders("real-c1", s1)
      });

      const s2Init = await rpcReal("real-c2", undefined, {
        jsonrpc: "2.0",
        id: 3,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "real-c2", version: "1" } }
      });
      const s2 = s2Init.sessionId;
      await rpcReal("real-c2", s2, { jsonrpc: "2.0", method: "notifications/initialized" });

      const s2Result = await rpcReal("real-c2", s2, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "h2a_focus_build_result",
          arguments: { jobId: submittedReal.jobId, waitMs: 15_000 }
        }
      });
      const doneReal = JSON.parse(s2Result.body.result.content[0].text);
      const totalRealMs = performance.now() - tSubmit;
      assert.equal(doneReal.ok, true, JSON.stringify(doneReal));
      assert.equal(doneReal.state, "succeeded");
      assert.equal(doneReal.output, heavyOutput);
      assert.ok(existsSync(heavyOutput));
      assert.ok(totalRealMs < 10_000, `real central 3x30x45 async build took ${totalRealMs.toFixed(1)}ms`);

      // Verify structured refusals preserve `{ ok: false, error, refusals }` over central HTTP registry dispatch.
      const badCentralSubmit = await rpcReal("real-c2", s2, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "h2a_focus_submit_build", arguments: { input: "/tmp/outside.json", output: heavyOutput } }
      });
      assert.equal(badCentralSubmit.body.result.isError, true);
      const parsedRefusal = JSON.parse(badCentralSubmit.body.result.content[0].text);
      assert.equal(parsedRefusal.ok, false);
      assert.equal(parsedRefusal.refusals?.[0]?.code, "path_policy");
    } finally {
      await centralReal.stop();
    }
  });
});

test("async submit/result supports publish-only and dual (output + publish) flows via Sentropic MCP", async () => {
  await withTempFixture(async ({ rootDir, workspace, state }) => {
    const fakeSentropic = await startFakeSentropicMcpServer();
    try {
      const sentropicHome = join(rootDir, "sentropic-home");
      mkdirSync(sentropicHome, { recursive: true, mode: 0o700 });
      const env = {
        ...process.env,
        H2A_SENTROPIC_HOME: sentropicHome,
        H2A_SENTROPIC_CLIENT_ID: "h2a-cli",
        H2A_SENTROPIC_MCP_URL: fakeSentropic.mcpUrl,
        H2A_SENTROPIC_ISSUER: "https://preprod.auth.sent-tech.ca"
      };
      const config = resolvePublishConfig(env, rootDir);
      const scope = configAuthScope(config);
      const token = {
        server: serverKey(config.mcpUrl),
        issuer: config.issuer,
        federation: config.federation,
        resource: config.mcpUrl,
        subject: "user-focus-test",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        accessToken: makeFakeJwt({
          iss: config.issuer,
          aud: config.mcpUrl,
          sub: "user-focus-test",
          tid: "tenant-focus-test",
          scope: "mcp:discover mcp:resources:read mcp:tools:invoke",
          client_id: "h2a-cli"
        })
      };
      writeAuth(token, sentropicHome, scope);

      const input = join(workspace, "publish-dossier.json");
      writeFileSync(
        input,
        JSON.stringify(buildHeavyDossier({ sceneCount: 3, nodesPerScene: 30, edgesPerScene: 45, ref: "dec-publish-3x30" })),
        "utf8"
      );

      const server = createMcpServer({ root: state, workspaceRoot: workspace, focusEnv: env });
      try {
        // 1) Publish-only (no output HTML) with explicit workspaceRef.
        const subPub = await server.callTool("h2a_focus_submit_build", {
          input,
          publish: {
            workspaceRef: "ws-bound-1",
            title: "Decision 3x30x45",
            expectedCurrentReleaseId: null
          }
        });
        assert.equal(subPub.ok, true, JSON.stringify(subPub));
        const resPub = await server.callTool("h2a_focus_build_result", {
          jobId: subPub.jobId,
          waitMs: 15_000
        });
        assert.equal(resPub.ok, true, JSON.stringify(resPub));
        assert.equal(resPub.state, "succeeded");
        assert.equal(resPub.output, undefined);
        assert.equal(resPub.publish?.restricted, true);
        assert.equal(resPub.publish?.workspaceRef, "ws-bound-1");
        assert.equal(resPub.publish?.bindingName, "focus:dec-publish-3x30");
        assert.deepEqual(resPub.publish?.files, ["dossier.json", "focus.manifest.json", "views.json"]);
        assert.match(resPub.publish?.stableUrl ?? "", /^https:\/\/artifacts\.local\.test\//);

        const pubCall = fakeSentropic.calls.find((c) => c.name === "artifacts_publish");
        assert.ok(pubCall, "artifacts_publish must be called");
        assert.equal(pubCall.args.expectedCurrentReleaseId, null);
        assert.equal(pubCall.args.isPublic, undefined, "publication must keep restricted access");
        const manifestFile = pubCall.args.files.find((f) => f.path === "focus.manifest.json");
        const viewsFile = pubCall.args.files.find((f) => f.path === "views.json");
        const manifestObj = JSON.parse(manifestFile.text);
        const viewsObj = JSON.parse(viewsFile.text);
        assert.equal(validateFocusArtifactManifest(manifestObj).ok, true);
        assert.equal(validateFocusViewsDocument(viewsObj, { documentDigest: manifestObj.document.digest }).ok, true);
        assert.deepEqual(Object.keys(viewsObj.diagrams), ["diagram_0", "diagram_1", "diagram_2"]);

        // 2) Dual mode: output HTML + publish together.
        const htmlOut = join(workspace, "dual-output.html");
        const subDual = await server.callTool("h2a_focus_submit_build", {
          input,
          output: htmlOut,
          publish: { workspaceRef: "ws-bound-1", title: "Dual Mode" }
        });
        assert.equal(subDual.ok, true);
        const resDual = await server.callTool("h2a_focus_build_result", {
          jobId: subDual.jobId,
          waitMs: 15_000
        });
        assert.equal(resDual.ok, true, JSON.stringify(resDual));
        assert.equal(resDual.output, htmlOut);
        assert.ok(existsSync(htmlOut));
        assert.ok(resDual.publish?.releaseId);
      } finally {
        await server.focusBuildManager.close();
      }
    } finally {
      await fakeSentropic.close();
    }
  });
});

test("h2a_focus_build stays compatible off-loop and returns pending jobId when bounded wait expires", async () => {
  await withTempFixture(async ({ rootDir, workspace, state }) => {
    const slowWorker = join(rootDir, "slow-compat-worker.mjs");
    writeFileSync(
      slowWorker,
      `
import { writeFileSync } from "node:fs";
import { FOCUS_WORKER_RESULT_MARKER } from ${JSON.stringify(new URL("../dist/runtime/mcp/focus-jobs.js", import.meta.url).href)};
let buf = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) buf += chunk;
const payload = JSON.parse(buf);
await new Promise((r) => setTimeout(r, 350));
const html = "<!doctype html><html><title>Compat</title><body><p>ok</p></body></html>";
writeFileSync(payload.output, html, "utf8");
process.stdout.write(FOCUS_WORKER_RESULT_MARKER + JSON.stringify({
  ok: true,
  output: payload.output,
  bytes: Buffer.byteLength(html, "utf8"),
  warnings: ["compat_warn"]
}) + "\\n");
`,
      "utf8"
    );

    const input = join(workspace, "compat.json");
    const output = join(workspace, "compat.html");
    writeFileSync(input, JSON.stringify(buildHeavyDossier({ sceneCount: 1, nodesPerScene: 6, edgesPerScene: 5 })), "utf8");

    const server = createMcpServer({
      root: state,
      workspaceRoot: workspace,
      focusBuildOptions: { workerScript: slowWorker, syncBuildWaitMs: 60 }
    });
    try {
      const pending = await server.callTool("h2a_focus_build", { input, output });
      assert.equal(pending.ok, true, JSON.stringify(pending));
      assert.equal(pending.pending, true);
      assert.match(pending.jobId, /^[0-9a-f-]{36}$/i);
      assert.ok(pending.state === "queued" || pending.state === "running");

      const done = await server.callTool("h2a_focus_build_result", {
        jobId: pending.jobId,
        waitMs: 5_000
      });
      assert.equal(done.ok, true, JSON.stringify(done));
      assert.equal(done.state, "succeeded");
      assert.equal(done.output, output);
      assert.deepEqual(done.warnings, ["compat_warn"]);
      assert.ok(existsSync(output));
    } finally {
      await server.focusBuildManager.close();
    }
  });
});

test("structured refusals, timeout SIGTERM/SIGKILL, maxConcurrentJobs, retention and durable restart recovery", async () => {
  await withTempFixture(async ({ rootDir, workspace, state }) => {
    // 1) Refusals + maxConcurrentJobs + timeout kill
    const hangingWorker = join(rootDir, "hang-worker.mjs");
    writeFileSync(
      hangingWorker,
      `
process.on("SIGTERM", () => { /* ignore SIGTERM to verify SIGKILL escalation */ });
setInterval(() => {}, 1000);
`,
      "utf8"
    );

    const input = join(workspace, "valid.json");
    const output = join(workspace, "out.html");
    writeFileSync(input, JSON.stringify(buildHeavyDossier({ sceneCount: 1, nodesPerScene: 6, edgesPerScene: 5 })), "utf8");

    const hangManager = createFocusBuildManager({
      stateRoot: join(state, "hang"),
      workerScript: hangingWorker,
      maxConcurrentJobs: 2,
      workerTimeoutMs: 180,
      killGraceMs: 60
    });
    try {
      const s1 = hangManager.submit({ workspaceRoot: workspace, input, output: join(workspace, "h1.html"), options: {} });
      const s2 = hangManager.submit({ workspaceRoot: workspace, input, output: join(workspace, "h2.html"), options: {} });
      assert.equal(s1.ok, true);
      assert.equal(s2.ok, true);

      // Quota full -> immediate structured refusal
      const s3 = hangManager.submit({ workspaceRoot: workspace, input, output: join(workspace, "h3.html"), options: {} });
      assert.equal(s3.ok, false);
      assert.equal(s3.refusals[0].code, "too_many_jobs");

      const r1 = await hangManager.getResult(s1.jobId, 5_000);
      assert.equal(r1.ok, false);
      assert.equal(r1.state, "failed");
      assert.equal(r1.refusals[0].code, "build_timeout");
      await hangManager.getResult(s2.jobId, 5_000);

      // Once quota drains, submissions work again.
      const s4 = hangManager.submit({ workspaceRoot: workspace, input, output: join(workspace, "h4.html"), options: {} });
      assert.equal(s4.ok, true);
      await hangManager.getResult(s4.jobId, 5_000);
    } finally {
      await hangManager.close();
    }

    // 2) Input validation + invalid JSON + durable restart recovery + retention
    const badJson = join(workspace, "bad.json");
    writeFileSync(badJson, "{not-valid-json", "utf8");

    const mgr1 = createFocusBuildManager({ stateRoot: state, maxConcurrentJobs: 4 });
    const badSubmit = await handleH2aFocusBuild({ input: badJson, output }, workspace, mgr1);
    assert.equal(badSubmit.ok, false);
    assert.equal(badSubmit.refusals[0].code, "invalid_json");

    // Submit missing output & publish -> structured refusal without queuing.
    const server = createMcpServer({ root: state, workspaceRoot: workspace, focusBuildManager: mgr1 });
    const badArgs = await server.callTool("h2a_focus_submit_build", { input });
    assert.equal(badArgs.ok, false);
    assert.equal(badArgs.refusals[0].code, "invalid_arguments");
    const missingJob = await server.callTool("h2a_focus_build_result", { jobId: randomUUID(), waitMs: 0 });
    assert.equal(missingJob.ok, false);
    assert.equal(missingJob.refusals[0].code, "job_not_found");

    // Successful build persisted to durable journal survives manager restart.
    const subOk = await server.callTool("h2a_focus_submit_build", { input, output });
    assert.equal(subOk.ok, true);
    const done1 = await server.callTool("h2a_focus_build_result", { jobId: subOk.jobId, waitMs: 10_000 });
    assert.equal(done1.ok, true);
    assert.equal(done1.state, "succeeded");

    // Plant a simulated crashed running record with dead PID.
    const deadJobId = randomUUID();
    writeFileSync(
      join(state, "focus-jobs", `${deadJobId}.json`),
      JSON.stringify({
        version: 1,
        jobId: deadJobId,
        state: "running",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        pid: 99999999,
        workspaceRoot: workspace,
        input,
        output,
        options: {}
      })
    );
    await mgr1.close();

    // Fresh manager reads completed job from disk and reconciles dead PID cleanly.
    let clockMs = Date.now() + 100;
    const mgr2 = createFocusBuildManager({
      stateRoot: state,
      retentionMs: 2_000,
      maxRetainedJobs: 2,
      now: () => clockMs
    });
    const recovered = await mgr2.getResult(subOk.jobId, 0);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.state, "succeeded");
    assert.equal(recovered.output, output);

    const reconciledDead = await mgr2.getResult(deadJobId, 0);
    assert.equal(reconciledDead.ok, false);
    assert.equal(reconciledDead.state, "failed");
    assert.equal(reconciledDead.refusals[0].code, "worker_lost");

    // Advancing clock beyond retentionMs expires terminal jobs cleanly.
    clockMs += 10_000;
    const expired = await mgr2.getResult(subOk.jobId, 0);
    assert.equal(expired.ok, false);
    assert.equal(expired.refusals[0].code, "job_not_found");
    await mgr2.close();
  });
});
