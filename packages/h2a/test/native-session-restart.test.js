import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  executeNativeRestart,
  NativeTerminalHost,
} from "@sentropic/h2a-runtime";

const RUNTIME_BIN = join(process.cwd(), "packages/h2a-runtime/dist/index.js");

function session(id, overrides = {}) {
  return {
    id,
    label: id,
    name: `h2a-${id}`,
    kind: "local-native",
    profile: "claude",
    cwd: `/workspace/${id}`,
    convId: `conv-${id}`,
    sessionClass: "human",
    ...overrides,
  };
}

function live(id) {
  return {
    state: "live",
    generation: "host-generation",
    incarnation: `incarnation-${id}`,
    controlled: false,
  };
}

test("should expose the exact restart CLI grammar in runtime help", () => {
  const result = spawnSync(process.execPath, [RUNTIME_BIN, "restart", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /restart \[options\] \[session\]/);
  assert.match(result.stdout, /--all/);
  assert.match(result.stdout, /--gw <on\|off>/);
  assert.match(result.stdout, /--relaunch-mcp <name>/);
});

test("should restart one native CLI with gateway off when --gw changes its posture", async () => {
  const alpha = session("alpha", { gatewayMode: "gateway" });
  const prepared = [];
  const restarted = [];

  const result = await executeNativeRestart(
    { target: "alpha", gateway: "off" },
    {
      listSessions: () => [alpha],
      snapshot: () => live("alpha"),
      prepare(candidate, snapshot, mode) {
        prepared.push({ id: candidate.id, snapshot, mode });
        return { environment: "opaque-alpha" };
      },
      restart(candidate, snapshot, mode, plan) {
        restarted.push({ id: candidate.id, snapshot, mode, plan });
      },
      drive() {
        throw new Error("gateway-only restart must not inject");
      },
    },
  );

  assert.deepEqual(prepared, [{
    id: "alpha",
    snapshot: live("alpha"),
    mode: "direct",
  }]);
  assert.deepEqual(restarted, [{
    id: "alpha",
    snapshot: live("alpha"),
    mode: "direct",
    plan: { environment: "opaque-alpha" },
  }]);
  assert.deepEqual(result, {
    kind: "h2a.restart.result",
    version: 1,
    ok: true,
    scope: "session",
    sessions: [{
      id: "alpha",
      name: "h2a-alpha",
      requested: "restart",
      state: "completed",
      gatewayMode: "direct",
      restarted: true,
      instructionSubmitted: false,
    }],
  });
});

test("should submit an MCP relaunch instruction to a live CLI without restarting it", async () => {
  const alpha = session("alpha");
  const driven = [];

  const result = await executeNativeRestart(
    { target: "alpha", relaunchMcp: "h2a" },
    {
      listSessions: () => [alpha],
      snapshot: () => live("alpha"),
      prepare() {
        throw new Error("injection-only must not prepare a restart");
      },
      restart() {
        throw new Error("injection-only must not restart the CLI");
      },
      drive(candidate, instruction) {
        driven.push({ id: candidate.id, instruction });
        return "driven";
      },
    },
  );

  assert.equal(driven.length, 1);
  assert.equal(driven[0].id, "alpha");
  assert.match(driven[0].instruction, /Relaunch or attach MCP server "h2a"/);
  assert.doesNotMatch(driven[0].instruction, /[\r\n]/);
  assert.equal(result.ok, true);
  assert.equal(result.sessions[0].requested, "inject");
  assert.equal(result.sessions[0].restarted, false);
  assert.equal(result.sessions[0].instructionSubmitted, true);
});

test("should restart every live managed native CLI and exclude dead, tmux and job rows", async () => {
  const alpha = session("alpha", { gatewayMode: "gateway" });
  const beta = session("beta", { gatewayMode: "direct" });
  const dead = session("dead");
  const tmux = session("tmux", { kind: "local-tmux" });
  const job = session("job", { role: "job" });
  const prepared = [];
  const restarted = [];

  const result = await executeNativeRestart(
    { all: true },
    {
      listSessions: () => [job, beta, dead, tmux, alpha],
      snapshot: (candidate) => candidate.id === "dead" ? { state: "dead" } : live(candidate.id),
      prepare(candidate, _snapshot, mode) {
        prepared.push(`${candidate.id}:${mode}`);
        return { id: candidate.id, mode };
      },
      restart(candidate, _snapshot, mode, plan) {
        restarted.push(`${candidate.id}:${mode}:${plan.id}`);
      },
      drive() {
        throw new Error("restart --all without MCP must not inject");
      },
    },
  );

  assert.deepEqual(prepared, ["alpha:gateway", "beta:direct"]);
  assert.deepEqual(restarted, ["alpha:gateway:alpha", "beta:direct:beta"]);
  assert.equal(result.ok, true);
  assert.equal(result.scope, "all");
  assert.deepEqual(result.sessions.map((row) => row.id), ["alpha", "beta"]);
  assert.deepEqual(result.sessions.map((row) => row.gatewayMode), ["gateway", "direct"]);
});

test("should report completed, failed and untouched sessions after a partial --all failure", async () => {
  const candidates = [session("alpha"), session("beta"), session("gamma")];

  const result = await executeNativeRestart(
    { all: true },
    {
      listSessions: () => candidates,
      snapshot: (candidate) => live(candidate.id),
      prepare: (candidate) => ({ id: candidate.id }),
      restart(candidate) {
        if (candidate.id === "beta") throw new Error("simulated launch refusal");
      },
      drive() {
        throw new Error("not used");
      },
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.sessions.map((row) => ({ id: row.id, state: row.state, failure: row.failure })),
    [
      { id: "alpha", state: "completed", failure: undefined },
      { id: "beta", state: "failed", failure: "restart-failed" },
      { id: "gamma", state: "not-attempted", failure: undefined },
    ],
  );
});

test("should fence an attached CLI stop and leave its native sidecar untouched", () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-restart-host-"));
  const ptys = new Map();
  let nextPid = 70_000;
  const spawner = (options) => {
    const handlers = new Set();
    const pty = {
      pid: nextPid++,
      pgid: nextPid - 1,
      cols: options.cols,
      rows: options.rows,
      write() {},
      resize() {},
      kill(signal) {
        pty.signals.push(signal);
      },
      onData() {
        return { dispose() {} };
      },
      onExit(handler) {
        handlers.add(handler);
        return { dispose: () => handlers.delete(handler) };
      },
      signals: [],
    };
    ptys.set(options.command, pty);
    return pty;
  };

  try {
    const host = new NativeTerminalHost({
      generation: "restart-host-generation",
      replayBytesPerSession: 1024,
      spawner,
      registryPath: join(scratch, "registry.json"),
      readLeaderStartTime: () => 123,
    });
    const create = (id) => host.create({
      id,
      command: id,
      args: [],
      cwd: scratch,
      env: {},
      cols: 80,
      rows: 24,
    });
    const main = create("h2a-alpha");
    create("h2a-alpha.h2a");
    host.acquireController("h2a-alpha", "attached-human");

    assert.throws(
      () => host.stopIfIncarnation("h2a-alpha", "stale-generation", main.incarnation),
      /stale terminal host generation/,
    );
    assert.throws(
      () => host.stopIfIncarnation("h2a-alpha", main.generation, "stale-incarnation"),
      /stale terminal session incarnation/,
    );
    assert.deepEqual(ptys.get("h2a-alpha").signals, []);
    assert.equal(host.state("h2a-alpha").controlled, true);

    const stopped = host.stopIfIncarnation(
      "h2a-alpha",
      main.generation,
      main.incarnation,
      "SIGTERM",
    );
    assert.equal(stopped.status, "stopping");
    assert.equal(stopped.controlled, false);
    assert.deepEqual(ptys.get("h2a-alpha").signals, ["SIGTERM"]);
    assert.deepEqual(ptys.get("h2a-alpha.h2a").signals, []);
    assert.equal(host.state("h2a-alpha.h2a").status, "running");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
