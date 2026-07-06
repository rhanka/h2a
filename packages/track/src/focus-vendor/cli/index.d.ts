/**
 * `@sentropic/focus/cli` — the headless read-only Focus CLI driver (Focus-M1 L3).
 *
 * Per SPEC_VOL_FOCUS §4b L3: the FIRST usable end-to-end dogfood. Reads a REAL track decision
 * dossier (via the L2 `/track` binding `readDecisionDossier`) and renders it READ-ONLY to one of
 * the three deterministic surfaces (terminal / MD / HTML — HTML mandatory). It is wired into the
 * `stp` umbrella CLI as the in-repo `focus` subcommand (the manifest stays cross-repo-only).
 *
 * This module exports the federated-subcommand shape `{ run, version }` so the `stp` composition
 * root can register it through the same typed contract the cross-repo federation loader uses. The
 * `run` resolves to a process exit code (0 = success; non-zero with a clear stderr message on error
 * — missing args, decision not found, contract mismatch). It is READ-ONLY: NO track write, NO new
 * track event (those are L4).
 *
 *   stp focus <decision-id> [--format terminal|md|html] [--workspace <ws>]
 *                           [--baseline-commit <sha>] [--events-path <path>]
 *
 * Defaults: `--events-path` = `.track/events.jsonl`, `--format` = `terminal`. `--workspace` is
 * required (a decision lives in a per-workspace canevas; there is no safe default).
 */
/** The `{ run, version }` contract surfaced to the `stp` subcommand registry. */
export declare const version: string;
/**
 * IO sinks for {@link run}. Defaults wire `process.stdout`/`process.stderr` so the CLI is testable
 * without capturing the global streams (the federation loader uses the same injectable-deps style).
 */
export interface FocusCliDeps {
    /** Where rendered output goes (default: stdout). */
    readonly out?: (text: string) => void;
    /** Where error messages go (default: stderr). */
    readonly error?: (text: string) => void;
}
/**
 * Run the read-only Focus CLI. Returns a process exit code:
 *   0 — rendered successfully;
 *   2 — usage error (bad/missing args; also `--help`);
 *   3 — the decision was not found in the read log;
 *   4 — the installed `@sentropic/track/read` contract major is incompatible;
 *   1 — any other read/render failure.
 *
 * READ-ONLY: it never writes a track event. The `readAt` timestamp is captured here (the CLI is the
 * clock boundary; the L2 binding itself is clockless).
 */
export declare const run: (argv: readonly string[], deps?: FocusCliDeps) => Promise<number>;
