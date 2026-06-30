import assert from "node:assert/strict";
import test from "node:test";

import { renderK8sTenant } from "../dist/index.js";

test("renderK8sTenant emits the four documents in apply order (DEC-067)", () => {
  const m = renderK8sTenant();
  const kinds = m.documents.map((d) => d.kind);
  assert.deepEqual(kinds, [
    "Namespace",
    "ResourceQuota",
    "PersistentVolumeClaim",
    "Deployment"
  ]);
});

test("PVC requests ReadWriteMany — the Scenario B prerequisite", () => {
  const m = renderK8sTenant();
  const pvc = m.documents.find((d) => d.kind === "PersistentVolumeClaim");
  assert.deepEqual(pvc.spec.accessModes, ["ReadWriteMany"]);
  assert.match(m.yaml, /ReadWriteMany/);
});

test("Deployment turns the lease lock on via H2A_LOCK_MODE=lease (DEC-065/066)", () => {
  const m = renderK8sTenant({ leaseMs: 45000 });
  const dep = m.documents.find((d) => d.kind === "Deployment");
  const env = dep.spec.template.spec.containers[0].env;
  const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
  assert.equal(byName.H2A_LOCK_MODE, "lease");
  assert.equal(byName.H2A_LEASE_MS, "45000");
  assert.match(m.yaml, /name: H2A_LOCK_MODE/);
  assert.match(m.yaml, /value: "lease"/);
});

test("defaults: namespace h2a, 2 replicas, 1Gi, npm-runtime base", () => {
  const m = renderK8sTenant();
  const ns = m.documents.find((d) => d.kind === "Namespace");
  const dep = m.documents.find((d) => d.kind === "Deployment");
  const pvc = m.documents.find((d) => d.kind === "PersistentVolumeClaim");
  assert.equal(ns.metadata.name, "h2a");
  assert.equal(dep.spec.replicas, 2);
  assert.equal(pvc.spec.requests, undefined); // requests under resources
  assert.equal(pvc.spec.resources.requests.storage, "1Gi");
  assert.equal(dep.spec.template.spec.containers[0].image, "node:22-alpine");
  // npm-runtime base installs the CLI at Pod start
  assert.match(m.yaml, /npm i -g @sentropic\/h2a@latest/);
});

test("explicit image opts out of the npm runtime install", () => {
  const m = renderK8sTenant({ image: "ghcr.io/rhanka/h2a-cli:0.1.28" });
  const dep = m.documents.find((d) => d.kind === "Deployment");
  assert.equal(
    dep.spec.template.spec.containers[0].image,
    "ghcr.io/rhanka/h2a-cli:0.1.28"
  );
  assert.doesNotMatch(m.yaml, /npm i -g/);
});

test("storageClass is only emitted when provided (portable by default)", () => {
  const without = renderK8sTenant();
  assert.doesNotMatch(without.yaml, /storageClassName/);
  const withSc = renderK8sTenant({ storageClass: "scw-bssd-rwx" });
  assert.match(withSc.yaml, /storageClassName: scw-bssd-rwx/);
  const pvc = withSc.documents.find((d) => d.kind === "PersistentVolumeClaim");
  assert.equal(pvc.spec.storageClassName, "scw-bssd-rwx");
});

test("custom namespace + replicas propagate to every namespaced doc", () => {
  const m = renderK8sTenant({ namespace: "tenants-h2a", replicas: 4 });
  for (const d of m.documents) {
    if (d.kind === "Namespace") {
      assert.equal(d.metadata.name, "tenants-h2a");
    } else {
      assert.equal(d.metadata.namespace, "tenants-h2a");
    }
  }
  const dep = m.documents.find((d) => d.kind === "Deployment");
  assert.equal(dep.spec.replicas, 4);
});
