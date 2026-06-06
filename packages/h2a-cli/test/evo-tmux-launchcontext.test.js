import assert from "node:assert/strict";
import test from "node:test";

import { detectTmuxLaunchContext } from "../dist/index.js";

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
