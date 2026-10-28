// Keep the remote consent regressions in the h2a-runtime gate that npm test
// actually executes. These suites use in-memory HTTP requests and fake k8s
// clients; no gateway, provider or cluster is contacted.
import { vi } from "vitest";

// These private workspaces are not built by the root build. Load their real
// source exports so the gate works on a clean checkout, with no stale dist.
vi.mock("@sentropic/remote-protocol", () => import("../../remote-protocol/src/index.js"));
vi.mock("@sentropic/remote-k8s-orchestrator", () => import("../../remote-k8s-orchestrator/src/index.js"));

import "../../../apps/control-plane/src/routes/sessions-gateway.test.js";
import "../../remote-k8s-orchestrator/src/k8s/spec.test.js";
import "../../remote-k8s-orchestrator/src/k8s/provisioner.test.js";
import "../../remote-protocol/src/schemas/schema-validation.test.js";
