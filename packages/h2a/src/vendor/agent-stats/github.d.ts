export interface CollectionState {
    hasNextPage: boolean;
    totalCount: number | null;
    inclusionIds: Array<number | string>;
    apiError?: string;
}
export interface Diagnostic {
    code: string;
    message: string;
    path?: string;
}
export declare function assertCollectionComplete(state: CollectionState): Diagnostic[];
export declare function dedupePrNumbers(ids: Array<number | string>): Array<number | string>;
export declare function joinRunViaHeadSha<T extends {
    headSha: string;
}>(run: {
    headSha: string;
    pullRequests: T[];
}, pullRequests: T[]): T;
//# sourceMappingURL=github.d.ts.map