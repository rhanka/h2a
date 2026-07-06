import type { WorkEventContext } from '../run/work-event.js';
import { type FlagValue } from './args.js';
/** The recorder verbs handled here (not the `check`/`verify`/`init`/`audit` producers). */
export declare const METHOD_VERBS: readonly ["brainstorm", "debug", "review", "plan", "test", "branch", "skills"];
export type MethodVerb = (typeof METHOD_VERBS)[number];
export declare function isMethodVerb(v: string | undefined): v is MethodVerb;
/** Pure work-event context — the caller injects commit/branch/env; the driver passes placeholders. */
export declare function workContext(flags: Record<string, FlagValue>): WorkEventContext;
/**
 * Handle a method/recorder verb. Returns the exit code; emits a `WorkEvent` (JSON with `--json`)
 * or human-readable guidance via `out`. `null` is returned when `verb` is not a method verb.
 */
export declare function handleMethodVerb(positionals: string[], flags: Record<string, FlagValue>, out: (s: string) => void): number | null;
