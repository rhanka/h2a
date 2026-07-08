// Canonical inventory of the harness skill pack — the native replacement for
// the legacy superpowers method surface.
//
// `harness skills install --host <h>` reports this plan; the pack ships in the npm tarball under
// `skills/<name>/SKILL.md` (see `package.json` `files`). The host loads each as `harness/<name>`.
// `using-harness` MUST be loaded first — it carries the replacement directive:
// sentropic code-work routes to `harness/*`, never to legacy superpowers.
export const HARNESS_SKILLS = [
    { name: 'using-harness', summary: 'index + replacement directive (load FIRST)', legacySuperpowers: 'using-superpowers' },
    { name: 'brainstorm', summary: 'spec-ladder STUDY→VOL→EVOL + ≥2-peer review + batched decisions', legacySuperpowers: 'brainstorming' },
    { name: 'test', summary: 'test-pyramid + scoped-test loop (not "tdd")', legacySuperpowers: 'test-driven-development' },
    { name: 'debug', summary: 'generic root-cause loop', legacySuperpowers: 'systematic-debugging' },
    { name: 'review', summary: '≥2-peer consensus review', legacySuperpowers: 'requesting-code-review' },
    { name: 'plan', summary: 'spec-ladder + BRANCH.md lots; completes with track', legacySuperpowers: 'writing-plans' },
    { name: 'adopt', summary: 'adapt the harness method to ANY repo (profile)' },
];
/** Host → the skills directory `skills install` copies the pack into. */
export const HOST_SKILL_DIR = {
    claude: '.claude/skills',
    codex: '.codex/skills',
    gemini: '.gemini/skills',
};
export function isHostId(s) {
    return s === 'claude' || s === 'codex' || s === 'gemini';
}
