import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { deliver, start, provider } = vi.hoisted(() => ({
  deliver: vi.fn(), start: vi.fn(), provider: { version: "2.1.296" },
}));
vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: (file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) =>
    file === 0 ? "qualification brief" : (fs.readFileSync as Function)(file, ...args) };
});
vi.mock("node:child_process", async original => ({
  ...await original<typeof import("node:child_process")>(),
  execFileSync: (command: string, args: string[]) => {
    if (command === "claude" && args.length === 1 && args[0] === "--version") return provider.version;
    throw new Error("unexpected fixture subprocess: " + command);
  },
}));
vi.mock("./tmux.js", async original => ({ ...await original<typeof import("./tmux.js")>(), tmuxAvailable: () => false }));
vi.mock("./central-mcp.js", () => ({ prepareCentralMcpForLaunch: async () => undefined, prepareCentralMcpForRestore: async () => undefined }));
vi.mock("./native-host.js", async original => ({
  ...await original<typeof import("./native-host.js")>(),
  nativeHostAvailable: () => ({ ok: true }), nativeSessionLiveness: () => false,
  preflightNativeLaunch: () => ({ launchFence: true, launchInputFence: true }),
  startNativeSession: start, nativeSessionPid: () => undefined,
  nativePromptDeliveryDeps: () => ({}), killNativeSessionTree: () => true,
}));
vi.mock("./claude-native-driver.js", () => ({ deliverClaudeNativePrompt: deliver }));
vi.mock("./claude-diagnostic.js", () => ({ startClaudeDiagnostic: (dir: string) => ({
  fifo: join(dir, "debug.pipe"), file: join(dir, "debug.log"), healthy: () => true, own() {}, stop() {},
}) }));
vi.mock("./launch-capacity.js", async original => ({
  ...await original<typeof import("./launch-capacity.js")>(),
  acquireLaunchSlot: () => ({ acquired: true }), releaseLaunchSlot() {},
}));
const { main } = await import("./index.js");

let root: string, cli: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dispatch-qualification-"));
  const packageDir = join(root, "node_modules", "@playwright", "mcp");
  mkdirSync(packageDir, { recursive: true });
  cli = join(packageDir, "cli.js");
  writeFileSync(cli, "// Synthetic Playwright entry point; never executed.\n");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@playwright/mcp", version: "0.0.83", bin: { "playwright-mcp": "cli.js" } }));
  vi.stubEnv("REMOTE_CLI_CONFIG_HOME", root);
  vi.stubEnv("H2A_SESSION_HOST", "native");
  vi.stubEnv("H2A_CLAUDE_MCP_CONFIG", join(root, ".mcp.json"));
  vi.stubEnv("H2A_CLAUDE_REQUIRED_MCPS", '["h2a","playwright"]');
  vi.stubEnv("H2A_RUN_LAUNCH_TOKEN", "qualification-fixture");
  vi.stubEnv("LAUNCH_PERF_QUALIFY_DISPATCH", "");
  vi.stubEnv("LAUNCH_PERF_PACING_MS", "");
  provider.version = "2.1.296";
  process.exitCode = 0;
  start.mockReset().mockReturnValue({ name: "h2a-qualified", slug: "qualified" });
  deliver.mockReset().mockResolvedValue({ state: "undelivered", reason: "fixture stopped at driver", waitedMs: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = 0;
  rmSync(root, { recursive: true, force: true });
});

async function launch(playwright: Record<string, unknown>) {
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: {
    h2a: { command: process.execPath, args: [join(root, "h2a.js")] }, playwright,
  } }));
  await main(["node", "h2a", "run", "claude", root, "--name", "qualified", "--prompt-stdin", "--no-attach", "--no-h2a", "--no-gw"]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledTimes(1);
  const options = deliver.mock.calls[0]![3];
  const receipt = JSON.parse(readFileSync(join(root, ".h2a", "runs", "qualified", "launch.json"), "utf8"));
  return { options, receipt };
}

describe.runIf(process.platform === "linux" && process.arch === "x64")("Claude native dispatch qualification", () => {
  for (const command of ["npx", "/fixture/bin/npx"]) {
    it("should retain conservative dispatch and pacing when Playwright uses " + command, async () => {
      const { options, receipt } = await launch({ command, args: ["--yes", "@playwright/mcp@0.0.83"] });
      expect(options.qualifiedDiagnostic).toBe(false);
      expect(options.pacingMs).toBe(250);
      expect(receipt.diagnosticQualified).toBe(false);
    });
  }

  it("should activate fast dispatch and zero pacing for direct pinned Playwright", async () => {
    const { options, receipt } = await launch({ command: process.execPath, args: [cli] });
    expect(options.qualifiedDiagnostic).toBe(true);
    expect(options.pacingMs).toBe(0);
    expect(receipt.diagnosticQualified).toBe(true);
  });

  it("should retain conservative pacing for npx even with the private experiment enabled", async () => {
    for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]) {
      const dir = join(root, ".qual-tmp", key);
      mkdirSync(dir, { recursive: true });
      vi.stubEnv(key, dir);
    }
    writeFileSync(join(root, ".launch-perf-synthetic.json"), "{}");
    vi.stubEnv("H2A_ROOT", root);
    vi.stubEnv("LAUNCH_PERF_QUALIFY_DISPATCH", "1");
    vi.stubEnv("LAUNCH_PERF_PACING_MS", "0");
    const { options } = await launch({ command: "npx", args: ["--yes", "@playwright/mcp@0.0.83"] });
    expect(options.pacingMs).toBe(250);
    expect(options.qualifiedDiagnostic).toBe(false);
  });

  for (const variant of ["unknown-version", "wrong-package", "missing-manifest", "invalid-manifest", "missing-entry", "relative-entry", "node-wrapper", "node-eval"]) {
    it("should retain conservative dispatch and pacing for " + variant + " Playwright", async () => {
      const manifest = join(root, "node_modules", "@playwright", "mcp", "package.json");
      const server: Record<string, unknown> = { command: process.execPath, args: [cli] };
      if (variant === "unknown-version") writeFileSync(manifest, JSON.stringify({ name: "@playwright/mcp", version: "0.0.84", bin: { "playwright-mcp": "cli.js" } }));
      if (variant === "wrong-package") writeFileSync(manifest, JSON.stringify({ name: "other-mcp", version: "0.0.83", bin: { "playwright-mcp": "cli.js" } }));
      if (variant === "missing-manifest") rmSync(manifest);
      if (variant === "invalid-manifest") writeFileSync(manifest, "invalid JSON");
      if (variant === "missing-entry") rmSync(cli);
      if (variant === "relative-entry") server.args = ["node_modules/@playwright/mcp/cli.js"];
      if (variant === "node-wrapper") server.command = join(root, "node-wrapper");
      if (variant === "node-eval") server.args = ["--eval", "import('" + cli + "')"];
      const { options, receipt } = await launch(server);
      expect(options.qualifiedDiagnostic).toBe(false);
      expect(options.pacingMs).toBe(250);
      expect(receipt.diagnosticQualified).toBe(false);
    });
  }

  it("should activate fast dispatch for an explicit stdio command with Playwright arguments", async () => {
    const { options, receipt } = await launch({ type: "stdio", command: process.execPath, args: [cli, "--headless"] });
    expect(options.qualifiedDiagnostic).toBe(true);
    expect(options.pacingMs).toBe(0);
    expect(receipt.diagnosticQualified).toBe(true);
  });

  it("should retain conservative dispatch and pacing for an unknown Claude version", async () => {
    provider.version = "2.1.297";
    const { options, receipt } = await launch({ command: process.execPath, args: [cli] });
    expect(options.qualifiedDiagnostic).toBe(false);
    expect(options.pacingMs).toBe(250);
    expect(receipt.diagnosticQualified).toBe(false);
  });

  it("should retain conservative dispatch and pacing when the required MCP set differs", async () => {
    vi.stubEnv("H2A_CLAUDE_REQUIRED_MCPS", '["playwright"]');
    const { options, receipt } = await launch({ command: process.execPath, args: [cli] });
    expect(options.qualifiedDiagnostic).toBe(false);
    expect(options.pacingMs).toBe(250);
    expect(receipt.diagnosticQualified).toBe(false);
  });
});
