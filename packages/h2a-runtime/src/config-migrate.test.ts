import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateConfigHomeIfNeeded, resolveConfigDir } from "./config.js";

// ②b — config home migration remote-cli/ -> h2a/ with compat symlink + backup.
describe("migrateConfigHomeIfNeeded", () => {
  let home: string;
  let sentropic: string;
  const prev = process.env.REMOTE_CLI_CONFIG_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "h2a-cfg-"));
    process.env.REMOTE_CLI_CONFIG_HOME = home;
    sentropic = join(home, ".config", "sentropic");
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
    else process.env.REMOTE_CLI_CONFIG_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  function seedLegacy(): void {
    mkdirSync(join(sentropic, "remote-cli"), { recursive: true });
    writeFileSync(join(sentropic, "remote-cli", "registry.json"), '{"sessions":{"a":1}}', "utf8");
  }

  it("migrates: backup + move to h2a/ + compat symlink remote-cli -> h2a", () => {
    seedLegacy();
    const r = migrateConfigHomeIfNeeded(1234);
    expect(r.migrated).toBe(true);

    // data now lives at h2a/
    expect(existsSync(join(sentropic, "h2a", "registry.json"))).toBe(true);
    expect(readFileSync(join(sentropic, "h2a", "registry.json"), "utf8")).toContain('"sessions"');

    // remote-cli is a compat symlink (legacy `remote` bin reads the SAME state)
    expect(lstatSync(join(sentropic, "remote-cli")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(sentropic, "remote-cli", "registry.json"), "utf8")).toContain('"sessions"');

    // timestamped backup kept
    expect(existsSync(join(sentropic, "remote-cli.bak.1234", "registry.json"))).toBe(true);

    // canonical dir is now h2a/
    expect(resolveConfigDir()).toBe(join(sentropic, "h2a"));
  });

  it("is idempotent: second call is a no-op once h2a/ exists", () => {
    seedLegacy();
    expect(migrateConfigHomeIfNeeded(1).migrated).toBe(true);
    const again = migrateConfigHomeIfNeeded(2);
    expect(again.migrated).toBe(false);
    expect(again.reason).toMatch(/canonical already exists/);
    // no second backup
    expect(existsSync(join(sentropic, "remote-cli.bak.2"))).toBe(false);
  });

  it("no legacy dir → no-op, resolveConfigDir falls back to legacy path", () => {
    const r = migrateConfigHomeIfNeeded(1);
    expect(r.migrated).toBe(false);
    expect(r.reason).toMatch(/no legacy config dir/);
    expect(resolveConfigDir()).toBe(join(sentropic, "remote-cli"));
  });
});
