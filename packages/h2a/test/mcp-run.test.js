import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  H2A_RUN_API_VERSION,
  buildH2aRunInvocation,
  createMcpServer,
  executeH2aRunWithSpawn,
  recordMcpRunDelegation,
  runMcpStdio,
  validateH2aRunRequest
} from "../dist/index.js";

function withWorkspace(fn) {
  const workspaceRoot = realpathSync(process.cwd());
  const workspace = mkdtempSync(join(workspaceRoot, ".h2a-run-test-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "h2a-run-store-"));
  try {
    return fn({ workspaceRoot, workspace, storeRoot });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

function withUnsafeTemporaryWorkspace(fn) {
  const workspaceRoot = realpathSync(tmpdir());
  const workspace = realpathSync(mkdtempSync(join(workspaceRoot, "h2a-run-unsafe-")));
  try {
    return fn({ workspaceRoot, workspace });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function withWorkspaceAsync(fn) {
  const workspaceRoot = realpathSync(process.cwd());
  const workspace = mkdtempSync(join(workspaceRoot, ".h2a-run-test-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "h2a-run-store-"));
  try {
    return await fn({ workspaceRoot, workspace, storeRoot });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

function request(workspace, overrides = {}) {
  return {
    profile: "codex",
    name: "review-worker",
    workspace,
    prompt: "Review --flag; $(touch /tmp/must-not-run)",
    background: true,
    gateway: "off",
    headless: true,
    h2aSidecar: false,
    model: "gpt-5.6-terra",
    effort: "xhigh",
    ...overrides
  };
}

function runtimeResult(req, overrides = {}) {
  return {
    kind: "h2a.run.result",
    version: 1,
    apiVersion: H2A_RUN_API_VERSION,
    runtimeVersion: "0.85.16",
    ok: true,
    state: "started",
    session: {
      id: req.name,
      tmuxSession: `h2a-${req.name}`,
      pane: "%7",
      profile: req.profile,
      workspace: req.workspace,
      mode: req.headless ? "headless" : "interactive",
      background: true,
      gateway: "direct",
      h2aSidecar: req.h2aSidecar,
      pid: 4242
    },
    attach: req.headless
      ? null
      : { command: "h2a", args: ["attach", req.name] },
    ...overrides
  };
}

test("h2a_run descriptor is exact, background-only, and shared by the local MCP", () => {
  withWorkspace(({ workspaceRoot, storeRoot }) => {
    const server = createMcpServer({
      root: storeRoot,
      workspaceRoot,
      runExecutor: () => ({ error: "not called" })
    });
    const descriptor = server.listTools().find((tool) => tool.name === "h2a_run");
    assert.ok(descriptor);
    assert.equal(descriptor.inputSchema.additionalProperties, false);
    assert.deepEqual(descriptor.inputSchema.required, [
      "profile",
      "name",
      "workspace",
      "prompt",
      "background"
    ]);
    assert.equal(descriptor.inputSchema.properties.background.const, true);
  });
});

test("h2a_run validates both profiles and returns the real launcher result", () => {
  withWorkspace(({ workspaceRoot, workspace, storeRoot }) => {
    for (const profile of ["claude", "codex"]) {
      let captured;
      const server = createMcpServer({
        root: storeRoot,
        workspaceRoot,
        runExecutor: (req) => {
          captured = req;
          return runtimeResult(req);
        }
      });
      const args = request(workspace, {
        profile,
        name: `${profile}-worker`,
        headless: false,
        h2aSidecar: true
      });

      const result = server.callTool("h2a_run", args);
      assert.equal(result.error, undefined);
      assert.equal(result.session.id, `${profile}-worker`);
      assert.equal(result.session.profile, profile);
      assert.deepEqual(captured, args);
    }
  });
});

test("MCP launch records post-launch delegation evidence outside the CLI argv/env", () => {
  withWorkspace(({ workspace, storeRoot }) => {
    const delegation = {
      origin: "mcp:h2a_run",
      delegatorInstance: "codex:owner:abc",
      delegatorTmuxSession: "h2a-owner"
    };
    recordMcpRunDelegation(storeRoot, runtimeResult(request(workspace)), delegation);
    const record = JSON.parse(
      readFileSync(join(storeRoot, "registry", "mcp-delegations.jsonl"), "utf8")
    );
    assert.deepEqual(
      {
        workerTmuxSession: record.workerTmuxSession,
        workerPid: record.workerPid,
        origin: record.origin,
        delegatorInstance: record.delegatorInstance,
        delegatorTmuxSession: record.delegatorTmuxSession
      },
      { workerTmuxSession: "h2a-review-worker", workerPid: 4242, ...delegation }
    );
    const invocation = buildH2aRunInvocation(
      { ...request(workspace), delegation },
      "/opt/h2a/bin.js"
    );
    assert.equal(invocation.args.some((arg) => arg.includes("delegat")), false);
    assert.equal(invocation.env, undefined);
  });
});

test("stdio tools/call exposes the same h2a_run contract", async () => {
  await withWorkspaceAsync(async ({ workspaceRoot, workspace, storeRoot }) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let output = "";
    stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    const args = request(workspace);
    const done = runMcpStdio({
      root: storeRoot,
      workspaceRoot,
      stdin,
      stdout,
      stderr,
      runExecutor: (req) => runtimeResult(req)
    });
    stdin.end(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "h2a_run", arguments: args }
      })}\n`
    );
    await done;

    const response = JSON.parse(output.trim());
    assert.equal(response.id, 7);
    assert.equal(response.result.isError, false);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.apiVersion, H2A_RUN_API_VERSION);
    assert.equal(payload.session.tmuxSession, "h2a-review-worker");
  });
});

test("h2a_run rejects unknown fields, unsafe workspaces and invalid combinations", () => {
  withWorkspace(({ workspaceRoot, workspace }) => {
    assert.throws(
      () =>
        validateH2aRunRequest(
          request(workspace, { surprise: true }),
          workspaceRoot
        ),
      /unknown field.*surprise/i
    );
    assert.throws(
      () => validateH2aRunRequest(request("relative/path"), workspaceRoot),
      /must be absolute/i
    );
    withUnsafeTemporaryWorkspace(({ workspaceRoot: unsafeRoot, workspace: unsafeWorkspace }) => {
      assert.throws(
        () => validateH2aRunRequest(request(unsafeWorkspace), unsafeRoot),
        /may not be under the OS temporary directory/i
      );
    });
    assert.throws(
      () =>
        validateH2aRunRequest(
          request(workspace, { background: false }),
          workspaceRoot
        ),
      /background.*must be true/i
    );
    assert.throws(
      () =>
        validateH2aRunRequest(
          request(workspace, { headless: true, h2aSidecar: true }),
          workspaceRoot
        ),
      /headless.*sidecar/i
    );
    assert.throws(
      () =>
        validateH2aRunRequest(
          request(workspace, { gateway: "required" }),
          workspaceRoot
        ),
      /required.*unsupported for codex/i
    );
  });
});

test("canonical invocation uses argv + stdin with no prompt in any argv token", () => {
  withWorkspace(({ workspaceRoot, workspace }) => {
    const req = validateH2aRunRequest(request(workspace), workspaceRoot);
    const invocation = buildH2aRunInvocation(req, "/opt/h2a/bin.js");

    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.cwd, workspace);
    assert.equal(invocation.input, req.prompt);
    assert.deepEqual(invocation.args, [
      "/opt/h2a/bin.js",
      "run",
      "codex",
      workspace,
      "--no-attach",
      "--background",
      "--json",
      "--h2a-run-worker",
      "--name",
      "review-worker",
      "--prompt-stdin",
      "--no-h2a",
      "--no-gw",
      "--model",
      "gpt-5.6-terra",
      "--effort",
      "xhigh",
      "--headless"
    ]);
    assert.equal(invocation.args.includes(req.prompt), false);
  });
});

test("subprocess bridge sets shell:false and fails closed on API/runtime skew", () => {
  withWorkspace(({ workspaceRoot, workspace }) => {
    const req = validateH2aRunRequest(request(workspace), workspaceRoot);
    let observed;
    const valid = executeH2aRunWithSpawn(req, (command, args, options) => {
      observed = { command, args, options };
      return {
        status: 0,
        stdout: JSON.stringify(runtimeResult(req)),
        stderr: ""
      };
    });
    assert.equal(valid.session.pid, 4242);
    assert.equal(observed.options.shell, false);
    assert.equal(observed.options.input, req.prompt);
    assert.equal(observed.args.includes(req.prompt), false);

    executeH2aRunWithSpawn(req, (_command, args, options) => {
      assert.equal(args.includes("--delegation-origin"), false);
      assert.equal(options.env, undefined);
      return { status: 0, stdout: JSON.stringify(runtimeResult(req)), stderr: "" };
    });

    assert.throws(
      () =>
        executeH2aRunWithSpawn(req, () => ({
          status: 0,
          stdout: JSON.stringify(
            runtimeResult(req, { apiVersion: "h2a.run/v999" })
          ),
          stderr: ""
        })),
      /incompatible h2a runtime/i
    );
    assert.throws(
      () =>
        executeH2aRunWithSpawn(req, () => ({
          status: 0,
          stdout: JSON.stringify(
            runtimeResult(req, { runtimeVersion: undefined })
          ),
          stderr: ""
        })),
      /incompatible h2a runtime/i
    );
    const claudeRequired = {
      ...req,
      profile: "claude",
      gateway: "required"
    };
    assert.throws(
      () =>
        executeH2aRunWithSpawn(claudeRequired, () => ({
          status: 0,
          stdout: JSON.stringify(
            runtimeResult(claudeRequired, {
              session: {
                ...runtimeResult(claudeRequired).session,
                gateway: "direct"
              }
            })
          ),
          stderr: ""
        })),
      /incompatible h2a runtime/i
    );
    assert.throws(
      () =>
        executeH2aRunWithSpawn(req, () => ({
          status: 0,
          stdout: JSON.stringify(runtimeResult(req, { session: {
            ...runtimeResult(req).session,
            pid: undefined
          } })),
          stderr: ""
        })),
      /incompatible h2a runtime/i
    );
    assert.throws(
      () =>
        executeH2aRunWithSpawn(req, () => ({
          status: 0,
          stdout: JSON.stringify(runtimeResult(req, { session: {
            ...runtimeResult(req).session,
            pane: undefined
          } })),
          stderr: ""
        })),
      /incompatible h2a runtime/i
    );
  });
});

test("h2a_run accepts a native-terminal-host result that carries no tmux pane", () => {
  withWorkspace(({ workspaceRoot, workspace }) => {
    // A native session is keyed by name, not a tmux pane, so the runtime omits
    // `session.pane` and stamps `host: "native"`. The launch DID start; the MCP
    // contract must accept it instead of rejecting a valid started session.
    const req = validateH2aRunRequest(
      request(workspace, { headless: false, h2aSidecar: true }),
      workspaceRoot
    );
    const base = runtimeResult(req);
    const { pane, ...nativeSession } = base.session;
    void pane;
    const out = executeH2aRunWithSpawn(req, () => ({
      status: 0,
      stdout: JSON.stringify({
        ...base,
        session: { ...nativeSession, host: "native" }
      }),
      stderr: ""
    }));
    assert.equal(out.ok, true);
    assert.equal(out.session.host, "native");
    assert.equal(out.session.pane, undefined);
  });

  withWorkspace(({ workspaceRoot, workspace }) => {
    // An unrecognized host value is rejected even with a well-formed tmux pane,
    // so a future host cannot silently pass the started-session contract.
    const req = validateH2aRunRequest(request(workspace), workspaceRoot);
    const base = runtimeResult(req);
    assert.throws(
      () =>
        executeH2aRunWithSpawn(req, () => ({
          status: 0,
          stdout: JSON.stringify({
            ...base,
            session: { ...base.session, host: "quantum" }
          }),
          stderr: ""
        })),
      /incompatible h2a runtime/i
    );
  });
});

test("duplicate-name runtime refusal is surfaced as an error, never success", () => {
  withWorkspace(({ workspaceRoot, workspace }) => {
    const req = validateH2aRunRequest(request(workspace), workspaceRoot);
    assert.throws(
      () =>
        executeH2aRunWithSpawn(req, () => ({
          status: 1,
          stdout: "",
          stderr:
            "[h2a] local session review-worker already exists; no new codex was started."
        })),
      /already exists.*no new codex was started/i
    );
  });
});

test("timeout reports unknown state and explicitly forbids blind retry", () => {
  withWorkspace(({ workspaceRoot, workspace }) => {
    const req = validateH2aRunRequest(request(workspace), workspaceRoot);
    const timeout = new Error("timed out");
    timeout.code = "ETIMEDOUT";
    const result = executeH2aRunWithSpawn(req, () => ({
      status: null,
      stdout: "",
      stderr: "",
      error: timeout
    }));
    assert.deepEqual(result, {
      error: "h2a_run: launch status unknown after runtime timeout",
      state: "unknown",
      launchId: "review-worker",
      retrySafe: false
    });
  });
});
