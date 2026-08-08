#!/usr/bin/env node
// End-to-end proof for the session-host selector (track 01KZFGKP1F04T52ED3Z3GRJYYE).
//
// Drives the REAL `h2a` CLI (packages/h2a/dist/bin.js) in an ISOLATED config
// home (REMOTE_CLI_CONFIG_HOME) against an ISOLATED native host socket
// (H2A_NATIVE_SOCKET), so the machine's real fleet and registry are never
// touched. tmux sessions use unique names and are stopped by the proof.
//
// Obligations ([e2e] <name> ok|FAIL):
//   1. `h2a run` with NO flag launches under the NATIVE PTY host — twice,
//      concurrently: registry kind=local-native, native host reports the
//      session running, and tmux does NOT have it (asserted both directions).
//   2. `h2a run --tmux` launches under tmux: tmux has-session succeeds,
//      registry kind=local-tmux, the native host does NOT know the session.
//   3. `h2a ls` lists sessions from both hosts.
//   4. `h2a attach` honors the recorded host: attaching the native session in
//      a real PTY paints the claude TUI, typed keys echo, Ctrl-\ detaches,
//      and the session survives the detach.
//   5. `h2a relaunch <slug>` honors the recorded host: dry-run names the
//      NATIVE plan; --apply --yes restarts it (new pid, still local-native).
//   6. restore's tabCommand emits host-agnostic `h2a attach` for live locals.
//   7. `h2a stop` kills each session through its own host; teardown leaves no
//      host process behind.
//
// Re-run: npm run build:h2a && node packages/h2a-runtime/scripts/host-selector-proof.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "..", "h2a", "dist", "bin.js");
const OP = join(here, "..", "dist", "native-terminal", "op.js");
const require = createRequire(import.meta.url);

const runtimeBase = process.env.XDG_RUNTIME_DIR ?? "/tmp";
const proofHome = mkdtempSync(join(runtimeBase, "h2a-e2e-"));
const socketPath = join(proofHome, "nt.sock");
// Sessions inherit this env. Claude fires SessionStart/End hooks that invoke
// `h2a` from PATH; shim it to THIS build so hook writes go through the new
// validator (a pre-native h2a rewrite drops kind:"local-native" rows — the
// release must upgrade the global binary together with the runtime).
const shimDir = join(proofHome, "bin");
mkdirSync(shimDir, { mode: 0o700 });
writeFileSync(
  join(shimDir, "h2a"),
  `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`,
  { mode: 0o755 },
);
const env = {
  ...process.env,
  PATH: `${shimDir}:${process.env.PATH ?? ""}`,
  REMOTE_CLI_CONFIG_HOME: proofHome,
  H2A_NATIVE_SOCKET: socketPath,
};

const failures = [];
function check(name, ok, detail = "") {
  console.log(`[e2e] ${name} ${ok ? "ok" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}
function h2a(args, options = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env,
    timeout: 120_000,
    ...options,
  });
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function op(args) {
  const r = spawnSync(process.execPath, [OP, ...args], {
    encoding: "utf8",
    env,
    timeout: 20_000,
  });
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  try {
    return { status: r.status ?? 1, payload: JSON.parse(line) };
  } catch {
    return { status: r.status ?? 1, payload: undefined };
  }
}
function tmuxHas(name) {
  return spawnSync("tmux", ["has-session", "-t", `=${name}`], { stdio: "ignore" })
    .status === 0;
}
function registry() {
  try {
    return JSON.parse(
      readFileSync(join(proofHome, ".config", "sentropic", "h2a", "registry.json"), "utf8"),
    );
  } catch {
    return [];
  }
}
function registryEntry(id) {
  const all = registry();
  const list = Array.isArray(all) ? all : all.entries ?? [];
  return list.find((e) => e.id === id);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// TUIs position words with cursor-column escapes; phrase matching only works
// on the ANSI-stripped text (column motion becomes a space).
const stripAnsi = (s) => s
  .replace(/\x1b\][^\x07]*\x07/g, "")
  .replace(/\x1b\[\d+G/g, " ")
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
  .replace(/\x1b[78=>]/g, "");

const NAT_A = `e2e-nat-a-${process.pid}`;
const NAT_B = `e2e-nat-b-${process.pid}`;
const TMX = `e2e-tmx-${process.pid}`;
const CLAUDE = process.env.CLAUDE_BIN ?? "claude";

// ---- 1. default (no flag) => NATIVE, twice, concurrently -------------------
for (const label of [NAT_A, NAT_B]) {
  const r = h2a(["run", "claude", process.env.HOME, "--name", label, "--no-attach"]);
  check(`run-default-starts-${label}`, r.status === 0, r.out.trim().split("\n").pop());
}
await delay(1_000);
for (const label of [NAT_A, NAT_B]) {
  const name = `h2a-${label}`;
  const entry = registryEntry(label);
  check(`registry-kind-native-${label}`, entry?.kind === "local-native", `kind=${entry?.kind}`);
  const state = op(["state", "--id", name]);
  check(
    `native-host-running-${label}`,
    state.status === 0 && state.payload?.status === "running",
    JSON.stringify(state.payload),
  );
  check(`not-in-tmux-${label}`, !tmuxHas(name));
}
{
  const list = op(["list"]);
  const running = (list.payload?.sessions ?? []).filter((s) => s.status === "running");
  check(
    "two-native-sessions-one-host",
    running.length >= 2 && [NAT_A, NAT_B].every((l) => running.some((s) => s.id === `h2a-${l}`)),
    running.map((s) => s.id).join(","),
  );
}

// ---- 2. --tmux => tmux -----------------------------------------------------
{
  const r = h2a(["run", "claude", process.env.HOME, "--name", TMX, "--no-attach", "--tmux"]);
  check("run-tmux-starts", r.status === 0, r.out.trim().split("\n").pop());
  await delay(500);
  const name = `h2a-${TMX}`;
  check("tmux-has-session", tmuxHas(name));
  const entry = registryEntry(TMX);
  check("registry-kind-tmux", entry?.kind === "local-tmux", `kind=${entry?.kind}`);
  const state = op(["state", "--id", name]);
  check("not-on-native-host", state.status !== 0, "native host does not know the tmux session");
}

// ---- 3. ls sees both hosts -------------------------------------------------
{
  const r = h2a(["ls"]);
  const sees = (label) => r.out.includes(label) || r.out.includes(`h2a-${label}`);
  check("ls-lists-native-and-tmux", sees(NAT_A) && sees(NAT_B) && sees(TMX),
    `exit=${r.status}`);
}

// ---- 4. attach honors the recorded host (native, real PTY) -----------------
{
  const pty = require("node-pty");
  const attach = pty.spawn(process.execPath, [CLI, "attach", NAT_A], {
    cwd: process.env.HOME,
    env,
    cols: 120,
    rows: 30,
    name: "xterm-256color",
  });
  let out = "";
  attach.onData((chunk) => {
    out += chunk;
  });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && !/trust|shortcuts|Claude/i.test(out)) {
    await delay(300);
  }
  check("attach-native-paints-claude", /trust|shortcuts|Claude/i.test(out),
    `${out.length} bytes painted`);
  // The workspace-trust dialog swallows plain text; answer it first, then
  // wait for the composer chrome before typing the echo probe.
  if (/trust this folder/i.test(stripAnsi(out))) {
    attach.write("\r");
  }
  {
    const composerDeadline = Date.now() + 25_000;
    while (Date.now() < composerDeadline && !/shortcuts/i.test(stripAnsi(out))) {
      await delay(300);
    }
  }
  attach.write("e2e-echo-probe");
  {
    const echoDeadline = Date.now() + 8_000;
    while (Date.now() < echoDeadline && !stripAnsi(out).includes("e2e-echo-probe")) {
      await delay(300);
    }
  }
  check("attach-native-keystrokes-echo", stripAnsi(out).includes("e2e-echo-probe"));
  attach.write(""); // Ctrl-\ detach
  await delay(800);
  check("attach-native-detach-message", out.includes("detached from native session"));
  attach.kill();
  await delay(300);
  const state = op(["state", "--id", `h2a-${NAT_A}`]);
  check(
    "session-survives-detach",
    state.status === 0 && state.payload?.status === "running",
    JSON.stringify(state.payload),
  );
}

// ---- 5. relaunch honors the recorded host ----------------------------------
{
  const before = op(["state", "--id", `h2a-${NAT_B}`]).payload;
  const dry = h2a(["relaunch", NAT_B]);
  check(
    "relaunch-dry-run-names-native",
    dry.status === 0 && /would relaunch NATIVE session/.test(dry.out),
    dry.out.trim().split("\n").pop(),
  );
  const apply = h2a(["relaunch", NAT_B, "--apply", "--yes"]);
  check("relaunch-apply-succeeds", apply.status === 0, apply.out.trim().split("\n").pop());
  await delay(1_000);
  const after = op(["state", "--id", `h2a-${NAT_B}`]).payload;
  check(
    "relaunch-new-native-incarnation",
    after?.status === "running" && before?.pid !== undefined && after?.pid !== before.pid,
    `pid ${before?.pid} -> ${after?.pid}`,
  );
  const entry = registryEntry(NAT_B);
  check("relaunch-keeps-native-kind", entry?.kind === "local-native", `kind=${entry?.kind}`);
}

// ---- 6. restore emits host-agnostic attach ---------------------------------
{
  const { tabCommand } = await import(join(here, "..", "dist", "restore.js"));
  const command = tabCommand(
    { label: NAT_A, cwd: process.env.HOME, tool: "claude" },
    new Set(),
    { attachSession: `h2a-${NAT_A}` },
  );
  check(
    "restore-tab-uses-h2a-attach",
    command === `h2a attach 'h2a-${NAT_A}'`,
    command,
  );
}

// ---- 7. stop through the recorded host + teardown --------------------------
for (const label of [NAT_A, NAT_B]) {
  const r = h2a(["stop", label]);
  await delay(300);
  const state = op(["state", "--id", `h2a-${label}`]);
  const gone = state.status !== 0 || state.payload?.status === "exited";
  check(`stop-native-${label}`, r.status === 0 && gone, JSON.stringify(state.payload ?? state.status));
}
{
  const r = h2a(["stop", TMX]);
  await delay(300);
  check("stop-tmux", r.status === 0 && !tmuxHas(`h2a-${TMX}`));
}
{
  const host = op(["ensure-host"]);
  const hostPid = host.payload?.hostPid;
  op(["host-stop"]);
  await delay(1_000);
  let dead = true;
  try {
    process.kill(hostPid, 0);
    dead = false;
  } catch {
    dead = true;
  }
  check("proof-host-terminated", dead, `host pid ${hostPid}`);
}

console.log(failures.length === 0
  ? "[e2e] PASS — default-pty launches native, --tmux switches, recorded host honored"
  : `[e2e] FAIL — ${failures.length} failed: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
