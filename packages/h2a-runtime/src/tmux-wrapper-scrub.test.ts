/**
 * Round-2 P2: the routing-var purge must happen at the LAST point before the
 * CLI exec — after login/init scripts run. A stale tmux server env or a login
 * script can re-export ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN after the early
 * `env -u` prefix; the wrapper prologue (gated by H2A_DIRECT_ROUTING_SCRUB)
 * removes them again, while a user-owned ANTHROPIC_API_KEY survives.
 *
 * These tests run the REAL wrapper strings as real `bash -lc` children with a
 * fixture HOME whose .bash_profile re-exports routing vars (the reviewer's
 * "entirely fictitious init"). No tmux server, no gateway, no owner state.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  DIRECT_ROUTING_SCRUB_ENV,
  HEADLESS_WRAPPER,
  LOCAL_WRAPPER,
  STRUCTURED_LOCAL_WRAPPER,
  stampDirectRoutingScrub,
  tmuxEnvironmentArgs,
} from "./tmux.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "h2a-wrapper-scrub-"));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** Fixture HOME whose login script re-exports stale gateway routing vars. */
function pollutedHome(): string {
  const home = mkdtempSync(join(SCRATCH, "home-"));
  writeFileSync(
    join(home, ".bash_profile"),
    "export ANTHROPIC_BASE_URL=http://127.0.0.1:3002\nexport ANTHROPIC_AUTH_TOKEN=stale-bearer\n",
    "utf8",
  );
  return home;
}

function cleanHome(): string {
  const home = mkdtempSync(join(SCRATCH, "clean-home-"));
  writeFileSync(join(home, ".bash_profile"), "");
  return home;
}

const BASE_ENV = { PATH: "/usr/bin:/bin" } as const;

function runBash(
  args: readonly string[],
  env: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  // Login bash can replace HOME via /etc/profile. Source the fictitious init
  // explicitly after that step so the contamination witness is deterministic.
  const r = spawnSync("/bin/bash", [args[0]!, `. "$H2A_TEST_INIT"\n${args[1]}`, ...args.slice(2)], {
    encoding: "utf8",
    env: { ...BASE_ENV, ...env, H2A_TEST_INIT: join(env.HOME!, ".bash_profile") },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("CLI wrappers scrub post-init routing vars on direct launches", () => {
  it("the init fixture really contaminates an unguarded child", () => {
    const out = runBash(["-lc", 'exec "$0"', "printenv"], {
      HOME: pollutedHome(),
      ANTHROPIC_API_KEY: "native-key-fixture",
    });
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^ANTHROPIC_BASE_URL=http:\/\/127.0.0.1:3002$/m);
    expect(out.stdout).toMatch(/^ANTHROPIC_AUTH_TOKEN=stale-bearer$/m);
  });
  it("LOCAL_WRAPPER drops login-script routing vars but keeps the native key", () => {
    const out = runBash(["-lc", LOCAL_WRAPPER, "relaunch-hint", "printenv"], {
      HOME: pollutedHome(),
      [DIRECT_ROUTING_SCRUB_ENV]: "1",
      ANTHROPIC_API_KEY: "native-key-fixture",
    });

    expect(out.status).toBe(0);
    expect(out.stdout).not.toMatch(/^ANTHROPIC_BASE_URL=/m);
    expect(out.stdout).not.toMatch(/^ANTHROPIC_AUTH_TOKEN=/m);
    expect(out.stdout).toMatch(/^ANTHROPIC_API_KEY=native-key-fixture$/m);
  });

  it("STRUCTURED_LOCAL_WRAPPER drops login-script routing vars but keeps the native key", () => {
    const out = runBash(["-lc", STRUCTURED_LOCAL_WRAPPER, "printenv"], {
      HOME: pollutedHome(),
      [DIRECT_ROUTING_SCRUB_ENV]: "1",
      ANTHROPIC_API_KEY: "native-key-fixture",
    });

    expect(out.status).toBe(0);
    expect(out.stdout).not.toMatch(/^ANTHROPIC_BASE_URL=/m);
    expect(out.stdout).not.toMatch(/^ANTHROPIC_AUTH_TOKEN=/m);
    expect(out.stdout).toMatch(/^ANTHROPIC_API_KEY=native-key-fixture$/m);
  });

  it("HEADLESS_WRAPPER drops login-script routing vars from the child log", () => {
    const dir = mkdtempSync(join(SCRATCH, "headless-"));
    const result = join(dir, "result.json");
    const log = join(dir, "output.log");
    const out = runBash(
      ["-lc", HEADLESS_WRAPPER, result, log, "", "printenv"],
      {
        HOME: pollutedHome(),
        [DIRECT_ROUTING_SCRUB_ENV]: "1",
        ANTHROPIC_API_KEY: "native-key-fixture",
      },
    );

    expect(out.status).toBe(0);
    const logged = readFileSync(log, "utf8");
    expect(logged).not.toMatch(/^ANTHROPIC_BASE_URL=/m);
    expect(logged).not.toMatch(/^ANTHROPIC_AUTH_TOKEN=/m);
    expect(logged).toMatch(/^ANTHROPIC_API_KEY=native-key-fixture$/m);
  });

  it("gateway launches override an inherited direct stamp and keep their provisioned env", () => {
    const env = {
      HOME: cleanHome(),
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-token-fixture",
      [DIRECT_ROUTING_SCRUB_ENV]: "1",
    };
    stampDirectRoutingScrub(env);
    const out = runBash(["-lc", LOCAL_WRAPPER, "relaunch-hint", "printenv"], env);

    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^ANTHROPIC_BASE_URL=http:\/\/localhost:3002$/m);
    expect(out.stdout).toMatch(/^ANTHROPIC_AUTH_TOKEN=gw-token-fixture$/m);
  });
});

describe("direct-scrub sentinel stamping", () => {
  it("tmuxEnvironmentArgs stamps the sentinel on direct launches", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    expect(tmuxEnvironmentArgs("human")).toContain(
      `${DIRECT_ROUTING_SCRUB_ENV}=1`,
    );
  });

  it("tmuxEnvironmentArgs overrides an inherited direct sentinel on gateway launches", () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "gw-token-fixture";
    try {
      const args = tmuxEnvironmentArgs("human");
      expect(args).toContain(`${DIRECT_ROUTING_SCRUB_ENV}=0`);
      expect(args).toContain("ANTHROPIC_BASE_URL=http://localhost:3002");
    } finally {
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    }
  });

  it("stampDirectRoutingScrub only stamps direct env records", () => {
    const direct: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: "native-key",
    };
    stampDirectRoutingScrub(direct);
    expect(direct[DIRECT_ROUTING_SCRUB_ENV]).toBe("1");

    const gateway: Record<string, string | undefined> = {
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-token",
      [DIRECT_ROUTING_SCRUB_ENV]: "1",
    };
    stampDirectRoutingScrub(gateway);
    expect(gateway[DIRECT_ROUTING_SCRUB_ENV]).toBe("0");
  });
});
