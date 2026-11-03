/**
 * `./registry/definitions` export: lazy local definitions for the h2a
 * publisher (contract §3.1/§6). Registration validates the metadata shell
 * without calling the loader; `catalog()` never evaluates it.
 *
 * Dependency-light: static imports are `node:` builtins and the metadata
 * shell only. Executable handlers load through the dynamic `load()` thunks
 * after metadata/pin preflight, so the static import graph of this subpath
 * contains no cluster-mesh, h2a-runtime, node-pty or handler modules.
 */
import { readFileSync } from "node:fs";
import type { RegistryEntry } from "./descriptors.js";
import { registryPackageManifest } from "./manifest.js";

export interface LazyLocalDefinition {
  descriptor: RegistryEntry;
  manifest: unknown;
  schemas: Record<string, unknown>;
  load: () => Promise<unknown>;
}

function entryById(id: string): RegistryEntry {
  const found = (registryPackageManifest.entries as RegistryEntry[]).find((entry) => entry.id === id);
  if (!found) throw new Error(`invalid_entry: registry package has no entry ${id}`);
  return found;
}

function readAsset(assetPath: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../${assetPath}`, import.meta.url), "utf8")) as unknown;
}

function readManifestAsset(): unknown {
  const descriptor = entryById("sentropic.h2a");
  const asset = descriptor.mcp?.manifestAsset;
  if (!asset) throw new Error("invalid_entry: sentropic.h2a has no manifestAsset");
  return readAsset(asset);
}

function manifestToolNames(manifest: unknown): string[] {
  const tools = (manifest as { tools?: Array<{ name?: unknown }> }).tools;
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool?.name !== "string")) {
    throw new Error("invalid_entry: coordination manifest has no string tool names");
  }
  return tools.map((tool) => (tool as { name: string }).name);
}

/** Coordination-only provider `sentropic.h2a` (Track lives in sentropic.track). */
export const h2aCoordinationDefinition: LazyLocalDefinition = {
  get descriptor() {
    return entryById("sentropic.h2a");
  },
  get manifest() {
    return readManifestAsset();
  },
  schemas: {},
  load: async () => {
    // Adapter inside the lazy boundary: the real handler module is loaded
    // (proving the coordination surface exists) and adapted to the loader
    // contract { handlers: Map, manifest }. Handler keys are exactly the
    // manifest tool names. Values never execute through the registry:
    // dispatch authority stays with the composed server, so an invocation
    // refuses closed instead of running handler code without its store.
    const handlersModule = (await import("../runtime/mcp/handlers.js")) as Record<string, unknown>;
    for (const marker of ["handleSend", "handleDiscoverInstances", "handleRegisterInstance"]) {
      if (typeof handlersModule[marker] !== "function") {
        throw new Error(`invalid_entry: handler module exposes no ${marker}`);
      }
    }
    const manifest = readManifestAsset();
    const handlers = new Map<string, (args: unknown) => unknown>();
    for (const name of manifestToolNames(manifest)) {
      handlers.set(name, () => {
        throw new Error(`invalid_entry: registry definition handlers are compile-time presence only (tool ${name})`);
      });
    }
    return { manifest, handlers };
  }
};

export const registryDefinitions: LazyLocalDefinition[] = [h2aCoordinationDefinition];
