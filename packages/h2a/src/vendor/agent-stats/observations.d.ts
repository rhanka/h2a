import type { CohortQuantiles, ScenarioQuantiles } from "./types.js";
export interface GithubSample {
    cohorts: Record<string, Array<number | string>>;
    pullRequests: Array<{
        number: number | string;
        createdAt: string;
        mergedAt: string | null;
    }>;
}
export interface EngramCohort {
    pullRequests: Array<{
        createdAt: string;
        mergedAt: string | null;
    }>;
}
export declare function openToMergeOrNull(input: {
    createdAt: string;
    mergedAt: string | null;
}): number | null;
export declare function loadGithubCohortSeconds(raw: GithubSample, cohortKey: string): number[];
export declare function loadEngramCohortSeconds(raw: EngramCohort): number[];
export declare function computeCohortQuantiles(values: number[]): CohortQuantiles;
/** Displayed, rounded start-to-open proxies in seconds (§3.4). */
export declare const START_TO_OPEN_PROXIES_SECONDS: number[];
export declare function buildScenarioQuantiles(baseOpenToMerge: number[]): ScenarioQuantiles;
//# sourceMappingURL=observations.d.ts.map