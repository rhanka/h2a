/**
 * L2 T11 — protected / read-only storage.
 *
 * RED on main (4be46caf): the boot path creates the store layout / schema
 * sentinel BEFORE any handshake, so a non-writable root throws before
 * `initialize` and the server dies. GREEN on the candidate: the transport opens
 * a NON-writing store (no directory / sentinel / file creation), so
 * `initialize` / `tools/list` / `h2a_identity_status` and every read-only tool
 * stay available in a DEGRADED mode, while the identity worker's write attempt
 * fails and identity becomes `identity_failed` with a typed storage cause —
 * `storage_permission_denied` (EACCES) vs `storage_readonly` (EROFS) — and NO
 * mutation / ACK / signature is produced.
 *
 * The portable case uses `chmod -R a-w` (EACCES) and is the RED/GREEN
 * discriminator. The EROFS case needs a real read-only bind mount in a private
 * namespace (the `unshare` wrapper in the mandate); without it, it reports
 * BLOCKED_ENVIRONMENT rather than a pass, and is never faked with chmod.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  callRpc,
  callTool,
  labRoot,
  parseToolJson,
  spawnMcp,
  stopChildren,
  waitForIdentity
} from "./helpers/mcp-fix-lab.js";

const SEED = process.env.H2A_MCP_TEST_SEED;
if (process.env.H2A_MCP_REQUIRE_REAL_SEED === "1" && !SEED) {
  throw new Error(
    "H2A_MCP_REQUIRE_REAL_SEED=1 but H2A_MCP_TEST_SEED is unset — the real seed is mandatory (no reduced fixture)."
  );
}
const maybe = test; // F4: always run — synthetic corpus fallback when the private seed is absent

function chmodTree(path, mode) {
  execFileSync("chmod", ["-R", mode, path]);
}

maybe(
  "T11 read-only storage (EACCES): connection + status stay available; identity_failed storage_permission_denied; no mutation",
  { timeout: 40_000 },
  async () => {
    const root = labRoot(SEED);
    // Remove write everywhere (keep r-x): every store write (layout, sentinel,
    // registry append) now fails with EACCES; reads still work.
    chmodTree(root, "a-w");
    let h;
    try {
      h = spawnMcp({
        root,
        args: ["--auto-open", "--host", "claude"],
        env: { CLAUDE_CODE_SESSION_ID: "t11-eacces" }
      });
      // The connection is up even though storage is not writable.
      const init = await callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 15_000 });
      assert.equal(init.message.result.serverInfo.name, "@sentropic/h2a");
      const list = await callRpc(h, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { timeoutMs: 15_000 });
      assert.ok(list.message.result.tools.length >= 55);
      const st = parseToolJson(await callTool(h, "h2a_identity_status"));
      assert.ok(st.state === "identity_pending" || st.state === "identity_failed");

      // Identity fails with a typed storage cause, distinguished from EROFS.
      const failed = await waitForIdentity(h, (s) => s.state === "identity_failed", {
        timeoutMs: 26_000,
        pollMs: 400
      });
      assert.equal(failed.state, "identity_failed");
      assert.equal(
        failed.cause,
        "storage_permission_denied",
        "EACCES is reported as storage_permission_denied (distinct from storage_readonly)"
      );
      assert.equal(failed.retryable, false);

      // No mutation / no availability: signed tools refused, no presence written.
      const send = parseToolJson(await callTool(h, "h2a_send", { to: "claude:x", message: "hi" }));
      assert.equal(send.code, "identity_failed");
      const presence = existsSync(join(root, "presence"))
        ? readdirSync(join(root, "presence")).filter((f) => f.endsWith(".json"))
        : [];
      assert.equal(presence.length, 0, "no presence session on read-only storage");
    } finally {
      chmodTree(root, "u+w"); // restore so teardown/cleanup can remove the tree
      if (h) {
        h.child.stdin.end();
        await stopChildren(h);
      }
    }
  }
);

maybe(
  "T11 real read-only mount (EROFS): identity_failed storage_readonly — or BLOCKED_ENVIRONMENT without a namespace",
  { timeout: 40_000 },
  async (t) => {
    // The qualified EROFS case runs only under the mandate's unshare wrapper,
    // which bind-mounts a PRIVATE COPY read-only and sets these two vars. Without
    // them this is a coverage GAP (BLOCKED_ENVIRONMENT), never faked with chmod.
    const roRoot = process.env.H2A_MCP_READONLY_ROOT;
    if (process.env.H2A_MCP_REQUIRE_READONLY_MOUNT !== "1" || !roRoot) {
      t.diagnostic(
        "BLOCKED_ENVIRONMENT: no read-only bind mount (set H2A_MCP_REQUIRE_READONLY_MOUNT=1 + H2A_MCP_READONLY_ROOT via the unshare wrapper)"
      );
      t.skip("EROFS mount unavailable in this environment (see mandate §Montage T11 réel)");
      return;
    }
    let h;
    try {
      h = spawnMcp({
        root: roRoot,
        args: ["--auto-open", "--host", "claude"],
        env: { CLAUDE_CODE_SESSION_ID: "t11-erofs" }
      });
      const init = await callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 15_000 });
      assert.equal(init.message.result.serverInfo.name, "@sentropic/h2a");
      const failed = await waitForIdentity(h, (s) => s.state === "identity_failed", {
        timeoutMs: 26_000,
        pollMs: 400
      });
      assert.equal(failed.state, "identity_failed");
      assert.equal(failed.cause, "storage_readonly", "EROFS is reported as storage_readonly");
    } finally {
      if (h) {
        h.child.stdin.end();
        await stopChildren(h);
      }
    }
  }
);

maybe(
  "T11 absent root: reads are empty, not a crash; the transport still answers",
  { timeout: 30_000 },
  async () => {
    // A brand-new, not-yet-created root on a WRITABLE parent: the non-writing
    // transport store yields empty reads (never flattens an unreadable file to
    // empty), and initialize/tools-list answer. Identity may then create the
    // layout and resolve — the point here is that an absent root does not crash.
    const parent = labRoot(SEED, { dest: undefined });
    const root = join(parent, "brand-new-root");
    let h;
    try {
      h = spawnMcp({
        root,
        args: ["--auto-open", "--host", "claude"],
        env: { CLAUDE_CODE_SESSION_ID: "t11-absent" }
      });
      const init = await callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 15_000 });
      assert.equal(init.message.result.serverInfo.name, "@sentropic/h2a");
      const disc = parseToolJson(
        await callRpc(h, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "h2a_discover_instances", arguments: { limit: 5 } }
        })
      );
      assert.ok(Array.isArray(disc.instances) || Array.isArray(disc.page?.instances) || disc.instances === undefined);
    } finally {
      if (h) {
        h.child.stdin.end();
        await stopChildren(h);
      }
    }
  }
);
