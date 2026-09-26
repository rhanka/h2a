import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
// Updated for L1: the new `h2a_read_payload` tool appears in the help's
// "MCP tools:" line (+18 bytes → 13,202), a legitimate public-surface change.
// Updated for L2: the new `h2a_identity_status` tool joins the same line
// (+21 bytes → 13,223), a legitimate public-surface change.
// Updated for muse-host (4232fc52): the core (runtime-absent) help gains the `muse`
// host. The +36 bytes are entirely in cli.ts `renderCliHelp`: the `|muse` alternative
// on the host setup / host plugin / connect / install-skills usage lines, the "agy and
// muse are poll-only" note, and the `Hosts:` line from CLI_HOSTS. It is NOT the
// cli-help-groups spelling (that lives in h2a-runtime and never reaches the core help),
// and the RUNTIME_VERBS `muse` entry does not affect this stream either.
// Drive consent adds exactly five MCP names (+132 bytes). Removing those names
// recovers the previous 13,259-byte stream and its SHA-256 byte-for-byte.
// Updated for the auto-upgrade redesign (DEC-107, 0.97.8): the `mcp-serve` usage
// line replaces the stale "self-updates + restarts in place" wording (which the
// stdio boot path never did) with the accurate staged-swap / applies-next-launch
// description (+102 bytes), and the `h2a upgrade` line's stale "bare: npm i -g …"
// becomes "bare: non-destructive staged self-update" (+4 bytes). Both are entirely
// in cli.ts `renderCliHelp`; no MCP tool names change.
const CORE_HELP_SHA256 = "0e2f215b3a02d09ce1381b8fdf5f34bc439e79ec6ff15791dcd4a4d9a4ca1cf8";
const RUNTIME_MISSING =
  "ce verbe requiert le runtime h2a (sessions / k8s / tunnel).\n" +
  "  Répare l'installation lockstep : npm i -g @sentropic/h2a@latest\n";

function writeRuntimeLoader(dir) {
  const loader = join(dir, "runtime-loader.mjs");
  writeFileSync(
    loader,
    `import { appendFileSync } from "node:fs";

const mode = process.env.H2A_GOLDEN_RUNTIME_MODE;
const marker = process.env.H2A_GOLDEN_RUNTIME_MARKER;

function missing(message) {
  const error = new Error(message);
  error.code = "ERR_MODULE_NOT_FOUND";
  return error;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@sentropic/h2a-runtime") {
    if (marker) appendFileSync(marker, "runtime\\n");
    if (mode === "missing") throw missing("Cannot find package @sentropic/h2a-runtime");
    if (mode === "incompatible") {
      return {
        shortCircuit: true,
        url: "data:text/javascript," + encodeURIComponent(
          "export const H2A_RUNTIME_CLI_API_VERSION = 2; export async function dispatchH2a() { return 99; }"
        )
      };
    }
    if (mode === "transitive-missing") {
      return {
        shortCircuit: true,
        url: "data:text/javascript," + encodeURIComponent("import 'h2a-golden-transitive-missing';")
      };
    }
  }
  if (specifier === "h2a-golden-transitive-missing") {
    throw missing("Cannot find package h2a-golden-transitive-missing");
  }
  return nextResolve(specifier, context);
}
`,
    "utf8"
  );
  return loader;
}

function runBinary(args, mode) {
  const sandbox = mkdtempSync(join(tmpdir(), "h2a-dispatch-golden-"));
  try {
    const marker = join(sandbox, "runtime-imports.log");
    const loader = writeRuntimeLoader(sandbox);
    const result = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-loader", loader, BIN, ...args],
      {
        cwd: sandbox,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: sandbox,
          H2A_ROOT: join(sandbox, "bus"),
          REMOTE_CLI_CONFIG_HOME: sandbox,
          H2A_GOLDEN_RUNTIME_MODE: mode,
          H2A_GOLDEN_RUNTIME_MARKER: marker
        }
      }
    );
    assert.equal(result.error, undefined, result.error?.message);
    return {
      exit: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      runtimeImported: existsSync(marker),
      configHomeCreated: existsSync(join(sandbox, ".config", "sentropic"))
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function assertCoreHelp(result) {
  assert.equal(result.exit, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.runtimeImported, false);
  assert.equal(result.configHomeCreated, false);
  // A SHA-256 commitment is an exact, compact golden for the help stream; the
  // durable report records this value and its byte length.
  assert.equal(createHash("sha256").update(result.stdout).digest("hex"), CORE_HELP_SHA256);
  // 13,391 + 102 (mcp-serve wording) + 4 (h2a upgrade wording) for DEC-107 (0.97.8).
  assert.equal(Buffer.byteLength(result.stdout), 13497);
}

function assertMissingRuntime(result, firstToken) {
  assert.deepEqual(result, {
    exit: 127,
    stdout: "",
    stderr: `h2a ${firstToken}: ${RUNTIME_MISSING}`,
    runtimeImported: true,
    configHomeCreated: false
  });
}

test("binary golden: core help spellings stay local with the runtime absent", () => {
  for (const args of [["help"], ["--help"], ["-h"]]) {
    assertCoreHelp(runBinary(args, "missing"));
  }
});

test("binary golden: bare h2a remains core help with the runtime absent", () => {
  assertCoreHelp(runBinary([], "missing"));
});

test("binary golden: run help spellings attempt the lazy runtime before help", () => {
  assertMissingRuntime(runBinary(["run", "--help"], "missing"), "run");
  assertMissingRuntime(runBinary(["run", "-h"], "missing"), "run");
});

test("binary golden: selector-less run and frozen --resume take the broad loader bucket", () => {
  assertMissingRuntime(runBinary(["run"], "missing"), "run");
  assertMissingRuntime(runBinary(["--resume"], "missing"), "--resume");
});

test("binary golden: leading options and terminators are runtime-routed", () => {
  assertMissingRuntime(runBinary(["--root", "/isolated", "status"], "missing"), "--root");
  assertMissingRuntime(runBinary(["--"], "missing"), "--");
  assertMissingRuntime(runBinary(["-hv"], "missing"), "-hv");
});

test("binary golden: loader ambiguity is pinned separately from API incompatibility", () => {
  assert.deepEqual(runBinary(["run"], "incompatible"), {
    exit: 64,
    stdout: "",
    stderr:
      "h2a run: runtime incompatible — runtime CLI API 2 is incompatible; expected 1.\n" +
      "  Mets à jour l'installation lockstep : h2a upgrade\n",
    runtimeImported: true,
    configHomeCreated: false
  });
  assertMissingRuntime(runBinary(["run"], "transitive-missing"), "run");
});

test("parser golden: runtime routing keeps run, leading options, and terminators out of core", async () => {
  const { shouldDispatchRuntime } = await import("../dist/bin-routing.js");
  for (const argv of [
    ["run"],
    ["run", "notacli"],
    ["--resume"],
    ["--root", "/isolated", "status"],
    ["--"],
    ["-hv"]
  ]) {
    assert.equal(shouldDispatchRuntime(argv), true, argv.join(" "));
  }
});

test("parser golden: every Track facade verb remains core-routed", async () => {
  const { shouldDispatchRuntime } = await import("../dist/bin-routing.js");
  const { TRACK_FACADE_VERBS } = await import("../dist/cli.js");
  for (const verb of TRACK_FACADE_VERBS) {
    assert.equal(shouldDispatchRuntime([verb]), false, verb);
  }
});

test("source-trace golden: unknown run selector remains an unvalidated executable fallback", () => {
  const runtime = readFileSync(join(REPO_ROOT, "packages", "h2a-runtime", "src", "index.ts"), "utf8");
  const tmux = readFileSync(join(REPO_ROOT, "packages", "h2a-runtime", "src", "tmux.ts"), "utf8");
  const nativeHost = readFileSync(join(REPO_ROOT, "packages", "h2a-runtime", "src", "native-host.ts"), "utf8");

  assert.match(runtime, /function localCliCommand\(profile: string\): string \{\s*return LOCAL_CLI\[profile\] \?\? profile;/);
  assert.match(runtime, /\.command\("run <profile> \[path\]"\)/);
  assert.match(runtime, /\.command\("run <profile> \[path\]"\)(?:(?!\.command\()[\s\S])*?const command = localCliCommand\(profile\);/);
  assert.match(runtime, /\.command\("run <profile> \[path\]"\)(?:(?!\.command\()[\s\S])*?enrollFromRun\(\{\s*profile,/);
  assert.match(tmux, /if \[ -t 0 \]; then exec \/bin\/bash -l; else exit "\$code"; fi/);
  assert.match(nativeHost, /if \(opts\.tmux === true\) return "local-tmux";/);
  assert.match(nativeHost, /return "native";/);
});
