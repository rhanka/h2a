import test from "node:test";
import assert from "node:assert/strict";
import { assertPrivateQualificationPath, nativeQualificationRoot, nativeTestEnvironment,
  spawnSyncIsolatedNative as spawnSync } from "./helpers/native-isolation.js";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const RUNTIME_BIN = join(ROOT, "packages/h2a-runtime/dist/index.js");
const runtimeBuilt = existsSync(RUNTIME_BIN);

function freshFixture() {
  assertPrivateQualificationPath(nativeQualificationRoot, nativeQualificationRoot);
  mkdirSync(nativeQualificationRoot, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(nativeQualificationRoot, "r"));
}

test(
  "restore help documents native and tmux attachment contracts",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const scratch = freshFixture();
    try {
      const result = spawnSync(process.execPath, [RUNTIME_BIN, "restore", "--help"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
      env: nativeTestEnvironment(scratch, { NO_COLOR: "1" })
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
    assert.match(result.stdout, /PTY natif \(défaut\) ou tmux legacy/);
    assert.match(result.stdout, /PTY vivante non\s+contrôlée est rattachée/);
    assert.match(result.stdout, /refuse toujours un\s+second contrôleur concurrent/);
    assert.match(result.stdout, /--profile <name>/);
    assert.match(result.stdout, /--model <model>/);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
);

test(
  "restore dry-run works when tmux is absent",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const scratch = freshFixture();
    const emptyPath = join(scratch, "bin");
    const home = join(scratch, "home");
    const runtime = join(scratch, "run");
    mkdirSync(emptyPath, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    try {
      const result = spawnSync(
        process.execPath,
        [RUNTIME_BIN, "restore", "--dry-run", "--no-gw"],
        {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 30_000,
          env: nativeTestEnvironment(scratch, {
            HOME: home,
            PATH: emptyPath,
            XDG_RUNTIME_DIR: runtime,
            REMOTE_CLI_CONFIG_HOME: scratch,
            NO_COLOR: "1"
          })
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /tmux requis pour restore/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
);

test(
  "restore --profile agy --dry-run prints old->new role-mapped plan and refuses --gw",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const scratch = freshFixture();
    const emptyPath = join(scratch, "bin");
    const home = join(scratch, "home");
    const runtime = join(scratch, "run");
    const cfgDir = join(scratch, ".config", "sentropic", "h2a");
    const cwdBuild = join(home, "src", "app-core");
    const cwdDesign = join(home, "src", "app-design");
    mkdirSync(emptyPath, { recursive: true });
    mkdirSync(cwdBuild, { recursive: true });
    mkdirSync(cwdDesign, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    mkdirSync(cfgDir, { recursive: true });

    const now = new Date().toISOString();
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        layout: {
          maxAgeHours: 48,
          maxPerWindow: 12,
          sharedWindows: 1,
          multiSessionDefault: 0,
          groups: [{ title: "throwaway", projects: ["app-core", "app-design"] }]
        }
      }),
      "utf8"
    );
    writeFileSync(
      join(cfgDir, "registry.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "h-cond",
            label: "h-cond",
            tool: "claude",
            model: "claude-opus-4-8",
            kind: "local-native",
            cwd: cwdBuild,
            convId: "3f2504e0-4f89-41d3-9a0c-0305e82c3310",
            tmuxSession: "h2a-h-cond",
            gatewayMode: "gateway",
            gatewayProvenance: "explicit",
            sessionClass: "human",
            source: "run",
            enrolledAt: now,
            lastSeenAt: now
          },
          {
            id: "h-design",
            label: "h-design",
            tool: "codex",
            model: "gpt-5.6-terra",
            kind: "local-native",
            cwd: cwdDesign,
            convId: "rollout-design-1",
            tmuxSession: "h2a-h-design",
            sessionClass: "human",
            source: "run",
            enrolledAt: now,
            lastSeenAt: now
          }
        ]
      }),
      "utf8"
    );

    const env = nativeTestEnvironment(scratch, {
      HOME: home,
      PATH: emptyPath,
      XDG_RUNTIME_DIR: runtime,
      REMOTE_CLI_CONFIG_HOME: scratch,
      NO_COLOR: "1"
    });

    try {
      // 1. Role-mapped dry-run
      const dry = spawnSync(
        process.execPath,
        [RUNTIME_BIN, "restore", "throwaway", "--profile", "agy", "--dry-run"],
        { cwd: ROOT, encoding: "utf8", timeout: 30_000, env }
      );
      assert.ifError(dry.error);
      assert.equal(dry.status, 0, `${dry.stdout || ""}${dry.stderr || ""}`);
      assert.match(dry.stderr, /claude \(claude-opus-4-8\) -> agy \(gemini-4-neon-high, role: build\/conductor\)/);
      assert.match(dry.stderr, /codex \(gpt-5\.6-terra\) -> agy \(gemini-4-carbon, role: design\)/);
      assert.match(dry.stderr, /--model 'gemini-4-neon-high'/);
      assert.match(dry.stderr, /--model 'gemini-4-carbon'/);
      assert.doesNotMatch(dry.stderr, /--resume '3f2504e0/);
      assert.doesNotMatch(dry.stderr, /--gw\b/);

      // 2. Explicit --model override
      const explicit = spawnSync(
        process.execPath,
        [RUNTIME_BIN, "restore", "throwaway", "--profile", "agy", "--model", "gemini-4-neon-high", "--dry-run"],
        { cwd: ROOT, encoding: "utf8", timeout: 30_000, env }
      );
      assert.ifError(explicit.error);
      assert.equal(explicit.status, 0, `${explicit.stdout || ""}${explicit.stderr || ""}`);
      assert.match(explicit.stderr, /codex \(gpt-5\.6-terra\) -> agy \(gemini-4-neon-high, explicit --model\)/);

      // 3. --profile agy --gw refused
      const badGw = spawnSync(
        process.execPath,
        [RUNTIME_BIN, "restore", "throwaway", "--profile", "agy", "--gw", "--dry-run"],
        { cwd: ROOT, encoding: "utf8", timeout: 30_000, env }
      );
      assert.ifError(badGw.error);
      assert.equal(badGw.status, 1);
      assert.match(badGw.stderr, /--llm-gateway\/--gw is unsupported with --profile agy/);

      // 4. Invalid --profile refused
      const badProfile = spawnSync(
        process.execPath,
        [RUNTIME_BIN, "restore", "throwaway", "--profile", "bogus", "--dry-run"],
        { cwd: ROOT, encoding: "utf8", timeout: 30_000, env }
      );
      assert.ifError(badProfile.error);
      assert.equal(badProfile.status, 1);
      assert.match(badProfile.stderr, /invalid --profile/i);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
);
