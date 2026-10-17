// Vendored from rhanka/engram@545a57b8911ab108e84fa1778e0f268fe11bf1de: engram-live/integration.ts.
// Compiled with TypeScript 5.9.3 (ES2022/NodeNext, declarations); do not hand-edit.
import { type CapabilityId, type CapabilityStatus, type CoverageReport, type FactBatchDto, type GrammarCoverageDto, type LiveScope, type ValidationResult, type WorkspaceDeclarationDto } from "./contracts.js";
export interface GitPort {
    /** Bounded Git read seam; operations arrive with L2a/L2b. Unused in L1b. */
    readonly liveGitSeam: "host-git";
}
export interface FilesystemPort {
    /** Reads a file's bytes through the injected host filesystem. */
    readFileBytes(path: string): Promise<Uint8Array>;
}
export interface ClockPort {
    /** Milliseconds since the Unix epoch, host-supplied and test-fakeable. */
    now(): number;
}
export interface ContentPort {
    /** Content classification seam; policies arrive with L4b/L5. Unused in L1b. */
    readonly liveContentSeam: "host-content";
}
export interface FactSinkPort {
    /** Durable receipt of a fact batch; separate from publication (spec §3). */
    deliver(batch: FactBatchDto, fencingToken: ScopeFencingTokenDto): Promise<{
        received: true;
        batchId: string;
        receiptId?: string;
    }>;
}
/**
 * Mandatory scope fencing token threaded from E (L6b) across every write,
 * cursor, and publication port to S (L3a/L3b-S) (Opus Amendment 2).
 */
export interface ScopeFencingTokenDto {
    readonly tokenId: string;
    readonly scope: LiveScope;
    readonly epoch: number;
    readonly epochId: string;
    readonly declarationRevision: number;
    readonly projectionIncarnation: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
}
/**
 * Required S-side storage contract for L3a / L3b-S (Opus Amendment 2):
 * Every storage write, cursor update, and generation publication MUST atomically
 * verify the caller's ScopeFencingTokenDto against the active writer lease and
 * storage-owned projection incarnation P inside the storage transaction.
 */
export interface StorageIncarnationPort {
    incarnation(): string;
    hasGeneration(incarnation: string, generationId: string): boolean;
    validateFencingToken(token: ScopeFencingTokenDto, nowMs: number): ValidationResult;
}
export declare const REQUIRED_STORAGE_FENCING_CONTRACT: {
    readonly enforcedByLots: readonly ["L3a", "L3b-S"];
    readonly requireAtomicLeaseCheckOnFactWrite: true;
    readonly requireAtomicLeaseCheckOnCursorWrite: true;
    readonly requireAtomicLeaseCheckOnGenerationPublish: true;
    readonly requireStorageOwnedIncarnationBinding: true;
    readonly requireAtomicLeaseCheckOnProgressReadWrite: true;
    readonly requireAtomicLeaseCheckOnPark: true;
    readonly requireAtomicLeaseCheckOnRelationRepair: true;
    readonly requireAtomicLeaseCheckOnMarkerDelete: true;
    readonly requireSourceAndProjectionEqualityOnGenerationPublish: true;
    readonly requireSynchronousLeaseRevocationOnShutdown: true;
};
export declare function validateScopeFencingToken(candidate: unknown, expectedScope?: LiveScope, expectedIncarnation?: string, nowMs?: number): ValidationResult;
export interface CachePort {
    /** Bounded, versioned cache seam; wired by L2b/L5. Unused in L1b. */
    readonly liveCacheSeam: "host-cache";
}
export interface GrammarRuntimePort {
    /** Loads a tree-sitter WASM grammar from bytes (e.g. web-tree-sitter). */
    loadLanguage(wasm: Uint8Array): Promise<unknown>;
}
export interface LiveFactoryPorts {
    readonly git: GitPort;
    readonly filesystem: FilesystemPort;
    readonly clock: ClockPort;
    readonly content: ContentPort;
    readonly factSink: FactSinkPort;
    readonly cache: CachePort;
    readonly grammarRuntime: GrammarRuntimePort;
}
export interface CreateLiveFactoryOptions {
    readonly ports: LiveFactoryPorts;
    readonly declaration: WorkspaceDeclarationDto;
}
export interface CapabilityResult {
    readonly capability: CapabilityId;
    readonly state: "unavailable";
    readonly reason: string;
    readonly plannedLot: string;
    readonly delivered: false;
}
export interface GrammarLoadResult {
    readonly language: string;
    readonly state: "available" | "unavailable";
    readonly bytesSha256?: string;
    readonly grammar?: unknown;
    readonly reason?: string;
}
export interface LiveFactory {
    describeCapabilities(): readonly CapabilityStatus[];
    runCapability(capability: CapabilityId): Promise<CapabilityResult>;
    grammarCoverage(language: string): GrammarCoverageDto;
    grammarCoverageReport(language: string): CoverageReport;
    loadGrammar(language: string): Promise<GrammarLoadResult>;
    validateBatch(batch: unknown): ValidationResult;
}
export declare function createLiveFactory(options: CreateLiveFactoryOptions): LiveFactory;
/** The advertised grammar matrix of this build, from the pinned manifest data. */
export declare const ADVERTISED_GRAMMAR_LANGUAGES: readonly string[];
export { deriveCloneIdentity, deriveWorktreeIdentity, deriveDeclarationIdentity, type DeclarationIdentityDto, type DeriveCloneIdentityInput, type DeriveWorktreeIdentityInput, type DeriveDeclarationIdentityInput, } from "./registration.js";
