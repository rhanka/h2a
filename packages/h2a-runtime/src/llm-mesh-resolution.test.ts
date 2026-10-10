import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createClusterMeshModules, verifyClusterMeshTopology } from "@sentropic/cluster-mesh";

const subpaths = [
  "@sentropic/cluster-mesh/gateway",
  "@sentropic/cluster-mesh/llm-mesh",
  "@sentropic/cluster-mesh/llm-mesh/facade",
  "@sentropic/cluster-mesh/llm-mesh/enrollment",
  "@sentropic/cluster-mesh/llm-mesh/node",
] as const;

describe("runtime resolves the public cluster-mesh integration without aliases", () => {
  it.each(subpaths)("should resolve %s through the native ESM resolver", (specifier) => {
    const esmPath = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
    const clusterRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@sentropic/cluster-mesh"))));
    expect(esmPath.startsWith(join(realpathSync(clusterRoot), "dist") + "/")).toBe(true);
    expect(JSON.parse(readFileSync(join(clusterRoot, "package.json"), "utf8")).version).toBe("0.13.3");
  });

  it("should load the same facade and keyring through the public leaves and root registry", async () => {
    const modules = createClusterMeshModules();
    const facade = await import("@sentropic/cluster-mesh/llm-mesh/facade");
    const node = await import("@sentropic/cluster-mesh/llm-mesh/node");
    const registeredFacade = await modules.load("llm-mesh/facade") as typeof facade;
    const registeredNode = await modules.load("llm-mesh/node") as typeof node;
    expect(facade.createLlmMeshFacade).toBeTypeOf("function");
    expect(node.InMemoryKeyring).toBeTypeOf("function");
    expect(registeredFacade.createLlmMeshFacade).toBe(facade.createLlmMeshFacade);
    expect(registeredNode.InMemoryKeyring).toBe(node.InMemoryKeyring);
    expect(modules.snapshot()["llm-mesh/facade"].state).toBe("loaded");
  });

  it("should share a single physical mesh with the gateway according to the upstream guard", async () => {
    await import("@sentropic/cluster-mesh/gateway");
    const topology = verifyClusterMeshTopology({ require: ["gateway", "llm-mesh"] });
    expect(topology.instances).toHaveLength(1);
    expect(topology.llmMesh?.version).toBe("0.25.0");
    expect(topology.gateway?.version).toBe("0.19.5");
    expect(topology.gateway?.llmMesh?.path).toBe(topology.llmMesh?.path);
  });
});
