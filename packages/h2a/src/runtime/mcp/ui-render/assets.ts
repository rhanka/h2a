/**
 * The vendored asset loader (h2a spec §7.2): until DS L7a publishes
 * `@sentropic/design-system-elements`, the module serves the deterministic
 * snapshot vendored under `packages/h2a/vendor/design-system-elements/`.
 * Every file is verified by SHA-256 against the pinned `manifest.json`
 * before anything is served, and the catalogue's declared focus semantic
 * digest must equal the pinned `@sentropic/focus` v1 schema digest. A
 * tampered, extra, or missing file — or a disagreeing catalog — refuses
 * with a deterministic `integrity_mismatch` error.
 *
 * `H2A_DS_ELEMENTS_WORKSPACE_DIR` (developer-only) admits a built DS
 * `packages/elements` checkout for cross-repo iteration: the operational
 * trio (`catalog.json`, `envelope.json`, `dist/browser/sri.json`) must
 * still match the pinned digests; every other file is optional but must
 * be pinned and match when present.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The SHA-256 of `@sentropic/focus/schemas/decision-dossier-document.v1`
 * (`urn:sentropic:focus:DecisionDossierDocument:1.0.0`): the semantic
 * digest the catalogue's DecisionDossier entry must declare (h2a spec
 * §7.2; the focus validator wired into the semantic port validates v1).
 */
export const FOCUS_DECISION_DOSSIER_V1_SHA256 =
  "725bc07e7c6b6ad51a1f720cc9fb02649d8f31bc54e71c61c350fd20058c8852";

/** The vendor manifest format tag; anything else is not the pinned snapshot. */
const VENDOR_MANIFEST_FORMAT = "h2a.ds-elements-vendor/v1";

/** The default vendored snapshot (four levels up from this module, in src or dist). */
const DEFAULT_VENDOR_DIR = new URL("../../../../vendor/design-system-elements/", import.meta.url);

/** The files a workspace build must carry for the module to operate (§7.2). */
const WORKSPACE_REQUIRED_FILES = ["catalog.json", "envelope.json", "dist/browser/sri.json"];

/** One pinned manifest file entry. */
export interface UiRenderVendorFilePin {
  readonly sha256: string;
}

/** The pinned vendor snapshot manifest (`manifest.json`). */
export interface UiRenderVendorManifest {
  readonly format: string;
  readonly sourceRepo?: string;
  readonly sourceCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly sourceTar?: {
    readonly path: string;
    readonly sha256: string;
    readonly manifestSha256: string;
  };
  readonly files: Readonly<Record<string, UiRenderVendorFilePin>>;
}

/** One catalogue entry, read structurally (the committed artifact's shape). */
export interface UiRenderCatalogEntry {
  readonly [property: string]: unknown;
}

/** The catalogue document (DS §5.2: `$id` = `catalogId`). */
export interface UiRenderCatalogDocument {
  /** Every keyword of the committed artifact stays reachable (§5.2). */
  readonly [property: string]: unknown;
  /** §5.2: `$id` = `catalogId`; the envelope must name exactly this value. */
  readonly catalogId: string;
  /** The catalogue's entries, by component name. */
  readonly components: Readonly<Record<string, UiRenderCatalogEntry>>;
}

/** The built SRI index of the browser artifacts (`dist/browser/sri.json`). */
export interface UiRenderSriDocument {
  readonly version: string;
  readonly files: Readonly<
    Record<string, { readonly [property: string]: unknown; readonly integrity: string }>
  >;
}

/** The verified, ready-to-serve asset set (h2a spec §7.2). */
export interface UiRenderAssets {
  /** The directory the artifacts were loaded from. */
  readonly vendorDir: URL;
  /** True when the developer workspace overlay served the artifacts. */
  readonly workspace: boolean;
  /** The pinned manifest the files were verified against. */
  readonly manifest: UiRenderVendorManifest;
  /** The catalogue document (`catalog.json`). */
  readonly catalog: UiRenderCatalogDocument;
  /** The raw `catalog.json` text (the `a2ui://` resource body). */
  readonly catalogText: string;
  /** The envelope schema (`envelope.json`), the `render` input schema. */
  readonly envelopeSchema: Record<string, unknown>;
  /** The raw `envelope.json` text. */
  readonly envelopeText: string;
  /** The standalone per-component schemas, by component name (optional in a workspace build). */
  readonly schemas: Readonly<Record<string, Record<string, unknown>>>;
  /** The browser build's SRI index (`dist/browser/sri.json`). */
  readonly sri: UiRenderSriDocument;
}

/** Loader options: an alternate vendor tree, or the developer workspace overlay. */
export interface LoadUiRenderAssetsOptions {
  /** A vendor tree that must satisfy the exact pinned file set. */
  readonly vendorDir?: string | URL;
  /** A DS `packages/elements` build admitted under the pinned digests (§7.2). */
  readonly workspaceDir?: string | URL;
}

/** Every refusal carries this marker (h2a spec §7.2). */
function integrityMismatch(detail: string): Error {
  return new Error(`integrity_mismatch: ${detail}`);
}

/** Normalizes a directory locator (string path or URL) to a URL with a trailing slash. */
function toDirUrl(dir: string | URL): URL {
  const url = dir instanceof URL ? dir : pathToFileURL(dir);
  return url.href.endsWith("/") ? url : new URL(`${url.href}/`);
}

/** Lists every file under `root`, as forward-slash paths relative to `root`. */
async function listTreeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isFile()) files.push(rel);
      else if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
    }
  }
  await walk(root, "");
  files.sort();
  return files;
}

/** SHA-256 of one file's bytes. */
async function sha256OfFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads and parses the pinned manifest of a vendor tree. */
async function readVendorManifest(vendorDir: URL): Promise<UiRenderVendorManifest> {
  let text: string;
  try {
    text = await readFile(join(fileURLToPath(vendorDir), "manifest.json"), "utf8");
  } catch {
    throw integrityMismatch(
      `the vendored snapshot has no readable manifest.json under ${fileURLToPath(vendorDir)}`
    );
  }
  let manifest: UiRenderVendorManifest;
  try {
    manifest = JSON.parse(text) as UiRenderVendorManifest;
  } catch (error) {
    throw integrityMismatch(
      `manifest.json is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (manifest.format !== VENDOR_MANIFEST_FORMAT) {
    throw integrityMismatch(
      `manifest.format is ${JSON.stringify(manifest.format)}, not ${JSON.stringify(VENDOR_MANIFEST_FORMAT)}`
    );
  }
  if (manifest.files === undefined || manifest.files === null || typeof manifest.files !== "object") {
    throw integrityMismatch("manifest.json carries no files digest map");
  }
  return manifest;
}

export async function loadUiRenderAssets(
  options?: LoadUiRenderAssetsOptions
): Promise<UiRenderAssets> {
  const workspaceOption =
    options?.workspaceDir ?? process.env["H2A_DS_ELEMENTS_WORKSPACE_DIR"];
  const workspaceDir =
    workspaceOption !== undefined && workspaceOption !== "" ? toDirUrl(workspaceOption) : undefined;
  const vendorDir = toDirUrl(options?.vendorDir ?? DEFAULT_VENDOR_DIR);

  // The pinned digests always come from a vendor manifest: the given vendor
  // tree, or the default snapshot when a workspace overlay is admitted.
  const manifest = await readVendorManifest(workspaceDir === undefined ? vendorDir : DEFAULT_VENDOR_DIR);

  // The artifacts come from the vendor tree, or from the workspace overlay.
  // The vendor tree's own `manifest.json` is the pinning record, not a
  // vendored artifact: it is excluded from the verified file set.
  const sourceDir = workspaceDir ?? vendorDir;
  const sourcePath = fileURLToPath(sourceDir);
  const actualFiles = (await listTreeFiles(sourcePath)).filter((file) => file !== "manifest.json");
  const pinnedFiles = Object.keys(manifest.files);

  if (workspaceDir === undefined) {
    // The vendored snapshot is the exact pinned file set: nothing else may
    // be vendored, and nothing may be missing.
    const extra = actualFiles.filter((file) => !(file in manifest.files));
    if (extra.length > 0) {
      throw integrityMismatch(
        `file ${JSON.stringify(extra[0])} is not part of the pinned build (never vendor anything else)`
      );
    }
    const missing = pinnedFiles.filter((file) => !actualFiles.includes(file));
    if (missing.length > 0) {
      throw integrityMismatch(`pinned file ${JSON.stringify(missing[0])} is missing`);
    }
  } else {
    // A workspace build admits a partial tree, but nothing unpinned and
    // nothing unverified: every present file must match its pin, and the
    // operational trio must be there.
    const unpinned = actualFiles.filter((file) => !(file in manifest.files));
    if (unpinned.length > 0) {
      throw integrityMismatch(
        `workspace file ${JSON.stringify(unpinned[0])} is not part of the pinned build`
      );
    }
    const missingRequired = WORKSPACE_REQUIRED_FILES.filter((file) => !actualFiles.includes(file));
    if (missingRequired.length > 0) {
      throw integrityMismatch(
        `the workspace build is missing the required ${JSON.stringify(missingRequired[0])}`
      );
    }
  }

  // Verify every present file against its pinned SHA-256.
  for (const file of actualFiles) {
    const pinned = manifest.files[file];
    if (pinned === undefined || typeof pinned.sha256 !== "string") {
      throw integrityMismatch(`file ${JSON.stringify(file)} has no pinned sha256`);
    }
    const actual = await sha256OfFile(join(sourcePath, file));
    if (actual !== pinned.sha256) {
      throw integrityMismatch(
        `file ${JSON.stringify(file)} does not match the pinned sha256 (expected ${pinned.sha256}, got ${actual})`
      );
    }
  }

  const catalogText = await readFile(join(sourcePath, "catalog.json"), "utf8");
  let catalog: UiRenderCatalogDocument;
  try {
    catalog = JSON.parse(catalogText) as UiRenderCatalogDocument;
  } catch (error) {
    throw integrityMismatch(
      `catalog.json is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof catalog.catalogId !== "string" || catalog.catalogId.length === 0) {
    throw integrityMismatch("catalog.json carries no catalogId (DS §5.2: $id = catalogId)");
  }

  // The catalogued focus semantic digest must equal the pinned @sentropic/focus
  // v1 schema digest: the wired focus port validates exactly that schema.
  const dossier = (catalog as { components?: { DecisionDossier?: unknown } }).components
    ?.DecisionDossier;
  const semantic = (
    dossier as { readonly "x-sentropic"?: { readonly semantic?: { readonly sha256?: unknown } } } | undefined
  )?.["x-sentropic"]?.semantic;
  if (semantic?.sha256 !== FOCUS_DECISION_DOSSIER_V1_SHA256) {
    throw integrityMismatch(
      `the catalogued DecisionDossier semantic digest is ${JSON.stringify(
        semantic?.sha256
      )}, not the pinned @sentropic/focus v1 schema digest ${FOCUS_DECISION_DOSSIER_V1_SHA256}`
    );
  }

  const envelopeText = await readFile(join(sourcePath, "envelope.json"), "utf8");
  let envelopeSchema: Record<string, unknown>;
  try {
    envelopeSchema = JSON.parse(envelopeText) as Record<string, unknown>;
  } catch (error) {
    throw integrityMismatch(
      `envelope.json is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let sri: UiRenderSriDocument;
  try {
    sri = JSON.parse(await readFile(join(sourcePath, "dist/browser/sri.json"), "utf8")) as UiRenderSriDocument;
  } catch (error) {
    throw integrityMismatch(
      `dist/browser/sri.json is not readable or not parseable JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // The standalone per-component schemas: pinned when vendored, optional in
  // a workspace build, verified by digest above when present.
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const file of actualFiles) {
    if (!file.startsWith("schemas/") || !file.endsWith(".v1.json")) continue;
    const component = basename(file, ".v1.json");
    try {
      schemas[component] = JSON.parse(await readFile(join(sourcePath, file), "utf8")) as Record<
        string,
        unknown
      >;
    } catch (error) {
      throw integrityMismatch(
        `${file} is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    vendorDir: sourceDir,
    workspace: workspaceDir !== undefined,
    manifest,
    catalog,
    catalogText,
    envelopeSchema,
    envelopeText,
    schemas,
    sri,
  };
}
