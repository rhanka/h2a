// @sentropic/harness — neutral, host-agnostic code-work / PR-workflow tooling.
//
// Tooling-only: no product-runtime imports (no Drizzle/Hono/Svelte/Mistral), no
// `@sentropic/*` deps, and NO track import — harness only EMITS neutral artifacts.
export const HARNESS_PACKAGE = '@sentropic/harness';
// Dependency-free runtime validator + frozen verdict-derivation predicate for the v0 seam.
export { validateVerificationRunV0, deriveVerdict, VERIFICATION_CATEGORIES, VIOLATION_SEVERITIES, } from './artifacts/validate-verification-run.js';
export { toWorkEvent } from './run/work-event.js';
export { sentropicProfile } from './profile/sentropic.js';
export { stubProfile } from './profile/stub.js';
// BRANCH.md parser.
export { parseBranchMd } from './branch-md/parse.js';
// Scope classification.
export { classifyPath, matchGlob, globToRegExp } from './scope/scope-boundary.js';
// Checks (C1 branch, C2 scope) + neutral run assembly.
export { checkBranch } from './checks/branch-check.js';
export { checkScope } from './checks/scope-check.js';
export { toVerificationRun } from './run/emit.js';
// Harness skill-pack inventory — the native superpowers-surface replacement.
export { HARNESS_SKILLS, HOST_SKILL_DIR, isHostId } from './skills/manifest.js';
// Pure, arg-based CLI driver (the `harness` bin is a thin wrapper over this).
export { runHarnessCli } from './cli/run.js';
