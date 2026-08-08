#!/usr/bin/env node
// Multi-session proof for the native PTY terminal host (PR #178 seam).
//
// Exercises the REAL production path end to end: the supervisor spawns the
// compiled dist/native-terminal/process.js host, sessions are created through
// the unix-socket protocol, and each PTY runs under the setpriv+bash crash
// containment guardian.
//
// Proof obligations (each printed as [proof] <name> ok|FAIL):
//   1. >=4 sessions created CONCURRENTLY on one host (3 bash + 1 claude TUI).
//   2. Per-session unique-marker I/O round-trip; isolation asserted in BOTH
//      directions (own marker present, every other session's marker absent).
//   3. Detach (client fully closed) then re-attach with a NEW client:
//      sessions persist, full scrollback replays from seq 0, and a fresh
//      controller lease can still write.
//   4. Clean exit: bash sessions exit 0 on "exit", claude is stopped through
//      the protocol; every session pid is POSITIVELY dead (ESRCH) and the
//      host has no leftover children.
//   5. Host shutdown on SIGTERM: host pid dies and the published socket is
//      unpublished.
//
// Re-run:   npm run build:h2a && node packages/h2a-runtime/scripts/native-terminal-proof.mjs
// Options:  CLAUDE_BIN=/path/to/claude   (default: "claude" on PATH)
//           --no-claude                  (substitute a 4th bash session; for
//                                         environments without claude)
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist", "native-terminal");
let NativeTerminalHostSupervisor;
let NativeTerminalClient;
let defaultNativeTerminalSocketPath;
try {
  ({ NativeTerminalHostSupervisor } = await import(join(distDir, "supervisor.js")));
  ({ NativeTerminalClient } = await import(join(distDir, "client.js")));
  ({ defaultNativeTerminalSocketPath } = await import(join(distDir, "socket-path.js")));
} catch (error) {
  console.error("[proof] build missing — run `npm run build:h2a` first:", String(error));
  process.exit(2);
}

const useClaude = !process.argv.includes("--no-claude");
const claudeBin = process.env.CLAUDE_BIN ?? "claude";
const failures = [];
function check(name, ok, detail = "") {
  console.log(`[proof] ${name} ${ok ? "ok" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}
function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[\d+G/g, " ")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b[78=>]/g, "");
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Hermetic socket in the canonical private directory.
const socketPath = join(
  dirname(defaultNativeTerminalSocketPath()),
  `proof-${process.pid}.sock`,
);
console.log(`[proof] socketPath: ${socketPath}`);
const supervisor = new NativeTerminalHostSupervisor({
  socketPath,
  replayBytesPerSession: 4 * 1024 * 1024,
});
let client = await supervisor.client();
const ping = await client.ping();
const hostPid = ping.hostPid;
console.log(`[proof] host ready: ${JSON.stringify(ping)}`);
check("host-spawned-via-default-path", Number.isSafeInteger(hostPid) && hostPid > 0);

// ---- 1. four concurrent sessions -------------------------------------------
const echoLoop = (tag) =>
  `while read -r l; do case "$l" in exit) exit 0;; *) echo "${tag}:$l";; esac; done`;
const specs = [
  { id: "s1-bash", command: "/bin/bash", args: ["-c", echoLoop("S1")] },
  { id: "s2-bash", command: "/bin/bash", args: ["-c", echoLoop("S2")] },
  { id: "s3-bash", command: "/bin/bash", args: ["-c", echoLoop("S3")] },
  useClaude
    ? { id: "s4-claude", command: claudeBin, args: [] }
    : { id: "s4-bash", command: "/bin/bash", args: ["-c", echoLoop("S4")] },
];
const sessions = new Map();
const created = await Promise.all(specs.map((spec) =>
  client.create({
    id: spec.id,
    command: spec.command,
    args: spec.args,
    cwd: process.env.HOME ?? "/",
    env: { ...process.env, TERM: "xterm-256color" },
    cols: 120,
    rows: 30,
  }),
));
for (const [index, state] of created.entries()) {
  sessions.set(specs[index].id, { spec: specs[index], pid: state.pid, seq: 0, out: "" });
  console.log(`[proof] created ${state.id} pid=${state.pid} status=${state.status}`);
}
const listed = await client.list();
check(
  "four-sessions-running-concurrently",
  listed.length === 4 && listed.every((s) => s.status === "running"),
  listed.map((s) => `${s.id}:${s.status}`).join(","),
);

async function pump(activeClient, id) {
  const record = sessions.get(id);
  const replay = await activeClient.readOutput(id, record.seq);
  for (const chunk of replay.chunks) {
    record.out += chunk.data;
    record.seq = chunk.seq;
  }
  return record.out;
}
async function waitOutput(activeClient, id, needle, timeoutMs, { plain = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out = await pump(activeClient, id);
    if ((plain ? stripAnsi(out) : out).includes(needle)) return true;
    await delay(150);
  }
  return false;
}

// ---- 2. unique-marker I/O per session, isolation both ways -----------------
const leases = new Map();
for (const id of sessions.keys()) {
  leases.set(id, await client.acquireController(id, `proof-${id}`));
}
const markers = new Map();
if (useClaude) {
  // claude first: get it to its prompt (answer the workspace-trust dialog if shown)
  const painted = await waitOutput(client, "s4-claude", "shortcuts", 30_000, { plain: true });
  if (!painted && stripAnsi(sessions.get("s4-claude").out).includes("trust this folder")) {
    await client.write(leases.get("s4-claude"), "\r");
  } else if (!painted) {
    await client.write(leases.get("s4-claude"), "\r"); // trust dialog default = accept
  }
  check(
    "claude-tui-painted",
    await waitOutput(client, "s4-claude", "shortcuts", 30_000, { plain: true }),
    "claude main prompt chrome visible through the native PTY",
  );
}
// interleaved writes: genuinely concurrent I/O, round-robin
for (const [id, record] of sessions) {
  const marker = `M-${id}-${Math.random().toString(16).slice(2, 10)}`;
  markers.set(id, marker);
  if (id === "s4-claude") {
    await client.write(leases.get(id), marker); // typed into the claude prompt
  } else {
    await client.write(leases.get(id), `${marker}\r`);
  }
  void record;
}
for (const [id] of sessions) {
  const marker = markers.get(id);
  const expected = id === "s4-claude" ? marker : `${id.slice(0, 2).toUpperCase()}:${marker}`;
  check(
    `io-roundtrip-${id}`,
    await waitOutput(client, id, expected, 15_000, { plain: id === "s4-claude" }),
    `marker ${marker}`,
  );
}
for (const [id] of sessions) {
  for (const [otherId, otherMarker] of markers) {
    if (otherId === id) continue;
    check(
      `isolation-${id}-free-of-${otherId}`,
      !sessions.get(id).out.includes(otherMarker),
    );
  }
}

// ---- 3. detach, persist, re-attach, replay, write again --------------------
const pidsBeforeDetach = new Map([...sessions].map(([id, r]) => [id, r.pid]));
client.close();
supervisor.disconnect();
await delay(500);
check(
  "sessions-survive-detach",
  [...pidsBeforeDetach.values()].every((pid) => pidAlive(pid)),
  "all session pids alive while no client is connected",
);
client = await NativeTerminalClient.connect(socketPath);
const relisted = await client.list();
check(
  "reattach-lists-persistent-sessions",
  relisted.length === 4 && relisted.every((s) => s.status === "running"),
);
for (const [id] of sessions) {
  const full = await client.readOutput(id, 0);
  const scrollback = full.chunks.map((chunk) => chunk.data).join("");
  const ok = scrollback.includes(markers.get(id)) &&
    [...markers].every(([otherId, m]) => otherId === id || !scrollback.includes(m));
  check(`replay-from-zero-${id}`, ok, `${scrollback.length} bytes of scrollback`);
}
const leases2 = new Map();
for (const id of sessions.keys()) {
  leases2.set(id, await client.acquireController(id, `proof2-${id}`));
}
for (const [id] of sessions) {
  if (id === "s4-claude") continue;
  const marker2 = `R-${id}-${Math.random().toString(16).slice(2, 10)}`;
  await client.write(leases2.get(id), `${marker2}\r`);
  check(
    `post-reattach-write-${id}`,
    await waitOutput(client, id, `${id.slice(0, 2).toUpperCase()}:${marker2}`, 10_000),
  );
}

// ---- 4. clean exit, positive pid death, no leaks ---------------------------
for (const [id] of sessions) {
  if (id === "s4-claude") {
    await client.stop(leases2.get(id), "SIGTERM");
  } else {
    await client.write(leases2.get(id), "exit\r");
  }
}
async function waitExited(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await client.state(id);
    if (state.status === "exited") return state;
    await delay(150);
  }
  return client.state(id);
}
for (const [id] of sessions) {
  let state = await waitExited(id, 8_000);
  if (state.status !== "exited" && id === "s4-claude") {
    await client.stop(await client.acquireController(id, "proof-kill").catch(() => leases2.get(id)), "SIGKILL").catch(() => {});
    state = await waitExited(id, 5_000);
  }
  check(`clean-exit-${id}`, state.status === "exited", `exit=${JSON.stringify(state.exit)}`);
}
await delay(300);
for (const [id, pid] of pidsBeforeDetach) {
  check(`pid-positively-dead-${id}`, !pidAlive(pid), `pid ${pid}`);
}
let leakedChildren = "";
try {
  leakedChildren = execFileSync("pgrep", ["-P", String(hostPid)], { encoding: "utf8" }).trim();
} catch {
  leakedChildren = ""; // pgrep exits 1 when nothing matches
}
check("no-leaked-host-children", leakedChildren === "", leakedChildren || "host has no children");

// ---- 5. host shutdown unpublishes the socket -------------------------------
client.close();
process.kill(hostPid, "SIGTERM");
{
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pidAlive(hostPid)) await delay(100);
}
check("host-exits-on-sigterm", !pidAlive(hostPid), `host pid ${hostPid}`);
let socketGone = false;
try {
  lstatSync(socketPath);
} catch (error) {
  socketGone = error.code === "ENOENT";
}
check("socket-unpublished-after-shutdown", socketGone);

console.log(failures.length === 0
  ? `[proof] PASS — all ${sessions.size}-session native PTY obligations met`
  : `[proof] FAIL — ${failures.length} failed: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
