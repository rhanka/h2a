export interface HarnessProfile {
    /** Profile identifier, e.g. 'sentropic' | 'stub'. */
    id: string;
    /** Globs forbidden by default unless a BRANCH.md explicitly Allows them (C2). */
    forbiddenPathDefaults: string[];
    /** Grammar of a valid scope-exception id in BRANCH.md (C2 conditional binding). */
    exceptionIdPattern: RegExp;
    /** When true, a Conditional path may be touched only if a matching exception id exists (C2). */
    conditionalRequiresException: boolean;
    /** How the current branch is compared to the expected branch (C1). */
    branchMatch: 'exact' | 'prefix';
}
