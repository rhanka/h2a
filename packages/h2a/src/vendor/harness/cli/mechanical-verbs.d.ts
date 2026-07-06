import { type FlagValue } from './args.js';
export declare const MECHANICAL_VERBS: readonly ["verify", "init", "audit"];
export type MechanicalVerb = (typeof MECHANICAL_VERBS)[number];
/**
 * Handle a mechanical/producer verb. Returns the exit code (`null` when `verb` is not one of
 * `verify`/`init`/`audit`). Emits a `VerificationRun` (`--json`) or a human summary via `out`.
 */
export declare function handleMechanicalVerb(positionals: string[], flags: Record<string, FlagValue>, out: (s: string) => void): number | null;
