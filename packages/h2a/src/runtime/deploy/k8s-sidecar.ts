/**
 * Kubernetes sidecar manifest renderer (DEC-058 / Scenario A of DEC-056).
 *
 * Produces a `containers` + `volumes` fragment that can be merged into an
 * existing Pod spec (typically a `remote` session Pod) so the
 * runtime CLI container and an `h2a mcp-serve` sidecar share the same
 * `<root>/.h2a/` directory through an `emptyDir`.
 *
 * Two image modes:
 *
 * - `npm-runtime` (default) — uses a generic `node:22-alpine` image and
 *   `npm i -g @sentropic/h2a@<version>` at Pod start. No custom image
 *   to build. Trade-off: ~10s install latency on Pod start. Suitable for
 *   PoC and demos.
 *
 * - explicit image reference (e.g. `ghcr.io/rhanka/h2a-cli:0.1.20`) — uses
 *   the given image which is expected to provide `h2a` on PATH. No install
 *   at runtime. Suitable for production once a real image is published.
 *
 * The renderer is pure: no I/O, no filesystem access. The caller decides
 * whether to print the YAML or merge it into an existing manifest.
 */

export interface K8sSidecarOptions {
  /**
   * Instance id to declare to h2a at session open. Defaults to a placeholder
   * of `remote:${SESSION_ID}` if running inside the
   * `@sentropic/remote` context — that env var is expected to be
   * injected by the parent control plane.
   */
  readonly instance?: string;
  /**
   * Host hint passed to `h2a_session_open`. Defaults to "remote".
   */
  readonly host?: string;
  /**
   * Filesystem path where `<root>/.h2a/` lives inside the session Pod.
   * Default `/workspace/.h2a`, matching `remote`'s PVC mount.
   */
  readonly root?: string;
  /**
   * Image strategy: `"npm-runtime"` (default) or a concrete OCI image
   * reference (e.g. `"ghcr.io/rhanka/h2a-cli:0.1.20"`).
   */
  readonly image?: string;
  /**
   * Version pinned for the `npm i -g` line when `image = "npm-runtime"`.
   * Defaults to `latest`. Pin to a known X.Y.Z for reproducible Pods.
   */
  readonly cliVersion?: string;
  /**
   * Sidecar container name. Default `h2a-mcp`.
   */
  readonly containerName?: string;
  /**
   * Shared volume name. Default `h2a-workspace`. The caller is responsible
   * for ensuring the main runtime container mounts the same volume at the
   * same path.
   */
  readonly volumeName?: string;
  /**
   * Resource requests/limits. Conservative defaults aligned with the
   * `sentropic-remote` tenant contract (DEC-056).
   */
  readonly resources?: {
    readonly requests?: { cpu?: string; memory?: string };
    readonly limits?: { cpu?: string; memory?: string };
  };
}

export interface K8sSidecarFragment {
  /** Container spec to append to `spec.containers[]`. */
  readonly container: Record<string, unknown>;
  /** Volume spec to append to `spec.volumes[]`. */
  readonly volume: Record<string, unknown>;
  /** Volume mount the caller must also append to the main runtime container. */
  readonly mainContainerVolumeMount: Record<string, unknown>;
  /** Convenience: the rendered YAML of the full fragment. */
  readonly yaml: string;
}

function defaultResources(): K8sSidecarOptions["resources"] {
  return {
    requests: { cpu: "50m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "256Mi" }
  };
}

function buildCommand(
  imageStrategy: string,
  cliVersion: string,
  root: string
): { command: string[]; args: string[] } {
  if (imageStrategy === "npm-runtime") {
    return {
      command: ["sh", "-c"],
      args: [
        [
          "set -euo pipefail",
          `npm i -g @sentropic/h2a@${cliVersion}`,
          `mkdir -p ${root}`,
          `h2a init --root ${root} || true`,
          `exec h2a mcp-serve --root ${root}`
        ].join(" && ")
      ]
    };
  }
  // Pre-built image case: assume `h2a` is on PATH.
  return {
    command: ["sh", "-c"],
    args: [
      [
        "set -euo pipefail",
        `mkdir -p ${root}`,
        `h2a init --root ${root} || true`,
        `exec h2a mcp-serve --root ${root}`
      ].join(" && ")
    ]
  };
}

function renderYamlFragment(
  container: Record<string, unknown>,
  volume: Record<string, unknown>,
  mount: Record<string, unknown>
): string {
  // A small hand-rolled YAML renderer keeps us dependency-free (no js-yaml).
  // Format is intentionally vertical and indent-stable so a `kubectl apply`
  // diff stays readable.
  const lines: string[] = [];
  lines.push("# h2a sidecar fragment — append to your session Pod spec");
  lines.push("# (Scenario A of DEC-056 / DEC-058)");
  lines.push("");
  lines.push("spec:");
  lines.push("  containers:");
  lines.push(`    - name: ${container.name}`);
  lines.push(`      image: ${container.image}`);
  const cmd = container.command as string[];
  lines.push(`      command: ${JSON.stringify(cmd)}`);
  const args = container.args as string[];
  lines.push(`      args:`);
  for (const arg of args) {
    lines.push(`        - ${JSON.stringify(arg)}`);
  }
  const env = container.env as Array<{ name: string; value: string }>;
  if (env.length > 0) {
    lines.push("      env:");
    for (const e of env) {
      lines.push(`        - name: ${e.name}`);
      lines.push(`          value: ${JSON.stringify(e.value)}`);
    }
  }
  const mounts = container.volumeMounts as Array<{
    name: string;
    mountPath: string;
  }>;
  lines.push("      volumeMounts:");
  for (const m of mounts) {
    lines.push(`        - name: ${m.name}`);
    lines.push(`          mountPath: ${m.mountPath}`);
  }
  const res = container.resources as K8sSidecarOptions["resources"];
  if (res) {
    lines.push("      resources:");
    if (res.requests) {
      lines.push("        requests:");
      if (res.requests.cpu) lines.push(`          cpu: ${res.requests.cpu}`);
      if (res.requests.memory)
        lines.push(`          memory: ${res.requests.memory}`);
    }
    if (res.limits) {
      lines.push("        limits:");
      if (res.limits.cpu) lines.push(`          cpu: ${res.limits.cpu}`);
      if (res.limits.memory)
        lines.push(`          memory: ${res.limits.memory}`);
    }
  }
  lines.push("");
  lines.push("  # Also append this volume mount to the runtime CLI container:");
  lines.push(`  #   - name: ${mount.name}`);
  lines.push(`  #     mountPath: ${mount.mountPath}`);
  lines.push("");
  lines.push("  volumes:");
  lines.push(`    - name: ${volume.name}`);
  lines.push("      emptyDir: {}");
  lines.push("");
  return lines.join("\n");
}

/**
 * Render a sidecar fragment suitable for merging into a `remote`
 * session Pod (or any host Pod that runs an interactive CLI and wants to
 * coordinate via h2a). Returns both the structured pieces (for programmatic
 * merging) and a YAML rendering (for `--print` style CLI use).
 */
export function renderK8sSidecar(
  options: K8sSidecarOptions = {}
): K8sSidecarFragment {
  const containerName = options.containerName ?? "h2a-mcp";
  const volumeName = options.volumeName ?? "h2a-workspace";
  const root = options.root ?? "/workspace/.h2a";
  const image =
    options.image && options.image !== "npm-runtime"
      ? options.image
      : "node:22-alpine";
  const imageStrategy = options.image ?? "npm-runtime";
  const cliVersion = options.cliVersion ?? "latest";
  const host = options.host ?? "remote";
  const instance =
    options.instance ?? "remote:${SESSION_ID:-unknown}";
  const resources = options.resources ?? defaultResources();

  const { command, args } = buildCommand(imageStrategy, cliVersion, root);

  const container: Record<string, unknown> = {
    name: containerName,
    image,
    command,
    args,
    env: [
      { name: "H2A_INSTANCE", value: instance },
      { name: "H2A_HOST", value: host },
      { name: "H2A_ROOT", value: root }
    ],
    volumeMounts: [{ name: volumeName, mountPath: root }],
    resources
  };

  const volume: Record<string, unknown> = {
    name: volumeName,
    emptyDir: {}
  };

  const mainContainerVolumeMount: Record<string, unknown> = {
    name: volumeName,
    mountPath: root
  };

  return {
    container,
    volume,
    mainContainerVolumeMount,
    yaml: renderYamlFragment(container, volume, mainContainerVolumeMount)
  };
}
