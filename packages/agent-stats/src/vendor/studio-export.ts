/**
 * h2a-owned static-studio export guard for agent-stats `--studio`.
 *
 * Provenance: error contract vendored from engram `src/studio-export.ts`
 * (StudioSpaNotBuiltError, graph.json + safe-target guards) at engram commit
 * e432240f8d5ea670efe672bfac52969d944cd59f. The full engram studio bundle
 * (SPA + ontology/scene emitters) is NOT carried into h2a: h2a ships no
 * prebuilt studio SPA, so after the same guards this helper always reports
 * the same StudioSpaNotBuiltError engram raises when its SPA is missing.
 * Deviation is documented in the package README.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Thrown when the prebuilt studio SPA is not available on disk. */
export class StudioSpaNotBuiltError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioSpaNotBuiltError";
  }
}

export interface BuildStaticStudioOptions {
  /** State dir (must contain graph.json). */
  stateDir: string;
  /** Target export dir (created if missing by a full implementation). */
  outDir: string;
  /** Override the resolved SPA dir (tests). */
  spaDir?: string;
  /** Optional ontology profile path (accepted, unused in h2a). */
  profilePath?: string;
  /** Extra nodes (accepted, unused in h2a). */
  seedNodes?: Array<Record<string, unknown>>;
  /** Emit a warning (non-fatal). Defaults to console.warn. */
  onWarning?: (message: string) => void;
}

export interface BuildStaticStudioResult {
  outDir: string;
  spaDir: string;
}

/**
 * Guard (a): never export into the state dir or an ancestor of it.
 * Verbatim from engram studio-export.ts.
 */
function assertSafeExportTarget(stateDir: string, outDir: string): void {
  const resolvedState = resolve(stateDir);
  const resolvedOut = resolve(outDir);
  if (resolvedOut === resolvedState) {
    throw new Error(
      `refusing to export into the state dir (${resolvedState}); choose a separate out dir like .graphify/studio`,
    );
  }
  const rel = relative(resolvedOut, resolvedState);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    throw new Error(
      `refusing to export into ${resolvedOut}: it contains the state dir ${resolvedState}; choose a separate out dir like .graphify/studio`,
    );
  }
}

/**
 * h2a behavior: same guards as engram, then StudioSpaNotBuiltError because
 * h2a ships no prebuilt studio SPA.
 */
export function buildStaticStudio(
  options: BuildStaticStudioOptions,
): BuildStaticStudioResult {
  const { stateDir, outDir } = options;
  const graphPath = join(stateDir, "graph.json");
  if (!existsSync(graphPath)) {
    throw new Error(`graph.json not found in state dir: ${graphPath}`);
  }

  assertSafeExportTarget(stateDir, outDir);

  const spaDir = options.spaDir ?? resolve("studio-app");
  if (!existsSync(join(spaDir, "index.html"))) {
    throw new StudioSpaNotBuiltError(
      "Studio SPA not built. Run `npm run build` (or `node scripts/build-studio-app.mjs`) " +
        "to produce the prebuilt studio app before exporting a static studio.",
    );
  }

  return { outDir: resolve(outDir), spaDir: resolve(spaDir) };
}
