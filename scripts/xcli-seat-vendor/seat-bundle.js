// @sentropic/llm-mesh/enrollment/seat-bundle.ts
//
// SeatBundleV1: frozen five-CLI seat envelope and source contract.
// Lot L0a, synthetic first: types plus static validators only.
// This module performs no home, keyring, network or provider access.
// Native profile variants stay UNVERIFIED until observed; fixtures are invented.
export const SEAT_BUNDLE_SCHEMA_VERSION = 1;
/** GitHub repository-secret snapshot limit; each serialized bundle must fit. */
export const SEAT_BUNDLE_MAX_BYTES = 48 * 1024;
/** Package enrollment identity per CLI; agy enrolls as cloud-code. */
export const SEAT_PACKAGE_PROVIDER_ID = {
    agy: 'cloud-code',
    codex: 'codex',
    vibe: 'mistral-vibe',
    muse: 'muse',
    claude: 'claude-code',
};
/** Application receiver tuple for agy; application cloud-code targets gemini and is refused. */
export const SEAT_AGY_APPLICATION_TUPLE = {
    transportProviderId: 'antigravity',
    targetProviderId: 'cloudcode-pa',
    productAccountSource: 'antigravity',
};
/** Channel rank: a bundle claim above the granted channel is an escalation. */
const AUTHORITY_RANK = { consumer: 0, 'native-store': 1, custodian: 2 };
/** Refresh-capable key pattern, matched case-insensitively against every key. */
const REFRESH_KEY_PATTERN = /refresh|session.?token|device.?(code|token)/i;
const TOP_LEVEL_KEYS = [
    'identity', 'provenance', 'authority', 'credentialClass',
    'lifecycle', 'canonical', 'nativeUse', 'meshUse',
];
const IDENTITY_KEYS = [
    'schemaVersion', 'seatRef', 'refreshFamilyRef', 'ownerScope', 'cli',
    'packageProviderId', 'issuingClientRef', 'endpointFamily',
    'credentialFormatVersion', 'nativeCliVersion', 'os',
];
const PROVENANCE_KEYS = ['enrollmentSource', 'accountBinding', 'entitlementClass'];
const LIFECYCLE_KEYS = [
    'epoch', 'generation', 'operationId', 'issuedAt',
    'providerExpiry', 'localExpiryPolicy', 'refreshAuthority',
];
const CANONICAL_KEYS = ['kind', 'materialRef'];
const PROJECTION_KEYS = ['kind', 'accessRef', 'reason'];
function fail(code, detail) {
    return { ok: false, code, detail };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function unknownKey(value, allowed) {
    return Object.keys(value).find((k) => !allowed.includes(k)) ?? null;
}
function findRefreshKey(value, depth) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = findRefreshKey(item, depth + 1);
            if (hit)
                return hit;
        }
        return null;
    }
    if (!isRecord(value))
        return null;
    for (const key of Object.keys(value)) {
        if (REFRESH_KEY_PATTERN.test(key))
            return { key, depth };
        const hit = findRefreshKey(value[key], depth + 1);
        if (hit)
            return hit;
    }
    return null;
}
function nonEmpty(value) {
    return typeof value === 'string' && value.length > 0;
}
function validDate(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function validInt(value, min) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min;
}
/** Structural validation of one bundle; predecessor comparison stays in isStaleGeneration. */
export function validateSeatBundle(bundle, ctx) {
    let serialized = '';
    try {
        serialized = JSON.stringify(bundle) ?? '';
    }
    catch {
        return fail('schema-mismatch', 'bundle is not JSON-serializable');
    }
    if (new TextEncoder().encode(serialized).length > SEAT_BUNDLE_MAX_BYTES) {
        return fail('size-exceeded', 'bundle exceeds 48 KiB');
    }
    if (!isRecord(bundle))
        return fail('schema-mismatch', 'bundle must be an object');
    const badTop = unknownKey(bundle, TOP_LEVEL_KEYS);
    if (badTop)
        return fail('unknown-field', `unknown top-level field: ${badTop}`);
    const { identity, provenance, authority, credentialClass, lifecycle, canonical, nativeUse, meshUse } = bundle;
    if (!isRecord(identity))
        return fail('schema-mismatch', 'identity must be an object');
    if (!isRecord(provenance))
        return fail('schema-mismatch', 'provenance must be an object');
    if (!isRecord(lifecycle))
        return fail('schema-mismatch', 'lifecycle must be an object');
    if (!isRecord(meshUse))
        return fail('schema-mismatch', 'meshUse must be an object');
    const badIdentity = unknownKey(identity, IDENTITY_KEYS);
    if (badIdentity)
        return fail('unknown-field', `unknown identity field: ${badIdentity}`);
    const badProvenance = unknownKey(provenance, PROVENANCE_KEYS);
    if (badProvenance)
        return fail('unknown-field', `unknown provenance field: ${badProvenance}`);
    const badLifecycle = unknownKey(lifecycle, LIFECYCLE_KEYS);
    if (badLifecycle)
        return fail('unknown-field', `unknown lifecycle field: ${badLifecycle}`);
    if (identity['schemaVersion'] !== SEAT_BUNDLE_SCHEMA_VERSION) {
        return fail('schema-mismatch', 'identity.schemaVersion must be 1');
    }
    const cli = identity['cli'];
    if (cli !== 'agy' && cli !== 'codex' && cli !== 'vibe' && cli !== 'muse' && cli !== 'claude') {
        return fail('client-mismatch', 'identity.cli must be one of the five seat CLIs');
    }
    if (identity['packageProviderId'] !== SEAT_PACKAGE_PROVIDER_ID[cli]) {
        return fail('client-mismatch', `identity.packageProviderId must be ${SEAT_PACKAGE_PROVIDER_ID[cli]}`);
    }
    if (!nonEmpty(identity['issuingClientRef'])) {
        return fail('client-mismatch', 'identity.issuingClientRef must be non-empty');
    }
    if (!nonEmpty(identity['endpointFamily'])) {
        return fail('client-mismatch', 'identity.endpointFamily must be non-empty');
    }
    if (ctx?.issuingClientRef !== undefined && identity['issuingClientRef'] !== ctx.issuingClientRef) {
        return fail('client-mismatch', 'identity.issuingClientRef does not match the expected client');
    }
    if (ctx?.endpointFamily !== undefined && identity['endpointFamily'] !== ctx.endpointFamily) {
        return fail('client-mismatch', 'identity.endpointFamily does not match the expected family');
    }
    if (!nonEmpty(identity['seatRef']))
        return fail('schema-mismatch', 'identity.seatRef must be non-empty');
    if (!nonEmpty(identity['ownerScope']))
        return fail('schema-mismatch', 'identity.ownerScope must be non-empty');
    if (!nonEmpty(identity['credentialFormatVersion'])) {
        return fail('schema-mismatch', 'identity.credentialFormatVersion must be non-empty');
    }
    if (identity['os'] !== undefined &&
        identity['os'] !== 'linux' &&
        identity['os'] !== 'macos' &&
        identity['os'] !== 'windows') {
        return fail('schema-mismatch', 'identity.os must be linux, macos or windows');
    }
    if (ctx?.ownerScope !== undefined && identity['ownerScope'] !== ctx.ownerScope) {
        return fail('owner-mismatch', 'identity.ownerScope does not match the verified owner');
    }
    if (provenance['enrollmentSource'] !== 'cli')
        return fail('schema-mismatch', 'provenance.enrollmentSource must be cli');
    if (!nonEmpty(provenance['accountBinding']))
        return fail('schema-mismatch', 'provenance.accountBinding must be non-empty');
    if (!nonEmpty(provenance['entitlementClass'])) {
        return fail('schema-mismatch', 'provenance.entitlementClass must be non-empty');
    }
    if (!validInt(lifecycle['epoch'], 1))
        return fail('invalid-lifecycle', 'lifecycle.epoch must be an integer >= 1');
    if (!validInt(lifecycle['generation'], 0)) {
        return fail('invalid-lifecycle', 'lifecycle.generation must be an integer >= 0');
    }
    if (!nonEmpty(lifecycle['operationId']))
        return fail('invalid-lifecycle', 'lifecycle.operationId must be non-empty');
    if (!validDate(lifecycle['issuedAt']))
        return fail('invalid-lifecycle', 'lifecycle.issuedAt must be a valid date');
    if (!nonEmpty(lifecycle['localExpiryPolicy'])) {
        return fail('invalid-lifecycle', 'lifecycle.localExpiryPolicy must be non-empty');
    }
    if (lifecycle['refreshAuthority'] !== 'custody' && lifecycle['refreshAuthority'] !== 'none') {
        return fail('invalid-lifecycle', 'lifecycle.refreshAuthority must be custody or none');
    }
    if (lifecycle['providerExpiry'] !== undefined && !validDate(lifecycle['providerExpiry'])) {
        return fail('invalid-lifecycle', 'lifecycle.providerExpiry must be a valid date');
    }
    if (authority !== 'custodian' && authority !== 'consumer' && authority !== 'native-store') {
        return fail('schema-mismatch', 'authority must be custodian, consumer or native-store');
    }
    const effective = resolveEffectiveAuthority(authority, ctx?.trustedAuthority ?? 'consumer');
    if (AUTHORITY_RANK[authority] > AUTHORITY_RANK[effective]) {
        return fail('authority-escalation', 'bundle claims more authority than the channel grants');
    }
    const credClass = credentialClass;
    if (credClass !== 'renewable' && credClass !== 'static-key' && credClass !== 'access-only' && credClass !== 'store-reference') {
        return fail('schema-mismatch', 'credentialClass must be a known class');
    }
    if (credClass === 'static-key' && identity['refreshFamilyRef'] !== undefined) {
        return fail('schema-mismatch', 'a static key carries no refresh family');
    }
    if (credClass !== 'static-key' && !nonEmpty(identity['refreshFamilyRef'])) {
        return fail('schema-mismatch', 'a non-static seat requires refreshFamilyRef');
    }
    if (effective === 'custodian' && credClass === 'renewable' && lifecycle['refreshAuthority'] !== 'custody') {
        return fail('invalid-lifecycle', 'a custodian renewable bundle holds custody refresh authority');
    }
    if (effective !== 'custodian') {
        if (lifecycle['refreshAuthority'] !== 'none') {
            return fail('authority-escalation', 'only the custodian holds refresh authority');
        }
        if (credClass === 'renewable') {
            return fail('authority-escalation', 'only the custodian carries renewable credentials');
        }
        if (credClass === 'store-reference' && effective !== 'native-store') {
            return fail('authority-escalation', 'store references are accepted on the native-store channel only');
        }
        if (canonical !== undefined) {
            return fail('authority-escalation', 'a non-custodian payload cannot carry canonical material');
        }
    }
    for (const [name, projection] of [['nativeUse', nativeUse], ['meshUse', meshUse]]) {
        if (projection === undefined)
            continue;
        if (!isRecord(projection))
            return fail('schema-mismatch', `${name} must be an object`);
        if (projection['kind'] !== 'access' && projection['kind'] !== 'static-key' && projection['kind'] !== 'unavailable') {
            return fail('schema-mismatch', `${name}.kind must be access, static-key or unavailable`);
        }
        if (projection['accessRef'] !== undefined && typeof projection['accessRef'] !== 'string') {
            return fail('schema-mismatch', `${name}.accessRef must be a string`);
        }
        if (projection['reason'] !== undefined && typeof projection['reason'] !== 'string') {
            return fail('schema-mismatch', `${name}.reason must be a string`);
        }
        const hit = findRefreshKey(projection, 0);
        if (hit) {
            return hit.depth === 0
                ? fail('refresh-material-present', `${name} carries refresh material: ${hit.key}`)
                : fail('nested-refresh-field', `${name} hides a nested renewal field: ${hit.key}`);
        }
        const bad = unknownKey(projection, PROJECTION_KEYS);
        if (bad)
            return fail('unknown-field', `unknown ${name} field: ${bad}`);
    }
    if (canonical !== undefined) {
        if (!isRecord(canonical))
            return fail('schema-mismatch', 'canonical must be an object');
        if (canonical['kind'] !== 'renewable-material' && canonical['kind'] !== 'static-key-material') {
            return fail('schema-mismatch', 'canonical.kind must be a known material kind');
        }
        if (!nonEmpty(canonical['materialRef'])) {
            return fail('schema-mismatch', 'canonical.materialRef must be a non-empty string');
        }
        const bad = unknownKey(canonical, CANONICAL_KEYS);
        if (bad)
            return fail('unknown-field', `unknown canonical field: ${bad}`);
    }
    if (ctx?.predecessor !== undefined) {
        const transition = classifyTransition(ctx.predecessor, {
            epoch: lifecycle['epoch'],
            generation: lifecycle['generation'],
            operationId: lifecycle['operationId'],
        });
        if (transition === 'stale')
            return fail('stale-generation', 'incoming tuple is older than current');
        if (transition === 'conflict')
            return fail('generation-conflict', 'same generation with a different operation');
        if (transition === 'epoch-replacement-required') {
            return fail('epoch-replacement-required', 'a new epoch requires the controlled replacement operation');
        }
        if (transition === 'idempotent')
            return { ok: true, bundle: bundle, idempotentReimport: true };
    }
    return { ok: true, bundle: bundle };
}
/** Five-way lineage classification against the current tuple. */
export function classifyTransition(current, incoming) {
    if (incoming.epoch !== current.epoch) {
        return incoming.epoch < current.epoch ? 'stale' : 'epoch-replacement-required';
    }
    if (incoming.generation !== current.generation) {
        return incoming.generation < current.generation ? 'stale' : 'forward';
    }
    return incoming.operationId === current.operationId ? 'idempotent' : 'conflict';
}
/** True when the incoming tuple is older than current; same epoch/generation reimports idempotently. */
export function isStaleGeneration(current, incoming) {
    return classifyTransition({ ...current, operationId: '' }, { ...incoming, operationId: '' }) === 'stale';
}
/** True for a same-tuple reimport that must not mutate the receiving account. */
export function isIdempotentReimport(current, incoming) {
    return classifyTransition(current, incoming) === 'idempotent';
}
/** The trusted path authority wins; a JSON field claiming an owner is not authorization. */
export function resolveEffectiveAuthority(_claimed, trustedPathAuthority) {
    return trustedPathAuthority;
}
/** Credential-free receipt; carries metadata only, never credential bytes. */
export function createReceipt(bundle, outcome, reason, checkedAt) {
    return {
        seatRef: bundle.identity.seatRef,
        cli: bundle.identity.cli,
        epoch: bundle.lifecycle.epoch,
        generation: bundle.lifecycle.generation,
        operationId: bundle.lifecycle.operationId,
        outcome,
        ...(reason !== undefined ? { reason } : {}),
        checkedAt: checkedAt ?? new Date().toISOString(),
    };
}
