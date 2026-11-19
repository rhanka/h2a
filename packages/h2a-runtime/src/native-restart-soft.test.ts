import { createServer, type Server } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; never shipped in the runtime.
import { createPrivateTestDirectory, setupNativeTestEnvironment } from "../../h2a/test/helpers/native-isolation.js";
import {
  acquireLlmMeshSessionEnv,
  checkLocalGatewayModels,
  replaceAnthropicGatewayEnvironment,
} from "./gateway-host/daemon.js";
import {
  isRestartPromptAlive,
  NativeHostSoftRespawnUnsupportedError,
} from "./native-host.js";
import {
  executeNativeRestart,
  formatNativeRestartTable,
  NativeRestartError,
  type NativeRestartCandidate,
  type NativeRestartSnapshot,
} from "./native-restart.js";
import { NativeTerminalHost } from "./native-terminal/host.js";
import { runNativeTerminalOp } from "./native-terminal/op.js";
import { NATIVE_TERMINAL_PROTOCOL_VERSION } from "./native-terminal/protocol.js";
import { startNativeTerminalHostServer } from "./native-terminal/server.js";
import type { PtyHandle, PtySpawner } from "./pty.js";
import { enrollFromRun, loadRegistry } from "./registry.js";

setupNativeTestEnvironment(afterAll);

const servers: Server[] = [];
const netServers: NetServer[] = [];
const extraCleanups: Array<() => Promise<void> | void> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const cleanup of extraCleanups.splice(0).reverse()) {
    await cleanup();
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const server of netServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function startFakeGateway(options: {
  models: Array<{ id: string }>;
  modelsStatus?: number;
}) {
  let tokenCounter = 0;
  const sessionCalls: Array<{ clientSessionId?: string; sessionId?: string }> = [];
  const modelsHeaders: Array<{ xApiKey?: string; authorization?: string }> = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/v1/session") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const parsed = body ? JSON.parse(body) as { clientSessionId?: string; sessionId?: string } : {};
        sessionCalls.push(parsed);
        tokenCounter += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ gatewayToken: `fake-gw-token-${parsed.clientSessionId ?? "anon"}-${tokenCounter}` }));
      });
      return;
    }
    if (req.method === "GET" && url === "/v1/models") {
      modelsHeaders.push({
        ...(typeof req.headers["x-api-key"] === "string" ? { xApiKey: req.headers["x-api-key"] } : {}),
        ...(typeof req.headers["authorization"] === "string" ? { authorization: req.headers["authorization"] } : {}),
      });
      const status = options.modelsStatus ?? 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: options.models }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected tcp address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    sessionCalls,
    modelsHeaders,
  };
}

function candidate(id: string, overrides: Partial<NativeRestartCandidate> = {}): NativeRestartCandidate {
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

function live(id: string): Extract<NativeRestartSnapshot, { state: "live" }> {
  return {
    state: "live",
    generation: "host-gen-1",
    incarnation: `inc-${id}`,
    controlled: true,
    socketPath: "/run/fake/host.sock",
  };
}

describe("checkLocalGatewayModels", () => {
  it("succeeds when /v1/models serves at least one model and fails visibly when empty", async () => {
    const populated = await startFakeGateway({ models: [{ id: "fake-sonnet" }] });
    const ok = await checkLocalGatewayModels({ baseUrl: populated.baseUrl, token: "secret-tok-1" });
    expect(ok).toEqual({ ok: true, baseUrl: populated.baseUrl, modelCount: 1 });
    expect(populated.modelsHeaders).toHaveLength(1);
    expect(populated.modelsHeaders[0]!.xApiKey).toBe("secret-tok-1");

    const empty = await startFakeGateway({ models: [] });
    const bad = await checkLocalGatewayModels({ baseUrl: empty.baseUrl, token: "secret-tok-2" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toMatch(/\/v1\/models/i);
      expect(bad.reason).not.toContain("secret-tok-2");
    }

    const down = await startFakeGateway({ models: [{ id: "x" }], modelsStatus: 503 });
    const bad503 = await checkLocalGatewayModels({ baseUrl: down.baseUrl, token: "secret-tok-3" });
    expect(bad503.ok).toBe(false);
    if (!bad503.ok) {
      expect(bad503.reason).toContain("503");
      expect(bad503.reason).not.toContain("secret-tok-3");
    }
  });
});

describe("executeNativeRestart --soft and --all controls", () => {
  it("fails visibly before touching any session when --gw on sees empty /v1/models", async () => {
    const gw = await startFakeGateway({ models: [] });
    const touched: string[] = [];

    await expect(
      executeNativeRestart(
        { all: true, gateway: "on", soft: true },
        {
          listSessions: () => [candidate("alpha"), candidate("beta")],
          snapshot: (s) => live(s.id),
          checkGatewayModels: async () => {
            const check = await checkLocalGatewayModels({ baseUrl: gw.baseUrl, token: "probe-tok" });
            if (!check.ok) throw new Error(check.reason);
          },
          prepare: (s) => { touched.push(`prepare:${s.id}`); return {}; },
          restart: (s) => { touched.push(`hard:${s.id}`); },
          softRestart: (s) => { touched.push(`soft:${s.id}`); },
          drive: () => "driven",
        },
      ),
    ).rejects.toSatisfy((error: unknown) =>
      error instanceof NativeRestartError &&
      error.code === "gateway-models-unavailable" &&
      /\/v1\/models/i.test(error.message),
    );
    expect(touched).toEqual([]);
  });

  it("refuses --soft with host-soft-restart-unsupported on an old host unless --allow-hard is passed", async () => {
    const hardCalls: string[] = [];
    const oldHostError = () => new NativeHostSoftRespawnUnsupportedError({
      generation: "legacy-gen",
      socketPath: "/run/fake/legacy.sock",
    });

    const refused = await executeNativeRestart(
      { target: "alpha", gateway: "on", soft: true },
      {
        listSessions: () => [candidate("alpha")],
        snapshot: () => live("alpha"),
        checkGatewayModels: async () => {},
        prepare: () => ({}),
        softRestart: () => { throw oldHostError(); },
        restart: (s) => { hardCalls.push(s.id); },
        drive: () => "driven",
      },
    );
    expect(refused.ok).toBe(false);
    expect(hardCalls).toEqual([]);
    expect(refused.sessions[0]!.state).toBe("failed");
    expect(refused.sessions[0]!.failure).toBe("host-soft-restart-unsupported");

    const fallback = await executeNativeRestart(
      { target: "alpha", gateway: "on", soft: true, allowHard: true },
      {
        listSessions: () => [candidate("alpha")],
        snapshot: () => live("alpha"),
        checkGatewayModels: async () => {},
        prepare: () => ({}),
        softRestart: () => { throw oldHostError(); },
        restart: (s) => { hardCalls.push(s.id); },
        healthCheck: () => ({ ok: true }),
        drive: () => "driven",
      },
    );
    expect(fallback.ok).toBe(true);
    expect(hardCalls).toEqual(["alpha"]);
    expect(fallback.sessions[0]!.state).toBe("completed");
    expect(fallback.sessions[0]!.strategy).toBe("hard-fallback");
    expect(fallback.sessions[0]!.ptyPreserved).toBe(false);
  });

  it("rejects --allow-hard without --soft", async () => {
    await expect(
      executeNativeRestart(
        { target: "alpha", allowHard: true },
        {
          listSessions: () => [candidate("alpha")],
          snapshot: () => live("alpha"),
          prepare: () => ({}),
          restart: () => {},
          drive: () => "driven",
        },
      ),
    ).rejects.toSatisfy((error: unknown) =>
      error instanceof NativeRestartError && error.code === "invalid-request",
    );
  });

  it("skips hosts without a gateway lever (codex, agy, muse, vibe) with named reason no-gateway-lever", async () => {
    const restarted: string[] = [];
    const result = await executeNativeRestart(
      { all: true, gateway: "on", soft: true },
      {
        listSessions: () => [
          candidate("a-claude", { profile: "claude", gatewayMode: "direct" }),
          candidate("b-codex", { profile: "codex" }),
          candidate("c-agy", { profile: "agy" }),
          candidate("d-muse", { profile: "muse" }),
          candidate("e-vibe", { profile: "vibe" }),
        ],
        snapshot: (s) => live(s.id),
        checkGatewayModels: async () => {},
        prepare: (s) => ({ id: s.id }),
        softRestart: (s) => { restarted.push(s.id); },
        restart: () => { throw new Error("must not hard-restart"); },
        healthCheck: () => ({ ok: true }),
        drive: () => "driven",
      },
    );

    expect(result.ok).toBe(true);
    expect(restarted).toEqual(["a-claude"]);
    expect(
      result.sessions.map((r) => ({ id: r.id, host: r.host, state: r.state, skipReason: r.skipReason })),
    ).toEqual([
      { id: "a-claude", host: "claude", state: "completed", skipReason: undefined },
      { id: "b-codex", host: "codex", state: "skipped", skipReason: "no-gateway-lever" },
      { id: "c-agy", host: "agy", state: "skipped", skipReason: "no-gateway-lever" },
      { id: "d-muse", host: "muse", state: "skipped", skipReason: "no-gateway-lever" },
      { id: "e-vibe", host: "vibe", state: "skipped", skipReason: "no-gateway-lever" },
    ]);
  });

  it("runs --all sequentially with per-session health checks, stops on first failure unless --continue, and skips self unless --include-self", async () => {
    const events: string[] = [];
    const sessions = [
      candidate("gamma", { gatewayMode: "direct" }),
      candidate("alpha", { gatewayMode: "direct" }),
      candidate("self", { gatewayMode: "direct" }),
      candidate("beta", { gatewayMode: "gateway", gatewayProvenance: "explicit" }),
    ];

    const stopped = await executeNativeRestart(
      { all: true, gateway: "on", soft: true, currentSession: "h2a-self" },
      {
        listSessions: () => sessions,
        snapshot: (s) => live(s.id),
        checkGatewayModels: async () => { events.push("models"); },
        prepare: (s) => { events.push(`prepare:${s.id}`); return {}; },
        softRestart: (s) => { events.push(`soft:${s.id}`); },
        restart: () => { throw new Error("must not hard restart"); },
        healthCheck: (s) => {
          events.push(`health:${s.id}`);
          return s.id === "beta" ? { ok: false, reason: "prompt did not appear" } : { ok: true };
        },
        drive: () => "driven",
      },
    );

    expect(stopped.ok).toBe(false);
    // Strict sequential order: alpha soft -> alpha health -> beta soft -> beta health -> stop before gamma
    expect(events).toEqual([
      "models",
      "prepare:alpha",
      "prepare:beta",
      "prepare:gamma",
      "soft:alpha",
      "health:alpha",
      "soft:beta",
      "health:beta",
    ]);
    expect(
      stopped.sessions.map((r) => ({ id: r.id, state: r.state, failure: r.failure, skipReason: r.skipReason })),
    ).toEqual([
      { id: "alpha", state: "completed", failure: undefined, skipReason: undefined },
      { id: "beta", state: "failed", failure: "health-check-failed", skipReason: undefined },
      { id: "gamma", state: "not-attempted", failure: undefined, skipReason: undefined },
      { id: "self", state: "skipped", failure: undefined, skipReason: "self-session" },
    ]);

    // Now with --continue and --include-self
    const continuedEvents: string[] = [];
    const continued = await executeNativeRestart(
      { all: true, gateway: "on", soft: true, currentSession: "h2a-self", continueOnError: true, includeSelf: true },
      {
        listSessions: () => sessions,
        snapshot: (s) => live(s.id),
        checkGatewayModels: async () => {},
        prepare: () => ({}),
        softRestart: (s) => { continuedEvents.push(`soft:${s.id}`); },
        restart: () => {},
        healthCheck: (s) => {
          continuedEvents.push(`health:${s.id}`);
          return s.id === "beta" ? { ok: false, reason: "prompt did not appear" } : { ok: true };
        },
        drive: () => "driven",
      },
    );

    expect(continued.ok).toBe(false);
    expect(continuedEvents).toEqual([
      "soft:alpha", "health:alpha",
      "soft:beta", "health:beta",
      "soft:gamma", "health:gamma",
      "soft:self", "health:self",
    ]);
    expect(continued.sessions.map((r) => ({ id: r.id, state: r.state }))).toEqual([
      { id: "alpha", state: "completed" },
      { id: "beta", state: "failed" },
      { id: "gamma", state: "completed" },
      { id: "self", state: "completed" },
    ]);
  });

  it("supports --dry-run without mutating anything and formats the final table", async () => {
    const sideEffects: string[] = [];
    const result = await executeNativeRestart(
      { all: true, gateway: "on", soft: true, dryRun: true, currentSession: "h2a-self" },
      {
        listSessions: () => [
          candidate("alpha", { profile: "claude", gatewayMode: "direct" }),
          candidate("codex-1", { profile: "codex" }),
          candidate("self", { profile: "claude", gatewayMode: "gateway", gatewayProvenance: "explicit" }),
        ],
        snapshot: (s) => live(s.id),
        checkGatewayModels: async () => {},
        prepare: () => { sideEffects.push("prepare"); return {}; },
        softRestart: () => { sideEffects.push("soft"); },
        restart: () => { sideEffects.push("hard"); },
        healthCheck: () => { sideEffects.push("health"); return { ok: true }; },
        drive: () => { sideEffects.push("drive"); return "driven"; },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(sideEffects).toEqual([]);
    expect(result.sessions.map((r) => ({ id: r.id, state: r.state, skipReason: r.skipReason }))).toEqual([
      { id: "alpha", state: "dry-run", skipReason: undefined },
      { id: "codex-1", state: "skipped", skipReason: "no-gateway-lever" },
      { id: "self", state: "skipped", skipReason: "self-session" },
    ]);

    const table = formatNativeRestartTable(result);
    expect(table).toContain("SESSION");
    expect(table).toContain("HOST");
    expect(table).toContain("GW");
    expect(table).toContain("RESULT");
    expect(table).toContain("alpha");
    expect(table).toContain("off → on");
    expect(table).toContain("dry-run");
    expect(table).toContain("codex-1");
    expect(table).toContain("no-gateway-lever");
    expect(table).toContain("self-session");
  });

  it("injects fresh per-session gateway tokens on --gw on, removes them on --gw off, persists registry provenance, and proves op.ts old-host refusal", async () => {
    const gw = await startFakeGateway({ models: [{ id: "fake-claude-model" }] });
    const privDir = createPrivateTestDirectory("e2e");
    tempDirs.push(privDir);
    const configDir = mkdtempSync(join(tmpdir(), "h2a-gw-cfg-"));
    tempDirs.push(configDir);
    const prevConfigHome = process.env["REMOTE_CLI_CONFIG_HOME"];
    process.env["REMOTE_CLI_CONFIG_HOME"] = configDir;
    extraCleanups.push(() => {
      if (prevConfigHome === undefined) delete process.env["REMOTE_CLI_CONFIG_HOME"];
      else process.env["REMOTE_CLI_CONFIG_HOME"] = prevConfigHome;
    });

    // Point local gateway metadata at our fake loopback HTTP server.
    writeFileSync(
      join(configDir, "llm-mesh-token.json"),
      JSON.stringify({ baseUrl: gw.baseUrl, pid: process.pid }),
      { mode: 0o600 },
    );

    // Fake PTY spawner wired into a real NativeTerminalHostServer over Unix socket.
    let nextPid = 92_000;
    const spawnedBySession = new Map<string, Array<{
      pid: number;
      env: Readonly<Record<string, string>>;
      args: ReadonlyArray<string>;
      emitData(chunk: string): void;
    }>>();
    const spawner: PtySpawner = (options) => {
      const pid = nextPid++;
      const dataHandlers = new Set<(chunk: string) => void>();
      const exitHandlers = new Set<(event: { exitCode: number; signal?: number }) => void>();
      let exited = false;
      const pty: PtyHandle = {
        pid,
        pgid: pid,
        cols: options.cols,
        rows: options.rows,
        write() {},
        resize() {},
        kill() {
          queueMicrotask(() => {
            if (exited) return;
            exited = true;
            for (const h of [...exitHandlers]) h({ exitCode: 0, signal: 15 });
          });
        },
        onData(handler) {
          dataHandlers.add(handler);
          return { dispose: () => dataHandlers.delete(handler) };
        },
        onExit(handler) {
          exitHandlers.add(handler);
          return { dispose: () => exitHandlers.delete(handler) };
        },
      };
      const sessionKey = options.env["H2A_NATIVE_PTY_SESSION"] ?? "unknown";
      const list = spawnedBySession.get(sessionKey) ?? [];
      const rec = {
        pid,
        env: options.env,
        args: options.args,
        emitData(chunk: string) {
          for (const h of [...dataHandlers]) h(chunk);
        },
      };
      list.push(rec);
      spawnedBySession.set(sessionKey, list);
      return pty;
    };

    const registryPath = join(privDir, "registry.json");
    writeFileSync(registryPath, JSON.stringify({ version: 1, entries: [] }));
    const socketPath = join(privDir, "host.sock");
    const host = new NativeTerminalHost({
      generation: "gen-e2e",
      replayBytesPerSession: 8192,
      spawner,
      socketPath,
      registryPath,
      readLeaderStartTime: () => 555,
    });
    const hostServer = await startNativeTerminalHostServer({ socketPath, host });
    extraCleanups.push(() => hostServer.close());

    // Create two live Claude sessions inside the fake host + enroll them in registry.
    const alpha0 = host.create({
      id: "h2a-alpha",
      command: "claude",
      args: ["--resume", "conv-alpha"],
      cwd: privDir,
      env: { H2A_NATIVE_PTY_SESSION: "h2a-alpha" },
      cols: 100,
      rows: 30,
    });
    const beta0 = host.create({
      id: "h2a-beta",
      command: "claude",
      args: ["--resume", "conv-beta"],
      cwd: privDir,
      env: { H2A_NATIVE_PTY_SESSION: "h2a-beta" },
      cols: 100,
      rows: 30,
    });
    enrollFromRun({
      profile: "claude",
      slug: "alpha",
      tmuxSession: "h2a-alpha",
      hostKind: "local-native",
      pid: alpha0.pid,
      cwd: privDir,
      convId: "conv-alpha",
      sessionClass: "human",
      gatewayMode: "direct",
      gatewayProvenance: "explicit",
    });
    enrollFromRun({
      profile: "claude",
      slug: "beta",
      tmuxSession: "h2a-beta",
      hostKind: "local-native",
      pid: beta0.pid,
      cwd: privDir,
      convId: "conv-beta",
      sessionClass: "human",
      gatewayMode: "direct",
      gatewayProvenance: "explicit",
    });

    const envFile = join(privDir, "respawn-env.json");
    const runSoftViaOp = async (
      s: NativeRestartCandidate,
      snap: Extract<NativeRestartSnapshot, { state: "live" }>,
      mode: "gateway" | "direct" | "auto",
    ) => {
      let gwEnv: Partial<Record<"ANTHROPIC_BASE_URL" | "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY", string>> = {};
      if (mode === "gateway") {
        const acquired = await acquireLlmMeshSessionEnv(configDir, s.name);
        if (!acquired) throw new Error("failed to acquire per-session gateway token");
        gwEnv = acquired;
      }
      const restore = replaceAnthropicGatewayEnvironment(process.env, gwEnv);
      try {
        const childEnv: Record<string, string> = {
          H2A_NATIVE_PTY_SESSION: s.name,
          ...(process.env["ANTHROPIC_BASE_URL"] ? { ANTHROPIC_BASE_URL: process.env["ANTHROPIC_BASE_URL"] } : {}),
          ...(process.env["ANTHROPIC_AUTH_TOKEN"] ? { ANTHROPIC_AUTH_TOKEN: process.env["ANTHROPIC_AUTH_TOKEN"] } : {}),
        };
        writeFileSync(envFile, JSON.stringify(childEnv), { mode: 0o600 });
        let emitted: unknown;
        const code = await runNativeTerminalOp(
          [
            process.execPath,
            "op.js",
            "respawn-if-incarnation",
            "--socket", socketPath,
            "--id", s.name,
            "--generation", snap.generation,
            "--incarnation", snap.incarnation,
            "--cwd", s.cwd,
            "--env-file", envFile,
            "--",
            "claude", "--resume", s.convId!,
          ],
          (payload) => { emitted = payload; },
        );
        expect(code).toBe(0);
        const state = emitted as { pid: number; generation: string; incarnation: string; latestSeq: number };
        // Simulate respawned CLI rendering a live prompt.
        spawnedBySession.get(s.name)!.at(-1)!.emitData("Claude Code\nready\n❯ \n");
        enrollFromRun({
          profile: s.profile,
          slug: s.id,
          tmuxSession: s.name,
          hostKind: "local-native",
          pid: state.pid,
          cwd: s.cwd,
          convId: s.convId!,
          sessionClass: "human",
          ...(mode !== "auto" ? { gatewayMode: mode, gatewayProvenance: "explicit" as const } : {}),
        });
        return state;
      } finally {
        restore();
      }
    };

    // 1. Switch --all --gw on --soft
    const onResult = await executeNativeRestart(
      { all: true, gateway: "on", soft: true },
      {
        listSessions: () => [
          candidate("alpha", { cwd: privDir, gatewayMode: "direct", gatewayProvenance: "explicit" }),
          candidate("beta", { cwd: privDir, gatewayMode: "direct", gatewayProvenance: "explicit" }),
        ],
        snapshot: (s) => {
          const st = host.state(s.name);
          return { state: "live", generation: st.generation, incarnation: st.incarnation, controlled: st.controlled, pid: st.pid, latestSeq: st.latestSeq, socketPath };
        },
        checkGatewayModels: async () => {
          const check = await checkLocalGatewayModels({ dir: configDir });
          if (!check.ok) throw new Error(check.reason);
        },
        prepare: () => ({}),
        softRestart: (s, snap, mode) => runSoftViaOp(s, snap, mode),
        restart: () => { throw new Error("must not hard restart"); },
        healthCheck: async (s, _snap, ctx) => {
          const after = ctx.restartResult as { latestSeq: number };
          let captured: { text: string; status: string } | undefined;
          await runNativeTerminalOp(
            [process.execPath, "op.js", "capture-since", "--socket", socketPath, "--id", s.name, "--after-seq", String(after.latestSeq)],
            (p) => { captured = p as { text: string; status: string }; },
          );
          expect(captured?.status).toBe("running");
          expect(isRestartPromptAlive(captured?.text ?? "", s.profile)).toBe(true);
          return { ok: true };
        },
        drive: () => "driven",
      },
    );

    expect(onResult.ok).toBe(true);
    // Both kept their exact original incarnations (same PTY!) and received distinct fresh per-session tokens
    expect(host.state("h2a-alpha").incarnation).toBe(alpha0.incarnation);
    expect(host.state("h2a-beta").incarnation).toBe(beta0.incarnation);
    const alphaOnEnv = spawnedBySession.get("h2a-alpha")![1]!.env;
    const betaOnEnv = spawnedBySession.get("h2a-beta")![1]!.env;
    expect(alphaOnEnv["ANTHROPIC_BASE_URL"]).toBe(gw.baseUrl);
    expect(betaOnEnv["ANTHROPIC_BASE_URL"]).toBe(gw.baseUrl);
    expect(alphaOnEnv["ANTHROPIC_AUTH_TOKEN"]).toMatch(/^fake-gw-token-h2a-alpha-/);
    expect(betaOnEnv["ANTHROPIC_AUTH_TOKEN"]).toMatch(/^fake-gw-token-h2a-beta-/);
    expect(alphaOnEnv["ANTHROPIC_AUTH_TOKEN"]).not.toBe(betaOnEnv["ANTHROPIC_AUTH_TOKEN"]);
    expect(spawnedBySession.get("h2a-alpha")![1]!.args).toEqual(["--resume", "conv-alpha"]);

    // Registry persisted gatewayMode=gateway + gatewayProvenance=explicit
    const regAfterOn = loadRegistry();
    expect(regAfterOn.state).toBe("ok");
    if (regAfterOn.state === "ok") {
      const alphaRow = regAfterOn.entries.find((e) => e.id === "alpha");
      expect(alphaRow?.gatewayMode).toBe("gateway");
      expect(alphaRow?.gatewayProvenance).toBe("explicit");
    }

    // 2. Switch --all --gw off --soft: removes gateway env and updates registry to direct
    const offResult = await executeNativeRestart(
      { all: true, gateway: "off", soft: true },
      {
        listSessions: () => [
          candidate("alpha", { cwd: privDir, gatewayMode: "gateway", gatewayProvenance: "explicit" }),
        ],
        snapshot: (s) => {
          const st = host.state(s.name);
          return { state: "live", generation: st.generation, incarnation: st.incarnation, controlled: st.controlled, pid: st.pid, latestSeq: st.latestSeq, socketPath };
        },
        prepare: () => ({}),
        softRestart: (s, snap, mode) => runSoftViaOp(s, snap, mode),
        restart: () => { throw new Error("must not hard restart"); },
        drive: () => "driven",
      },
    );
    expect(offResult.ok).toBe(true);
    expect(host.state("h2a-alpha").incarnation).toBe(alpha0.incarnation);
    const alphaOffEnv = spawnedBySession.get("h2a-alpha")![2]!.env;
    expect(alphaOffEnv["ANTHROPIC_BASE_URL"]).toBeUndefined();
    expect(alphaOffEnv["ANTHROPIC_AUTH_TOKEN"]).toBeUndefined();
    const regAfterOff = loadRegistry();
    if (regAfterOff.state === "ok") {
      const alphaRow = regAfterOff.entries.find((e) => e.id === "alpha");
      expect(alphaRow?.gatewayMode).toBe("direct");
      expect(alphaRow?.gatewayProvenance).toBe("explicit");
    }

    // 3. Old host refusal via op.ts respawn-if-incarnation
    const oldSocketPath = join(privDir, "legacy.sock");
    const legacyServer = createNetServer((socket) => {
      socket.setEncoding("utf8");
      let buf = "";
      socket.on("data", (chunk: string) => {
        buf += chunk;
        for (;;) {
          const nl = buf.indexOf("\n");
          if (nl < 0) break;
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const req = JSON.parse(line) as { id: string; operation: string };
          if (req.operation === "ping") {
            socket.write(`${JSON.stringify({
              version: NATIVE_TERMINAL_PROTOCOL_VERSION,
              id: req.id,
              ok: true,
              result: { generation: "legacy-1", hostPid: process.pid, protocolVersion: 1, launchFence: true },
            })}\n`);
          } else if (req.operation === "list") {
            socket.write(`${JSON.stringify({
              version: NATIVE_TERMINAL_PROTOCOL_VERSION,
              id: req.id,
              ok: true,
              result: [{ id: "h2a-legacy", generation: "legacy-1", incarnation: "inc-legacy", pid: 1001, status: "running", latestSeq: 0, exit: null, stopSignal: null, controlled: false, controllerEpoch: 0, controller: null, lastHumanActivityAt: null }],
            })}\n`);
          } else {
            socket.write(`${JSON.stringify({
              version: NATIVE_TERMINAL_PROTOCOL_VERSION,
              id: req.id,
              ok: false,
              error: { code: "invalid-request", message: "unknown terminal operation" },
            })}\n`);
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      legacyServer.once("error", reject);
      legacyServer.listen(oldSocketPath, () => resolve());
    });
    chmodSync(oldSocketPath, 0o600);
    netServers.push(legacyServer);

    let legacyPayload: unknown;
    const legacyCode = await runNativeTerminalOp(
      [
        process.execPath,
        "op.js",
        "respawn-if-incarnation",
        "--socket", oldSocketPath,
        "--id", "h2a-legacy",
        "--generation", "legacy-1",
        "--incarnation", "inc-legacy",
        "--cwd", privDir,
        "--",
        "claude",
      ],
      (p) => { legacyPayload = p; },
    );
    expect(legacyCode).toBe(1);
    expect((legacyPayload as { code?: string })?.code).toBe("host-soft-restart-unsupported");

    // Verify helper checks prompt liveness accurately
    expect(isRestartPromptAlive("", "claude")).toBe(false);
    expect(isRestartPromptAlive("Do you trust the contents of this directory?\n❯ 1. Yes\nEnter to confirm", "claude")).toBe(false);
    expect(isRestartPromptAlive("Compacting conversation...", "claude")).toBe(false);
    expect(isRestartPromptAlive("❯ ", "claude")).toBe(true);
    // Keep unused readFileSync avoided
    expect(readFileSync(registryPath, "utf8")).toContain("entries");
  });
});
