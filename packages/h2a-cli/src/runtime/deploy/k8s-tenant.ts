/**
 * Kubernetes cluster-tenant manifest renderer (DEC-067 / Scenario B of DEC-056).
 *
 * Where the sidecar renderer (DEC-058, Scenario A) injects an `h2a mcp-serve`
 * container into someone else's session Pod, the tenant renderer stands h2a up
 * as its own namespaced tenant with a shared **ReadWriteMany** store that
 * multiple Pods — potentially on different nodes — coordinate through. That
 * cross-Pod concurrency is only safe because the Deployment runs the store in
 * lease-lock mode (DEC-065/066) via `H2A_LOCK_MODE=lease`.
 *
 * The output is a complete multi-document manifest (Namespace + ResourceQuota
 * + PVC + Deployment) ready for `kubectl apply -f -`, not a fragment to merge.
 *
 * The renderer is pure: no I/O, no filesystem access. The caller decides
 * whether to print the YAML or write it to disk.
 */

export interface K8sTenantOptions {
  /**
   * Kubernetes namespace for the tenant. Default `h2a`. The namespace is
   * created by the manifest (a `Namespace` document is always emitted).
   */
  readonly namespace?: string;
  /**
   * Image strategy: `"npm-runtime"` (default) installs the CLI from npm onto a
   * generic `node:22-alpine` base at Pod start; any other value is treated as a
   * concrete OCI reference (e.g. `"ghcr.io/rhanka/h2a-cli:0.1.28"`) that
   * already provides `h2a` on PATH.
   */
  readonly image?: string;
  /**
   * Version pinned for the `npm i -g` line when `image = "npm-runtime"`.
   * Default `latest`. Pin to a known X.Y.Z for reproducible Pods.
   */
  readonly cliVersion?: string;
  /**
   * Mount path for the shared store inside each Pod. Default `/workspace/.h2a`.
   */
  readonly root?: string;
  /**
   * Number of coordinating Pods. Default 2 — the smallest replica count that
   * actually exercises cross-Pod locking (the whole point of Scenario B).
   */
  readonly replicas?: number;
  /**
   * Requested size of the RWX PVC. Default `1Gi`.
   */
  readonly storage?: string;
  /**
   * `storageClassName` for the PVC. Must back a ReadWriteMany volume. Default
   * unset (cluster default StorageClass); on Scaleway pass e.g. `"scw-bssd"`'s
   * RWX-capable class. Left unset so the manifest stays portable.
   */
  readonly storageClass?: string;
  /**
   * Lease duration (ms) injected as `H2A_LEASE_MS`. Must exceed the longest
   * critical section plus inter-host clock skew. Default 30000 (DEC-065).
   */
  readonly leaseMs?: number;
  /**
   * Per-Pod resource requests/limits. Conservative defaults.
   */
  readonly resources?: {
    readonly requests?: { cpu?: string; memory?: string };
    readonly limits?: { cpu?: string; memory?: string };
  };
}

export interface K8sTenantManifest {
  /** Structured documents in apply order (for programmatic consumers). */
  readonly documents: ReadonlyArray<Record<string, unknown>>;
  /** Convenience: the rendered multi-document YAML. */
  readonly yaml: string;
}

function defaultResources(): NonNullable<K8sTenantOptions["resources"]> {
  return {
    requests: { cpu: "50m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "256Mi" }
  };
}

function buildArgs(imageStrategy: string, cliVersion: string, root: string): string {
  const install =
    imageStrategy === "npm-runtime"
      ? [`npm i -g @sentropic/h2a-cli@${cliVersion}`]
      : [];
  return [
    "set -euo pipefail",
    ...install,
    `mkdir -p ${root}`,
    `h2a init --root ${root} || true`,
    `exec h2a mcp-serve --root ${root}`
  ].join(" && ");
}

function renderYaml(
  options: Required<
    Pick<K8sTenantOptions, "namespace" | "root" | "replicas" | "storage">
  > & {
    image: string;
    imageStrategy: string;
    cliVersion: string;
    leaseMs: number;
    storageClass?: string;
    resources: NonNullable<K8sTenantOptions["resources"]>;
  }
): string {
  const { namespace, root, replicas, storage, image, leaseMs, resources } = options;
  const args = buildArgs(options.imageStrategy, options.cliVersion, root);
  const res = resources;
  const lines: string[] = [];

  lines.push("# h2a cluster tenant — Scenario B of DEC-056 (DEC-067)");
  lines.push("# Shared ReadWriteMany store coordinated by the lease lock");
  lines.push("# (DEC-065/066). Apply with: kubectl apply -f -");
  lines.push("---");
  lines.push("apiVersion: v1");
  lines.push("kind: Namespace");
  lines.push("metadata:");
  lines.push(`  name: ${namespace}`);
  lines.push("  labels:");
  lines.push("    app.kubernetes.io/part-of: h2a");
  lines.push("---");
  lines.push("apiVersion: v1");
  lines.push("kind: ResourceQuota");
  lines.push("metadata:");
  lines.push("  name: h2a-quota");
  lines.push(`  namespace: ${namespace}`);
  lines.push("spec:");
  lines.push("  hard:");
  lines.push(`    requests.cpu: ${quotaCpu(res.requests?.cpu, replicas)}`);
  lines.push(`    requests.memory: ${quotaMemory(res.requests?.memory, replicas)}`);
  lines.push(`    persistentvolumeclaims: "1"`);
  lines.push("---");
  lines.push("apiVersion: v1");
  lines.push("kind: PersistentVolumeClaim");
  lines.push("metadata:");
  lines.push("  name: h2a-store");
  lines.push(`  namespace: ${namespace}`);
  lines.push("spec:");
  lines.push("  accessModes:");
  lines.push("    - ReadWriteMany");
  if (options.storageClass) {
    lines.push(`  storageClassName: ${options.storageClass}`);
  }
  lines.push("  resources:");
  lines.push("    requests:");
  lines.push(`      storage: ${storage}`);
  lines.push("---");
  lines.push("apiVersion: apps/v1");
  lines.push("kind: Deployment");
  lines.push("metadata:");
  lines.push("  name: h2a");
  lines.push(`  namespace: ${namespace}`);
  lines.push("spec:");
  lines.push(`  replicas: ${replicas}`);
  lines.push("  selector:");
  lines.push("    matchLabels:");
  lines.push("      app: h2a");
  lines.push("  template:");
  lines.push("    metadata:");
  lines.push("      labels:");
  lines.push("        app: h2a");
  lines.push("    spec:");
  lines.push("      containers:");
  lines.push("        - name: h2a");
  lines.push(`          image: ${image}`);
  lines.push(`          command: ["sh", "-c"]`);
  lines.push("          args:");
  lines.push(`            - ${JSON.stringify(args)}`);
  lines.push("          env:");
  lines.push("            - name: H2A_LOCK_MODE");
  lines.push('              value: "lease"');
  lines.push("            - name: H2A_LEASE_MS");
  lines.push(`              value: ${JSON.stringify(String(leaseMs))}`);
  lines.push("            - name: H2A_ROOT");
  lines.push(`              value: ${JSON.stringify(root)}`);
  lines.push("            - name: H2A_INSTANCE");
  lines.push(`              value: "h2a:$(POD_NAME)"`);
  lines.push("            - name: POD_NAME");
  lines.push("              valueFrom:");
  lines.push("                fieldRef:");
  lines.push("                  fieldPath: metadata.name");
  lines.push("          volumeMounts:");
  lines.push("            - name: h2a-store");
  lines.push(`              mountPath: ${root}`);
  lines.push("          resources:");
  lines.push("            requests:");
  if (res.requests?.cpu) lines.push(`              cpu: ${res.requests.cpu}`);
  if (res.requests?.memory) lines.push(`              memory: ${res.requests.memory}`);
  lines.push("            limits:");
  if (res.limits?.cpu) lines.push(`              cpu: ${res.limits.cpu}`);
  if (res.limits?.memory) lines.push(`              memory: ${res.limits.memory}`);
  lines.push("      volumes:");
  lines.push("        - name: h2a-store");
  lines.push("          persistentVolumeClaim:");
  lines.push("            claimName: h2a-store");
  lines.push("");
  return lines.join("\n");
}

function quotaCpu(perPod: string | undefined, replicas: number): string {
  // Crude but deterministic: replicas × per-pod millicpu. Defaults keep the
  // quota a hair above aggregate requests so the Deployment schedules.
  const milli = parseMilli(perPod ?? "50m");
  return `${milli * replicas}m`;
}

function quotaMemory(perPod: string | undefined, replicas: number): string {
  const mi = parseMebi(perPod ?? "64Mi");
  return `${mi * replicas}Mi`;
}

function parseMilli(v: string): number {
  if (v.endsWith("m")) return Number.parseInt(v.slice(0, -1), 10);
  return Math.round(Number.parseFloat(v) * 1000);
}

function parseMebi(v: string): number {
  if (v.endsWith("Mi")) return Number.parseInt(v.slice(0, -2), 10);
  if (v.endsWith("Gi")) return Number.parseInt(v.slice(0, -2), 10) * 1024;
  return Number.parseInt(v, 10);
}

/**
 * Render a complete cluster-tenant manifest for Scenario B of DEC-056: a
 * namespaced h2a Deployment backed by a shared ReadWriteMany store whose
 * cross-Pod concurrency is made safe by the lease lock (DEC-065/066), turned
 * on through the `H2A_LOCK_MODE=lease` env the Deployment injects.
 */
export function renderK8sTenant(options: K8sTenantOptions = {}): K8sTenantManifest {
  const namespace = options.namespace ?? "h2a";
  const root = options.root ?? "/workspace/.h2a";
  const replicas = options.replicas ?? 2;
  const storage = options.storage ?? "1Gi";
  const imageStrategy = options.image ?? "npm-runtime";
  const image =
    options.image && options.image !== "npm-runtime"
      ? options.image
      : "node:22-alpine";
  const cliVersion = options.cliVersion ?? "latest";
  const leaseMs = options.leaseMs ?? 30000;
  const resources = options.resources ?? defaultResources();

  const yaml = renderYaml({
    namespace,
    root,
    replicas,
    storage,
    image,
    imageStrategy,
    cliVersion,
    leaseMs,
    storageClass: options.storageClass,
    resources
  });

  const documents: Array<Record<string, unknown>> = [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace, labels: { "app.kubernetes.io/part-of": "h2a" } }
    },
    {
      apiVersion: "v1",
      kind: "ResourceQuota",
      metadata: { name: "h2a-quota", namespace },
      spec: {
        hard: {
          "requests.cpu": quotaCpu(resources.requests?.cpu, replicas),
          "requests.memory": quotaMemory(resources.requests?.memory, replicas),
          persistentvolumeclaims: "1"
        }
      }
    },
    {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: { name: "h2a-store", namespace },
      spec: {
        accessModes: ["ReadWriteMany"],
        ...(options.storageClass ? { storageClassName: options.storageClass } : {}),
        resources: { requests: { storage } }
      }
    },
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "h2a", namespace },
      spec: {
        replicas,
        selector: { matchLabels: { app: "h2a" } },
        template: {
          metadata: { labels: { app: "h2a" } },
          spec: {
            containers: [
              {
                name: "h2a",
                image,
                command: ["sh", "-c"],
                args: [buildArgs(imageStrategy, cliVersion, root)],
                env: [
                  { name: "H2A_LOCK_MODE", value: "lease" },
                  { name: "H2A_LEASE_MS", value: String(leaseMs) },
                  { name: "H2A_ROOT", value: root },
                  { name: "H2A_INSTANCE", value: "h2a:$(POD_NAME)" },
                  {
                    name: "POD_NAME",
                    valueFrom: { fieldRef: { fieldPath: "metadata.name" } }
                  }
                ],
                volumeMounts: [{ name: "h2a-store", mountPath: root }],
                resources
              }
            ],
            volumes: [
              {
                name: "h2a-store",
                persistentVolumeClaim: { claimName: "h2a-store" }
              }
            ]
          }
        }
      }
    }
  ];

  return { documents, yaml };
}
