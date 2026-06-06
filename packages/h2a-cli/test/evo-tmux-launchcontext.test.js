import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionRegistry, detectTmuxLaunchContext, latestLaunchContext } from "../dist/index.js";

// Slice C of wake-by-default: mcp-serve (spawned as the agent's MCP server,
// inheriting its $TMUX_PANE) auto-captures its tmux pane into the session launch
// context, so the local-tmux wake driver can target the agent with NO launcher
// config. Outside tmux → undefined → wake gracefully no-ops.

test("detectTmuxLaunchContext: builds a pane launchContext under tmux", () => {
  const lc = detectTmuxLaunchContext(
    { TMUX: "/tmp/tmux-1000/default,123,0", TMUX_PANE: "%7" },
    "/work/proj",
    "h2a mcp-serve --host claude"
  );
  assert.ok(lc, "launchContext present under tmux");
  assert.equal(lc.tmux.pane, "%7");
  assert.equal(lc.cwd, "/work/proj");
  assert.equal(lc.command, "h2a mcp-serve --host claude");
});

test("detectTmuxLaunchContext: undefined when not under tmux", () => {
  assert.equal(detectTmuxLaunchContext({}, "/x", "c"), undefined);
  // TMUX_PANE without TMUX (stale env) → still undefined (require both)
  assert.equal(detectTmuxLaunchContext({ TMUX_PANE: "%1" }, "/x", "c"), undefined);
  assert.equal(detectTmuxLaunchContext({ TMUX: "/sock,1,0" }, "/x", "c"), undefined);
});

test("detectTmuxLaunchContext: the pane id alone is a valid local-tmux target (session unused)", () => {
  const lc = detectTmuxLaunchContext({ TMUX: "s", TMUX_PANE: "%42" }, "/x", "c");
  // tmuxTarget returns the bare pane when no window is set, so an empty session
  // is fine — `tmux send-keys -t %42` addresses the pane globally.
  assert.equal(lc.tmux.session, "");
  assert.equal(lc.tmux.pane, "%42");
});

test("END-TO-END: session open RECORDS launchContext → latestLaunchContext resolves the pane", () => {
  // Regression guard: SessionRegistry.open must thread launchContext into the
  // presence record. Without it the auto-detected pane is silently dropped and
  // the local-tmux wake driver has nothing to target (the bug behind pane=NONE).
  const root = join(mkdtempSync(join(tmpdir(), "h2a-lc-")), ".h2a");
  try {
    const reg = new SessionRegistry(root, { autoHeartbeat: false });
    const lc = detectTmuxLaunchContext({ TMUX: "s", TMUX_PANE: "%5" }, "/w", "h2a mcp-serve --host claude");
    reg.open({
      instance: "claude:proj:abcabcabcabc",
      host: "claude",
      launchContext: lc,
      interests: { scopes: ["scope:default"], negotiations: [] }
    });
    const resolved = latestLaunchContext(root, "claude:proj:abcabcabcabc");
    assert.ok(resolved, "launchContext must be persisted in presence");
    assert.equal(resolved.tmux.pane, "%5");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
