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

/** Coordination-only provider `sentropic.h2a` (Track lives in sentropic.track). */
export const h2aCoordinationDefinition: LazyLocalDefinition = {
  get descriptor() {
    return entryById("sentropic.h2a");
  },
  get manifest() {
    const descriptor = entryById("sentropic.h2a");
    const asset = descriptor.mcp?.manifestAsset;
    if (!asset) throw new Error("invalid_entry: sentropic.h2a has no manifestAsset");
    return readAsset(asset);
  },
  schemas: {},
  load: async () => import("../runtime/mcp/handlers.js")
};

export const registryDefinitions: LazyLocalDefinition[] = [h2aCoordinationDefinition];
