// Vendored from rhanka/engram@545a57b8911ab108e84fa1778e0f268fe11bf1de: engram-live/integration.ts.
// Compiled with TypeScript 5.9.3 (ES2022/NodeNext, declarations); do not hand-edit.
// @sentropic/engram-live/integration — executable neutral factory
// (spec/SPEC_LIVE_GIT_INDEXING.md §2–3, §11; plan/09 L1b).
//
// The factory composes injected capabilities only: Git, filesystem, clock,
// content, fact-sink, cache and grammar ports. It never imports the
// monolithic root CLI, another @sentropic/* consumer package, the h2a host,
// a model module or a storage-driver handle — those stay outside the neutral
// closure by construction and by tests/live-neutrality.test.ts.
//
// L1b supplies the package/factory seams and grammar loading. Every other
// capability is explicitly unavailable until its lot lands; the factory
// never fabricates facts, writes through the fact sink or silently
// degrades an unavailable capability into an empty success.
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADVERTISED_LANGUAGES, CAPABILITY_IDS, CAPABILITY_PLANNED_LOTS, GRAMMAR_UNAVAILABLE_REASON, NOT_IMPLEMENTED_REASON, validateFactBatch, validateWorkspaceDeclaration, } from "./contracts.js";
export const REQUIRED_STORAGE_FENCING_CONTRACT = {
    enforcedByLots: ["L3a", "L3b-S"],
    requireAtomicLeaseCheckOnFactWrite: true,
    requireAtomicLeaseCheckOnCursorWrite: true,
    requireAtomicLeaseCheckOnGenerationPublish: true,
    requireStorageOwnedIncarnationBinding: true,
    requireAtomicLeaseCheckOnProgressReadWrite: true,
    requireAtomicLeaseCheckOnPark: true,
    requireAtomicLeaseCheckOnRelationRepair: true,
    requireAtomicLeaseCheckOnMarkerDelete: true,
    requireSourceAndProjectionEqualityOnGenerationPublish: true,
    requireSynchronousLeaseRevocationOnShutdown: true,
};
export function validateScopeFencingToken(candidate, expectedScope, expectedIncarnation, nowMs) {
    const errors = [];
    if (typeof candidate !== "object" || candidate === null) {
        return { ok: false, errors: ["fencing token must be a non-null object"] };
    }
    const t = candidate;
    if (!t.scope || typeof t.scope.tenant !== "string" || typeof t.scope.clone !== "string" || typeof t.scope.worktree !== "string")
        errors.push("fencing token requires a complete scope");
    if (!Number.isSafeInteger(t.declarationRevision) || (t.declarationRevision ?? 0) < 1)
        errors.push("fencing token requires declaration revision");
    if (typeof t.epochId !== "string" || !t.epochId)
        errors.push("fencing token requires epoch identity");
    for (const value of [t.tokenId, t.epochId, t.projectionIncarnation, t.scope?.tenant, t.scope?.clone, t.scope?.worktree])
        if (typeof value !== "string" || value.length < 1 || value.length > 1024)
            errors.push("fencing identity must be bounded");
    if (typeof t.tokenId !== "string" || t.tokenId.length === 0) {
        errors.push("fencing token requires a non-empty tokenId");
    }
    if (typeof t.epoch !== "number" || !Number.isSafeInteger(t.epoch) || t.epoch < 1) {
        errors.push("fencing token requires a positive integer epoch");
    }
    if (typeof t.projectionIncarnation !== "string" || t.projectionIncarnation.length === 0) {
        errors.push("fencing token requires a non-empty projectionIncarnation");
    }
    if (typeof t.issuedAt !== "number" ||
        typeof t.expiresAt !== "number" ||
        !Number.isFinite(t.issuedAt) ||
        !Number.isFinite(t.expiresAt) ||
        t.expiresAt <= t.issuedAt) {
        errors.push("fencing token requires finite issuedAt < expiresAt");
    }
    if (expectedScope !== undefined && t.scope !== undefined) {
        if (t.scope.tenant !== expectedScope.tenant ||
            t.scope.clone !== expectedScope.clone ||
            t.scope.worktree !== expectedScope.worktree) {
            errors.push("fencing token scope does not match target scope");
        }
    }
    if (expectedIncarnation !== undefined &&
        t.projectionIncarnation !== undefined &&
        t.projectionIncarnation !== expectedIncarnation) {
        errors.push("fencing token projectionIncarnation does not match active storage incarnation P");
    }
    if (nowMs !== undefined && typeof t.expiresAt === "number" && nowMs >= t.expiresAt) {
        errors.push("fencing token is expired");
    }
    if (nowMs !== undefined && typeof t.issuedAt === "number" && t.issuedAt > nowMs)
        errors.push("fencing token is not yet valid");
    return { ok: errors.length === 0, errors };
}
function decodeJson(bytes) {
    return JSON.parse(new TextDecoder().decode(bytes));
}
function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
// The pinned manifest is validated before any grammar is trusted: a
// manifestVersion number and a languages record whose entries pin a
// non-empty file and sha256 are required.
function isGrammarManifest(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value;
    if (typeof candidate.manifestVersion !== "number")
        return false;
    if (typeof candidate.languages !== "object" || candidate.languages === null || Array.isArray(candidate.languages)) {
        return false;
    }
    return Object.values(candidate.languages).every((entry) => {
        if (typeof entry !== "object" || entry === null)
            return false;
        const record = entry;
        return typeof record.file === "string" && record.file.length > 0
            && typeof record.sha256 === "string" && record.sha256.length > 0;
    });
}
export function createLiveFactory(options) {
    const declarationCheck = validateWorkspaceDeclaration(options.declaration);
    if (!declarationCheck.ok) {
        throw new Error(`invalid live workspace declaration: ${declarationCheck.errors.join("; ")}`);
    }
    const ports = options.ports;
    const distDir = dirname(fileURLToPath(import.meta.url));
    const manifestPath = join(distDir, "..", "grammar-manifest.json");
    const grammarDir = join(distDir, "grammars");
    let manifestCache;
    const loadManifest = async () => {
        if (manifestCache)
            return { ok: true, manifest: manifestCache };
        let decoded;
        try {
            decoded = decodeJson(await ports.filesystem.readFileBytes(manifestPath));
        }
        catch (error) {
            return {
                ok: false,
                reason: `the pinned grammar manifest cannot be read through the filesystem port (${errorMessage(error)})`,
            };
        }
        if (!isGrammarManifest(decoded)) {
            return {
                ok: false,
                reason: "the pinned grammar manifest is invalid: a manifestVersion number and a languages record pinning file/sha256 entries are required",
            };
        }
        manifestCache = decoded;
        return { ok: true, manifest: decoded };
    };
    const grammarLoadCache = new Map();
    return {
        describeCapabilities() {
            return CAPABILITY_IDS.map((capability) => ({
                capability,
                state: "unavailable",
                reason: NOT_IMPLEMENTED_REASON,
                plannedLot: CAPABILITY_PLANNED_LOTS[capability],
            }));
        },
        async runCapability(capability) {
            if (!CAPABILITY_IDS.includes(capability)) {
                throw new Error(`unknown capability "${String(capability)}"; known capabilities: ${CAPABILITY_IDS.join(", ")}`);
            }
            // Explicit unavailability: no port call, no fabricated facts, no
            // empty-success degradation.
            return {
                capability,
                state: "unavailable",
                reason: NOT_IMPLEMENTED_REASON,
                plannedLot: CAPABILITY_PLANNED_LOTS[capability],
                delivered: false,
            };
        },
        grammarCoverage(language) {
            // Synchronous coverage uses the pinned manifest; loadGrammar caches the
            // executed result per language so coverage reflects verified assets.
            const loaded = grammarLoadCache.get(language);
            if (loaded?.state === "available") {
                return { axis: "ast", language, state: "current", reason: `packaged grammar verified (sha256 ${loaded.bytesSha256})` };
            }
            return {
                axis: "ast",
                language,
                state: "unavailable",
                reason: `${GRAMMAR_UNAVAILABLE_REASON}: "${language}" has no verified packaged grammar in this session`,
            };
        },
        grammarCoverageReport(language) {
            const coverage = this.grammarCoverage(language);
            return {
                axis: coverage.axis,
                language,
                state: coverage.state,
                reason: coverage.reason,
                checkedAt: ports.clock.now(),
            };
        },
        async loadGrammar(language) {
            const cached = grammarLoadCache.get(language);
            if (cached)
                return cached;
            const unavailable = (reason) => {
                const result = { language, state: "unavailable", reason };
                grammarLoadCache.set(language, result);
                return result;
            };
            // Reading and validating the manifest is part of the load: an absent,
            // unreadable or invalid manifest yields an explicit unavailable result,
            // never a thrown error and never a silent empty success.
            const manifestOutcome = await loadManifest();
            if (!manifestOutcome.ok || manifestOutcome.manifest === undefined) {
                return unavailable(`${GRAMMAR_UNAVAILABLE_REASON}: ${manifestOutcome.reason ?? "the pinned grammar manifest is unavailable"}`);
            }
            // Clean own-property lookup: inherited names such as "constructor" or
            // "toString" never reach a manifest entry.
            if (!Object.hasOwn(manifestOutcome.manifest.languages, language)) {
                return unavailable(`${GRAMMAR_UNAVAILABLE_REASON}: "${language}" is absent from the pinned grammar manifest`);
            }
            const entry = manifestOutcome.manifest.languages[language];
            let bytes;
            try {
                bytes = await ports.filesystem.readFileBytes(join(grammarDir, entry.file));
            }
            catch (error) {
                return unavailable(`${GRAMMAR_UNAVAILABLE_REASON}: the packaged WASM for "${language}" cannot be read through the filesystem port (${errorMessage(error)})`);
            }
            const digest = sha256(bytes);
            if (digest !== entry.sha256) {
                return unavailable(`packaged grammar digest mismatch for "${language}": pinned ${entry.sha256}, read ${digest}`);
            }
            try {
                const grammar = await ports.grammarRuntime.loadLanguage(bytes);
                const result = {
                    language,
                    state: "available",
                    bytesSha256: digest,
                    grammar,
                };
                grammarLoadCache.set(language, result);
                return result;
            }
            catch (error) {
                return unavailable(`grammar runtime rejected the packaged WASM for "${language}": ${errorMessage(error)}`);
            }
        },
        validateBatch(batch) {
            return validateFactBatch(batch);
        },
    };
}
/** The advertised grammar matrix of this build, from the pinned manifest data. */
export const ADVERTISED_GRAMMAR_LANGUAGES = ADVERTISED_LANGUAGES;
// The canonical identity derivation (L6a, spec §3/§12) is part of the public
// integration surface: h2a and cluster-mesh mint cloneId/worktreeId/
// declarationId through exactly these functions, so every seat derives
// byte-identical opaque ids from identical components. The minting needs
// node:crypto (sha256), which keeps it out of the data-pure /contracts
// entry; the derivation itself stays pure and deterministic over its
// arguments (see ./registration.js).
export { deriveCloneIdentity, deriveWorktreeIdentity, deriveDeclarationIdentity, } from "./registration.js";
