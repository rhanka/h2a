export type HostId = 'claude' | 'codex' | 'gemini';
export interface SkillEntry {
    /** Skill id; loaded by a host under the `harness/<name>` namespace. */
    name: string;
    /** One-line purpose. */
    summary: string;
    /** Legacy superpowers skill replaced by this harness skill, if any. */
    legacySuperpowers?: string;
}
export declare const HARNESS_SKILLS: SkillEntry[];
/** Host → the skills directory `skills install` copies the pack into. */
export declare const HOST_SKILL_DIR: Record<HostId, string>;
export declare function isHostId(s: string | undefined): s is HostId;
