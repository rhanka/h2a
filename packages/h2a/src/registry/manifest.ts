/**
 * `./registry/manifest` JSON export: the package-owned
 * `registry/entries.v1.json` wrapper (contract §3.1). Metadata only: reading
 * it starts nothing and imports no provider code.
 */
import { readFileSync } from "node:fs";

const url = new URL("../../registry/entries.v1.json", import.meta.url);
const text = readFileSync(url, "utf8");

export interface RegistryPackageManifest {
  format: "sentropic.registry-package/v1";
  entries: unknown[];
}

export const registryPackageManifest = JSON.parse(text) as RegistryPackageManifest;
export const registryPackageManifestText = text;
