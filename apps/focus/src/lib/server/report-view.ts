// server-only: materialize the track "conductor view" (buckets + directives + keystone) for the app.
//
// track is the SYSTEM OF RECORD; this app is a READ surface. We do NOT re-implement track's directive
// engine — we call it. The engine lives in the monorepo package `@sentropic/track` (built to
// `packages/track/dist`). To keep the SvelteKit/Vite bundle free of track's node-only deps (fs, the MCP
// SDK, …) we import the built ESM at RUNTIME via a dynamic `import(/* @vite-ignore */ …)` — Vite never
// tries to resolve or bundle it. This module is under `lib/server/`, so it is server-only by construction.
//
// The engine emits JSON via `formatWpConductor(tree, 'json', decisions)` (the same conductor view the
// `track report --format html` render is built from). We parse it and hand the app a typed payload.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Buckets, ConductorView, ReportError, ReportPayload } from '$lib/track-model';

/**
 * The repo whose track log we read. Defaults to two levels up from the app cwd (apps/focus → repo root),
 * overridable via FOCUS_REPO_ROOT (e.g. when this app is served by h2a against another checkout).
 */
function repoRoot(): string {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), '..', '..');
}

interface TrackModule {
  TrackReader: new (eventsPath: string) => {
    report(opts: { baselineCommit: string; decisions?: boolean; wpTree?: boolean }): {
      buckets: Buckets;
      wpTree?: unknown[];
      decisions?: unknown[];
    };
  };
  formatWpConductor: (tree: unknown[], format: 'json' | 'text' | 'md', decisions?: unknown[]) => string;
}

let cached: TrackModule | undefined;

async function loadTrack(root: string): Promise<TrackModule> {
  if (cached) return cached;
  const dist = path.join(root, 'packages', 'track', 'dist', 'index.js');
  if (!existsSync(dist)) {
    throw new Error(
      `track build introuvable (${dist}). Lancez \`npm run build -w @sentropic/track\` à la racine du dépôt.`
    );
  }
  const mod = (await import(/* @vite-ignore */ pathToFileURL(dist).href)) as TrackModule;
  cached = mod;
  return mod;
}

function baselineCommit(root: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'HEAD';
  }
}

/** Build the full report payload from the live track log, or a structured error the UI can render. */
export async function loadReport(): Promise<ReportPayload | ReportError> {
  try {
    const root = repoRoot();
    const eventsPath = process.env.FOCUS_TRACK_EVENTS ?? path.join(root, '.track', 'events.jsonl');
    if (!existsSync(eventsPath)) {
      return { ok: false, error: `Journal track introuvable (${eventsPath}).` };
    }
    const track = await loadTrack(root);
    const commit = baselineCommit(root);
    const reader = new track.TrackReader(eventsPath);
    const report = reader.report({ baselineCommit: commit, decisions: true, wpTree: true });
    const viewJson = track.formatWpConductor(report.wpTree ?? [], 'json', report.decisions ?? []);
    const view = JSON.parse(viewJson) as ConductorView;
    return {
      ok: true,
      baselineCommit: commit,
      generatedAt: new Date().toISOString(),
      buckets: report.buckets,
      view
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
