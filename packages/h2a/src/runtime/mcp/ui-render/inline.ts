/** Verified, reproducible single-module derivatives of DS cc29be88 (§8.3). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { UiRenderAssets } from "./assets.js";

const INLINE_DIR = new URL("../../../../vendor/ui-render-inline/", import.meta.url);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export function readInlineModule(assets: UiRenderAssets, component = "render"): string {
  if (!["render", "BarChart", "BpmnCanvas", "DecisionDossier"].includes(component)) {
    throw new Error("integrity_mismatch: unknown inline entry");
  }
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", INLINE_DIR), "utf8")) as {
    sourceManifestSha256: string;
    files: Record<string, { sha256: string }>;
  };
  if (manifest.sourceManifestSha256 !== sha256(JSON.stringify(assets.manifest))) {
    throw new Error("integrity_mismatch: inline entry source manifest");
  }
  const file = `${component}.js`;
  const text = readFileSync(new URL(file, INLINE_DIR), "utf8");
  if (sha256(text) !== manifest.files[file]?.sha256) {
    throw new Error(`integrity_mismatch: inline entry ${component}`);
  }
  return text;
}
