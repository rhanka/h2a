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
import { existsSync, mkdirSync, mkdtempSync, openSync } from "node:fs";
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
  return spawnSync("command", ["-v", name], { encoding: "utf8" }).status === 0;
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

  // 1. Private virtual display.
  const x11Socket = `/tmp/.X11-unix/X${display}`;
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
  // opens the FIFO: the test's blocking open rendezvouses with bash's
  // reader, so no byte is ever split between two readers.
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
  const shellCommand = `exec ${process.execPath} --import ${tsx} ${opTs} attach --id ${id} --socket ${socketPath} < ${fifo}`;
  const gnome = spawn(
    "dbus-run-session",
    ["--", "gnome-terminal", "--wait", "--", "bash", "-c", shellCommand],
    { env, stdio: ["ignore", outFd, errFd] },
  );
  cleanup.push(gnome);
  gnome.on("exit", (code) => {
    killAll();
    process.exitCode = typeof code === "number" ? code : 1;
  });
  // Stay alive as the session supervisor until gnome-terminal exits.
  await new Promise(() => {});
}

main().catch((error) => {
  process.stderr.write(`vte-harness: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
