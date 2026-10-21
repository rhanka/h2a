#!/usr/bin/env node
/**
 * Lot L4-replies (D10) — real-VTE qualification fixture runner.
 *
 * Spawns a REAL VTE terminal (`gnome-terminal`) under a private virtual
 * display (`Xvfb`) and a private D-Bus session (`dbus-run-session`), then
 * runs the lot-branch `op attach` inside it with stdin redirected from a
 * FIFO the qualification test drives.
 *
 * Observation model: op's stdout stays connected to the VTE screen (the VTE
 * must SEE the relayed queries to answer them — redirecting it to a file
 * would make the test vacuous). The test observes through the INNER side:
 * the fixture inner program logs every byte it receives to a receipt file
 * under the lot's L0 temp roots. Human input travels test → FIFO → bridge →
 * host → inner; VTE answers travel VTE → bridge → (typed unit) → host →
 * inner-or-swallowed. A leaked reply lands in the receipt file; a swallowed
 * one never does.
 *
 * Isolation: HOME/XDG/DISPLAY/bus/runtime state all live under the lot's
 * L0 temp roots (argv). The branch build under test is whatever `op.ts`
 * path the caller passes (the fixture prefix, never the owner's installed
 * build). Only fixture-spawned, birth-checked PIDs are ever stopped: Xvfb,
 * the dbus session and gnome-terminal are all direct children of this
 * runner and are killed on every exit path.
 *
 * Usage:
 *   vte-harness.mjs --display N --tmp DIR --socket SOCK --id ID --op OP_TS \
 *     --tsx TSX_PATH --fifo FIFO --out OUT --err ERR
 *
 * The harness stays alive as the session supervisor until gnome-terminal
 * exits (FIFO EOF detaches the bridge, which ends the child, which ends
 * gnome-terminal with --wait), then propagates its exit code.
 *
 * Zero Python: Node + the named native binaries only.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function required(args, name) {
  const value = args.get(name);
  if (value === undefined) throw new Error(`vte-harness: --${name} is required`);
  return value;
}

function parseArgv(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`vte-harness: unexpected argument: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`vte-harness: --${arg.slice(2)} requires a value`);
    args.set(arg.slice(2), value);
    i++;
  }
  return args;
}

function haveBinary(name) {
  // `command` is a shell builtin, not an executable: resolve through sh.
  // `name` is always one of the hardcoded prerequisite names below.
  return spawnSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).status === 0;
}

async function main() {
  const args = parseArgv(process.argv);
  const display = required(args, "display");
  const root = required(args, "tmp");
  const socketPath = required(args, "socket");
  const id = required(args, "id");
  const opTs = required(args, "op");
  const tsx = required(args, "tsx");
  const fifo = required(args, "fifo");
  const outPath = required(args, "out");
  const errPath = required(args, "err");

  for (const binary of ["Xvfb", "dbus-run-session", "gnome-terminal", "mkfifo"]) {
    if (!haveBinary(binary)) {
      process.stderr.write(`vte-harness: INCOMPLETE — missing ${binary}\n`);
      process.exitCode = 3;
      return;
    }
  }
  mkdirSync(root, { recursive: true });
  process.stderr.write(`vte-harness: display=:${display} socket=${socketPath} id=${id}\n`);
  const home = mkdtempSync(join(root, "vte-home-"));
  const xdg = mkdtempSync(join(root, "vte-xdg-"));
  if (!existsSync(fifo)) {
    const mk = spawnSync("mkfifo", [fifo]);
    if (mk.status !== 0) throw new Error(`vte-harness: mkfifo failed: ${mk.stderr}`);
  }

  const cleanup = [];
  const killAll = () => {
    for (const child of cleanup.splice(0)) {
      try {
        if (child.exitCode === null) child.kill("SIGKILL");
      } catch { /* already gone */ }
    }
  };
  process.on("exit", killAll);
  process.on("SIGTERM", () => { killAll(); process.exit(143); });
  process.on("SIGINT", () => { killAll(); process.exit(130); });

  // 1. Private virtual display. The display number is ours inside the
  // lot's temp roots, but a SIGKILLed Xvfb leaves its socket+lock behind —
  // clear that litter first or the next Xvfb refuses a display that looks
  // (falsely) active.
  const x11Socket = `/tmp/.X11-unix/X${display}`;
  try {
    rmSync(x11Socket, { force: true });
  } catch { /* already absent */ }
  try {
    rmSync(`/tmp/.X${display}-lock`, { force: true });
  } catch { /* already absent */ }
  const xvfb = spawn("Xvfb", [`:${display}`, "-screen", "0", "1280x1024x24"], { stdio: "ignore" });
  cleanup.push(xvfb);
  const deadline = Date.now() + 15_000;
  while (!existsSync(x11Socket)) {
    if (Date.now() > deadline) throw new Error("vte-harness: Xvfb did not publish its socket");
    if (xvfb.exitCode !== null) throw new Error(`vte-harness: Xvfb exited early (code ${xvfb.exitCode})`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 2. Real VTE under a private bus. The child's stdin comes from the FIFO
  // (test-driven); its stdout stays on the VTE screen so the emulator sees
  // the relayed queries and answers them for real. The harness itself never
  // opens the FIFO: the test's O_NONBLOCK writer succeeds as soon as bash
  // sits blocked in open-for-read (Linux counts a pending reader), so no
  // byte is ever split between two readers.
  //
  // The private bus runs with AppArmor mediation disabled (fixture-only
  // knob): inside an unprivileged mount namespace the daemon's kernel label
  // query fails (`Failed to query AppArmor policy: Read-only file system`)
  // and the gnome-terminal server never starts. The bus is private and
  // ephemeral; host enforcement is unreachable from the namespace either
  // way. The config is the machine's own session.conf with that single
  // element injected (minimal embedded fallback elsewhere).
  const busConfPath = join(root, `vte-bus-${process.pid}.conf`);
  let busConf = null;
  try {
    const systemConf = readFileSync("/usr/share/dbus-1/session.conf", "utf8");
    if (systemConf.includes("<busconfig>")) {
      busConf = systemConf.replace("<busconfig>", '<busconfig>\n  <apparmor mode="disabled"/>');
    }
  } catch { /* fall through to the embedded minimal config */ }
  busConf ??= `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <apparmor mode="disabled"/>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`;
  writeFileSync(busConfPath, busConf);
  const outFd = openSync(outPath, "a");
  const errFd = openSync(errPath, "a");
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(xdg, "config"),
    XDG_DATA_HOME: join(xdg, "data"),
    XDG_RUNTIME_DIR: mkdtempSync(join(root, "vte-run-")),
    DISPLAY: `:${display}`,
  };
  // Multiplexer: op attach reads the outer-terminal stream on its stdin,
  // which must carry BOTH the test-driven human input (fifo) AND the VTE's
  // answers (pty slave). The shell cannot merge two streams, so a tiny node
  // pump forwards both into a merged fifo that becomes node's stdin — the
  // same merged-stream shape as a production pty attach (and as the
  // deterministic pseudo-VTE tests), where the classifier separates human
  // from reply. node's stdout stays on the VTE screen so the emulator sees
  // the relayed queries and answers for real.
  const muxPath = join(root, `vte-mux-${process.pid}.mjs`);
  writeFileSync(muxPath, `import { constants, openSync, readSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [fifoPath, mergedPath] = process.argv.slice(2);
// The slave may start canonical (line-buffered): answers carry no newline
// and would never surface. Production attach sets raw on its tty stdin;
// the mux owns the slave here, so it does the same. Loud failure: without
// raw mode the test would stall silently.
const stty = spawnSync("stty", ["-F", "/dev/tty", "raw", "-echo"]);
if (stty.status !== 0) {
  process.stderr.write("vte-mux: stty raw failed: " + String(stty.error ?? stty.status) + "\\n");
  process.exit(1);
}
const out = openSync(mergedPath, "w");
let human = openSync(fifoPath, constants.O_RDONLY | constants.O_NONBLOCK);
const tty = openSync("/dev/tty", constants.O_RDONLY | constants.O_NONBLOCK);
const buf = Buffer.alloc(65536);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (;;) {
  let idle = true;
  for (const fd of [human, tty]) {
    let n = -1;
    try {
      n = readSync(fd, buf, 0, buf.length, null);
    } catch (error) {
      if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") continue;
      throw error;
    }
    if (n > 0) {
      writeSync(out, buf.subarray(0, n));
      idle = false;
    } else if (n === 0) {
      // A nonblocking fifo read with no writer yet returns EOF, NOT EAGAIN:
      // the mux opens its read end before the test opens the writer, so a
      // first-poll EOF is the expected rendezvous, never a verdict. Close
      // and re-open (nonblocking: always succeeds) and keep polling for the
      // writer and its bytes. Only the pty leg's EOF ends the pump.
      if (fd === human) {
        try {
          human = openSync(fifoPath, constants.O_RDONLY | constants.O_NONBLOCK);
        } catch (error) {
          if (error.code === "ENOENT") process.exit(0);
          throw error;
        }
      } else process.exit(0);
    }
  }
  if (idle) await sleep(10);
}
`);
  const merged = join(root, `merged-${id}`);
  if (!existsSync(merged)) {
    const mk = spawnSync("mkfifo", [merged]);
    if (mk.status !== 0) throw new Error(`vte-harness: mkfifo merged failed: ${mk.stderr}`);
  }
  const shellCommand = `node ${muxPath} ${fifo} ${merged} >> ${errPath} 2>&1 & exec ${process.execPath} --import ${tsx} ${opTs} attach --id ${id} --socket ${socketPath} < ${merged}`;
  const gnome = spawn(
    "dbus-run-session",
    [`--config-file=${busConfPath}`, "--", "gnome-terminal", "--wait", "--", "bash", "-c", shellCommand],
    { env, stdio: ["ignore", outFd, errFd] },
  );
  cleanup.push(gnome);
  gnome.on("exit", (code) => {
    // Loud on every exit path: the test only sees the FIFO rendezvous, so a
    // silently-dying gnome would surface as an opaque ENXIO timeout. The
    // child's own stdout/stderr live in out/err files that die with the run
    // root — tail them here so the failure cause survives.
    let errTail = "";
    try {
      const content = readFileSync(errPath, "utf8");
      errTail = content.slice(-1500);
    } catch { /* err file missing entirely */ }
    process.stderr.write(`vte-harness: gnome-terminal exited (code ${code}); err tail: ${JSON.stringify(errTail)}\n`);
    killAll();
    process.exitCode = typeof code === "number" ? code : 1;
  });
  gnome.on("error", (error) => {
    process.stderr.write(`vte-harness: gnome-terminal spawn failed: ${error.message}\n`);
    killAll();
    process.exitCode = 1;
  });
  // Stay alive as the session supervisor until gnome-terminal exits.
  await new Promise(() => {});
}

main().catch((error) => {
  process.stderr.write(`vte-harness: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
