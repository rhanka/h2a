import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const RUNTIME_BIN = join(ROOT, "packages/h2a-runtime/dist/index.js");
const runtimeBuilt = existsSync(RUNTIME_BIN);

test(
  "restore help documents native and tmux attachment contracts",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const result = spawnSync(process.execPath, [RUNTIME_BIN, "restore", "--help"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: "1" }
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
    assert.match(result.stdout, /PTY natif \(défaut\) ou tmux legacy/);
    assert.match(result.stdout, /PTY vivante non\s+contrôlée est rattachée/);
    assert.match(result.stdout, /refuse toujours un\s+second contrôleur concurrent/);
  }
);

test(
  "restore dry-run works when tmux is absent",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const scratch = mkdtempSync(join(tmpdir(), "h2a-restore-no-tmux-"));
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
          env: {
            ...process.env,
            HOME: home,
            PATH: emptyPath,
            XDG_RUNTIME_DIR: runtime,
            REMOTE_CLI_CONFIG_HOME: scratch,
            NO_COLOR: "1"
          }
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
