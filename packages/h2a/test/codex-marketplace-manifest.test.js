import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const marketplace = JSON.parse(readFileSync(join(REPO_ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));

test("the repository root exposes the h2a Codex marketplace", () => {
  assert.equal(marketplace.name, "sentropic");
  assert.equal(marketplace.interface.displayName, "Sentropic");
  assert.deepEqual(marketplace.plugins, [
    {
      name: "h2a",
      source: { source: "local", path: "./packages/h2a" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity"
    }
  ]);

  const pluginDir = resolve(REPO_ROOT, marketplace.plugins[0].source.path);
  assert.ok(existsSync(join(pluginDir, ".codex-plugin", "plugin.json")));
});
