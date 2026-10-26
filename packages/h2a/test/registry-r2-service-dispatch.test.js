import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openCentralAttachment } from "../dist/runtime/mcp-central-attachment.js";
import { createLocalStore } from "../dist/runtime/local-files/index.js";
import { createMcpServer } from "../dist/runtime/mcp/server.js";
import {
  composeDaemonRegistry,
  composeDaemonRegistryForServer
} from "../dist/registry/sentropic-daemon.js";

// Round 2 (reviews Astra+Sol P1): the shared service's tool dispatch routes
// through the composed Sentropic registry plan — not around it. Every test
// below drives the REAL attachment path (`openCentralAttachment`, the H1
// production factory); none composes a standalone object detached from a
// service server.

async function withAttachment(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r2-service-"));
  const workspace = join(dir, "ws");
  mkdirSync(workspace, { recursive: true });
  const store = createLocalStore({ root: dir });
  const handle = openCentralAttachment(dir, workspace, store, undefined, async () => {});
  try {
    return await fn({ dir, workspace, handle });
  } finally {
    try {
      await handle.close();
    } catch {
      // Close is best-effort in tests.
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("R2 service: attachment dispatch serves coordination (identity fast-path, real handler)", async () => {
  await withAttachment(async ({ handle }) => {
    // `h2a_identity_status` keeps the historical sync fast-path (H1
    // internals read it synchronously); plan routing for coordination tools
    // is proven by the handler_error code assertions below.
    const raw = await handle.mcp.callTool("h2a_identity_status", {});
    assert.ok(raw && typeof raw === "object" && "content" in raw, "identity status answers");
    const parsed = JSON.parse(raw.content[0].text);
    assert.ok(
      ["identity_disabled", "identity_pending", "identity_ready", "identity_failed"].includes(parsed.state),
      `real handler state, got ${raw.content[0].text.slice(0, 160)}`
    );
  });
});

test("R2 service: attachment dispatch serves Track reads through the registry plan", async () => {
  await withAttachment(async ({ handle }) => {
    const raw = await handle.mcp.callTool("track_query", { baselineCommit: "abc1234" });
    assert.ok(raw && typeof raw === "object" && "content" in raw, "track read answers through the plan");
    assert.ok(raw.content[0].text.length > 0, "real Track handler returns a payload");
  });
});

test("R2 service: attachment dispatch denies unknown tools with the plan code", async () => {
  await withAttachment(async ({ handle }) => {
    const raw = await handle.mcp.callTool("h2a_does_not_exist", {});
    // The registry plan denies with `unknown_tool:` (code prefix); the raw
    // server alone would answer `unknown tool:` without a code.
    assert.ok(raw && typeof raw === "object" && "error" in raw, "denial answers, it does not hang");
    assert.match(String(raw.error), /unknown_tool/);
  });
});

test("R2 service: business errors are failures on the attachment path, never ok:true", async () => {
  await withAttachment(async ({ handle }) => {
    for (const [tool, args] of [
      ["h2a_send", {}],
      ["h2a_register_instance", {}],
      ["h2a_session_open", {}]
    ]) {
      const raw = await handle.mcp.callTool(tool, args);
      assert.ok(raw && typeof raw === "object" && "error" in raw, `${tool} reports its refusal`);
      assert.match(String(raw.error), /handler_error/, `${tool} carries the plan refusal code`);
    }
  });
});

test("R2 service: standalone composition maps business errors to failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r2-daemon-"));
  try {
    const composed = await composeDaemonRegistry({ view: "combined", root: dir });
    for (const [tool, args] of [
      ["h2a_send", {}],
      ["h2a_register_instance", {}],
      ["h2a_session_open", {}]
    ]) {
      await assert.rejects(() => composed.dispatch(tool, args), /handler_error/, `${tool} refuses`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R2 service: the three views execute against real service state", async () => {
  await withAttachment(async ({ dir, workspace }) => {
    // Each view is bound to a sibling server sharing the attachment roots
    // (same store backing, workspace and identity shape): plan-level
    // isolation per view, execution against real service state — never a
    // detached standalone object.
    const store = createLocalStore({ root: dir });
    const sibling = createMcpServer({
      root: dir,
      workspaceRoot: workspace,
      store,
      storeInitialize: false,
      sessions: { autoHeartbeat: false }
    });
    try {
      const forSibling = (view) =>
        composeDaemonRegistryForServer(sibling.callTool.bind(sibling), { view, root: dir, workspaceRoot: workspace });
      const coordination = await forSibling("coordination");
      assert.equal((await coordination.dispatch("h2a_identity_status", {})).ok, true);
      await assert.rejects(() => coordination.dispatch("track_query", { baselineCommit: "x" }), /unknown_tool/);
      const trackOnly = await forSibling("track");
      assert.equal((await trackOnly.dispatch("track_query", { baselineCommit: "x" })).ok, true);
      await assert.rejects(() => trackOnly.dispatch("h2a_identity_status", {}), /unknown_tool/);
      const combined = await forSibling("combined");
      assert.equal((await combined.dispatch("h2a_identity_status", {})).ok, true);
      assert.equal((await combined.dispatch("track_query", { baselineCommit: "x" })).ok, true);
      await assert.rejects(() => combined.dispatch("h2a_does_not_exist", {}), /unknown_tool/);
    } finally {
      try {
        sibling.notifications.stop();
      } catch {
        // Best-effort.
      }
    }
  });
});
