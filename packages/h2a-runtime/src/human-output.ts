/**
 * Lot L6a: single locale catalog for every human string on the touched
 * paths (D14). Module + per-language data files live in the runtime
 * package (which owns most touched strings), exposed as the public subpath
 * export `./human-output`; the `h2a` package consumes it through its lazy
 * dynamic-load seam (`H/src/runtime/human-output-loader.ts`) — strings are
 * never copied between packages.
 *
 * Locale resolution, in order (proposition): `H2A_LANG`, then
 * `LC_ALL`/`LC_MESSAGES`/`LANG`, then the default locale. Matching is by
 * BCP-47-style primary tag with a fallback chain to the default catalog
 * language. Machine values (outcome codes, versions, ids) are never
 * localised — this module only resolves locales and looks up strings.
 *
 * No rendering change lands here; lot L6 owns rendering.
 */
import { locale as enLocale, strings as enStrings } from "./human-output/catalog-en.js";
import { locale as frLocale, strings as frStrings } from "./human-output/catalog-fr.js";

export const HUMAN_OUTPUT_LOCALES = [enLocale, frLocale] as const;
export type HumanOutputLocale = (typeof HUMAN_OUTPUT_LOCALES)[number];

/** Default catalog language (D14b). */
export const DEFAULT_HUMAN_OUTPUT_LOCALE: HumanOutputLocale = "en";

const CATALOGS: Record<HumanOutputLocale, Record<string, string>> = {
  [enLocale]: enStrings,
  [frLocale]: frStrings,
};

function primaryTag(value: string | undefined): HumanOutputLocale | "unrecognized" | undefined {
  if (value === undefined) return undefined;
  const primary = value.trim().toLowerCase().split(/[-_.@]/, 1)[0];
  if (primary === undefined || primary.length === 0) return undefined;
  if (primary === "en") return "en";
  if (primary === "fr") return "fr";
  return "unrecognized";
}

/**
 * Resolve the locale from the environment. The first SET variable decides;
 * an unrecognized value falls back to the default rather than consulting
 * lower-priority sources (an explicit choice never silently degrades to an
 * implicit one; `C`/`POSIX` mean "no localization" and also land on the
 * default).
 */
export function resolveHumanOutputLocale(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HumanOutputLocale {
  for (const name of ["H2A_LANG", "LC_ALL", "LC_MESSAGES", "LANG"] as const) {
    const tag = primaryTag(env[name]);
    if (tag === undefined) continue;
    return tag === "unrecognized" ? DEFAULT_HUMAN_OUTPUT_LOCALE : tag;
  }
  return DEFAULT_HUMAN_OUTPUT_LOCALE;
}

export interface HumanOutputCatalog {
  readonly locale: HumanOutputLocale;
  readonly strings: Readonly<Record<string, string>>;
}

/** Catalog for a locale, falling back to the default catalog language. */
export function getHumanOutputCatalog(locale: string = DEFAULT_HUMAN_OUTPUT_LOCALE): HumanOutputCatalog {
  const strings = (CATALOGS as Record<string, Record<string, string> | undefined>)[locale];
  if (strings === undefined) return { locale: DEFAULT_HUMAN_OUTPUT_LOCALE, strings: CATALOGS[DEFAULT_HUMAN_OUTPUT_LOCALE] };
  return { locale: locale as HumanOutputLocale, strings };
}

/**
 * Look up one human string. Falls back to the default catalog when the
 * locale lacks the key (the identical-key-sets test makes this unreachable
 * for shipped locales), and to the key itself as a last resort so a missing
 * entry stays machine-readable instead of crashing the caller.
 */
export function humanOutputText(key: string, locale?: string): string {
  const catalog = getHumanOutputCatalog(locale ?? resolveHumanOutputLocale());
  return catalog.strings[key]
    ?? CATALOGS[DEFAULT_HUMAN_OUTPUT_LOCALE][key]
    ?? key;
}
