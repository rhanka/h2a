import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderK8sSidecar, runCli } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd ?? process.cwd(),
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("renderK8sSidecar defaults to node:22-alpine + npm-runtime strategy (DEC-058)", () => {
  const fragment = renderK8sSidecar();
  assert.equal(fragment.container.name, "h2a-mcp");
  assert.equal(fragment.container.image, "node:22-alpine");
  // The npm-runtime command must install the latest h2a-cli at Pod start.
  const args = fragment.container.args;
  assert.equal(args.length, 1);
  assert.match(args[0], /npm i -g @sentropic\/h2a@latest/);
  assert.match(args[0], /h2a mcp-serve --root \/workspace\/\.h2a/);
  assert.deepEqual(fragment.container.volumeMounts, [
    { name: "h2a-workspace", mountPath: "/workspace/.h2a" }
  ]);
  assert.deepEqual(fragment.volume, {
    name: "h2a-workspace",
    emptyDir: {}
  });
  assert.deepEqual(fragment.mainContainerVolumeMount, {
    name: "h2a-workspace",
    mountPath: "/workspace/.h2a"
  });
  // Resource defaults align with the sentropic-remote tenant contract.
  assert.deepEqual(fragment.container.resources, {
    requests: { cpu: "50m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "256Mi" }
  });
  // YAML is human-readable.
  assert.match(fragment.yaml, /name: h2a-mcp/);
  assert.match(fragment.yaml, /image: node:22-alpine/);
  assert.match(fragment.yaml, /emptyDir: \{\}/);
});

test("renderK8sSidecar honors explicit image + cli-version + custom paths", () => {
  const fragment = renderK8sSidecar({
    image: "ghcr.io/rhanka/h2a-cli:0.1.20",
    cliVersion: "0.1.20",
    instance: "remote:abc-123",
    host: "remote",
    root: "/data/.h2a",
    containerName: "h2a",
    volumeName: "shared"
  });
  assert.equal(fragment.container.image, "ghcr.io/rhanka/h2a-cli:0.1.20");
  assert.equal(fragment.container.name, "h2a");
  // No npm install line when a concrete image is provided.
  assert.equal(fragment.container.args.length, 1);
  assert.doesNotMatch(fragment.container.args[0], /npm i -g/);
  assert.match(fragment.container.args[0], /h2a mcp-serve --root \/data\/\.h2a/);
  // Identity envs propagated.
  const env = Object.fromEntries(
    fragment.container.env.map((e) => [e.name, e.value])
  );
  assert.equal(env.H2A_INSTANCE, "remote:abc-123");
  assert.equal(env.H2A_HOST, "remote");
  assert.equal(env.H2A_ROOT, "/data/.h2a");
  assert.equal(fragment.volume.name, "shared");
});

test("renderK8sSidecar embeds the SESSION_ID placeholder by default for remote", () => {
  const fragment = renderK8sSidecar();
  const env = Object.fromEntries(
    fragment.container.env.map((e) => [e.name, e.value])
  );
  // The placeholder is a shell-style default that remote's pod
  // template engine can resolve to the actual session id.
  assert.equal(env.H2A_INSTANCE, "remote:${SESSION_ID:-unknown}");
  assert.equal(env.H2A_HOST, "remote");
});

test("h2a deploy k8s-sidecar emits a JSON resource envelope", () => {
  const streams = captureStreams();
  const rc = runCli(
    [
      "deploy",
      "k8s-sidecar",
      "--instance",
      "remote:test",
      "--cli-version",
      "0.1.20"
    ],
    streams
  );
  assert.equal(rc, 0, streams.stderrText);
  const parsed = JSON.parse(streams.stdoutText);
  assert.equal(parsed.target, "k8s-sidecar");
  assert.equal(parsed.container.name, "h2a-mcp");
  assert.equal(parsed.volume.name, "h2a-workspace");
  assert.match(parsed.yaml, /name: h2a-mcp/);
  assert.match(parsed.yaml, /npm i -g @sentropic\/h2a@0\.1\.20/);
});

test("h2a deploy k8s-sidecar --write emits an action envelope and writes the YAML", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-deploy-"));
  try {
    const target = join(dir, "sidecar.yaml");
    const streams = captureStreams(dir);
    const rc = runCli(
      [
        "deploy",
        "k8s-sidecar",
        "--instance",
        "remote:test",
        "--write",
        target
      ],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.target, "k8s-sidecar");
    assert.equal(parsed.path, target);
    assert.ok(existsSync(target));
    const written = readFileSync(target, "utf8");
    assert.match(written, /name: h2a-mcp/);
    assert.match(written, /emptyDir: \{\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a deploy refuses unknown subcommands", () => {
  const streams = captureStreams();
  const rc = runCli(["deploy", "k3s-pod"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /unknown subcommand/);
});

test("h2a deploy without a subcommand prints help and exits 1", () => {
  const streams = captureStreams();
  const rc = runCli(["deploy"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /subcommand required/);
});
