/**
 * Lot L6a: lazy loader seam for the runtime locale catalog, following the
 * established peer-runtime seam (`H/src/status-surface.ts`
 * `defaultRuntimeProjection`). The catalog lives in
 * `@sentropic/h2a-runtime/human-output` (data modules compiled into its
 * `dist`); this package never copies strings and gains no hard dependency
 * it does not have today — the specifier stays a string and the import is
 * dynamic. When the catalog cannot load (absent dist, missing export), the
 * loader degrades to a NAMED diagnostic so callers emit machine output —
 * never a second hardcoded catalog.
 */

const HUMAN_OUTPUT_PACKAGE = "@sentropic/h2a-runtime/human-output";

export type HumanOutputImportFn = (specifier: string) => Promise<unknown>;

export interface LoadedHumanOutputCatalog {
  readonly locale: string;
  readonly strings: Readonly<Record<string, string>>;
}

export type LoadHumanOutputResult =
  | { readonly ok: true; readonly catalog: LoadedHumanOutputCatalog }
  | { readonly ok: false; readonly reason: "human-output-unavailable"; readonly detail?: string };

function isCatalog(value: unknown): value is LoadedHumanOutputCatalog {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { locale?: unknown; strings?: unknown };
  return typeof record.locale === "string"
    && typeof record.strings === "object"
    && record.strings !== null;
}

export async function loadHumanOutputCatalog(
  importFn?: HumanOutputImportFn,
  locale?: string,
): Promise<LoadHumanOutputResult> {
  const runImport = importFn ?? ((specifier: string) => import(specifier));
  let runtime: unknown;
  try {
    runtime = await runImport(HUMAN_OUTPUT_PACKAGE);
  } catch (error) {
    return {
      ok: false,
      reason: "human-output-unavailable",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
  // Lot L6 (D14): with no explicit locale the catalog resolves through the
  // runtime's own env rule (H2A_LANG > LC_ALL > LC_MESSAGES > LANG, BCP-47
  // primary tag, default on unknown) — H never reimplements it.
  let resolved = locale;
  if (resolved === undefined) {
    const resolveLocale = (runtime as { resolveHumanOutputLocale?: unknown }).resolveHumanOutputLocale;
    if (typeof resolveLocale !== "function") {
      return { ok: false, reason: "human-output-unavailable", detail: "resolveHumanOutputLocale is not a function" };
    }
    try {
      resolved = (resolveLocale as () => string)();
    } catch (error) {
      return {
        ok: false,
        reason: "human-output-unavailable",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }
  const getCatalog = (runtime as { getHumanOutputCatalog?: unknown }).getHumanOutputCatalog;
  if (typeof getCatalog !== "function") {
    return { ok: false, reason: "human-output-unavailable", detail: "getHumanOutputCatalog is not a function" };
  }
  let catalog: unknown;
  try {
    catalog = (getCatalog as (locale?: string) => unknown)(resolved);
  } catch (error) {
    return {
      ok: false,
      reason: "human-output-unavailable",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
  if (!isCatalog(catalog)) {
    return { ok: false, reason: "human-output-unavailable", detail: "catalog has no locale/strings" };
  }
  return { ok: true, catalog };
}
