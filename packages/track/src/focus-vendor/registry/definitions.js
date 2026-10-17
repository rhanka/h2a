/**
 * `@sentropic/focus/registry/definitions` — the publisher-owned definition
 * surface for the `sentropic.focus` skill entry (contract §§3–4, R4).
 *
 * This module is SIDE-EFFECT-FREE: importing it reads no file, opens no
 * handle and touches no network. The JSON manifest is read only when
 * {@link loadFocusSkillDescriptor} is called; instruction text is read only
 * through the caller-supplied loader in {@link resolveFocusPresentation},
 * and only AFTER the presentation preflight succeeds — so an unavailable
 * presentation refuses with `unsupported_presentation` with zero instruction
 * loads.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
/** Canonical registry ID of the Focus skill. */
export const FOCUS_SKILL_ID = "sentropic.focus";
/** Public entry version of the first Focus registry release. */
export const FOCUS_ENTRY_VERSION = "1.0.0";
/** Entry-contract version this descriptor conforms to. */
export const FOCUS_CONTRACT_VERSION = "1.1.4";
/** Parameter-schema version of the Focus entry (contract §5.4). */
export const FOCUS_PARAMETERS_SCHEMA_VERSION = "1.0.0";
/** Existing skill-description limit enforced by the contract. */
export const MAX_SKILL_DESCRIPTION_LENGTH = 280;
/** Exact §5.4 defaults, applied once before validation. */
export const FOCUS_PARAMETER_DEFAULTS = {
    mode: "snapshot",
    preferredPresentation: "markdown",
    locale: "en",
};
const definitionIssue = (path, code, message) => ({ path, code, message });
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const HEX64 = /^[0-9a-f]{64}$/;
const stringArray = (value, path, issues) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        issues.push(definitionIssue(path, "invalid_parameters", "expected an array of strings"));
        return undefined;
    }
    return value;
};
/**
 * Closed validation of the publisher-owned Focus entry descriptor.
 * Pure: no I/O, so catalog-time checks perform zero instruction reads.
 */
export const validateFocusEntryDescriptor = (value) => {
    const issues = [];
    if (!isRecord(value)) {
        return { ok: false, issues: [definitionIssue("$", "invalid_entry", "expected an object")] };
    }
    const at = (key) => `$.${key}`;
    let valid = true;
    const fail = (path, code, message) => {
        issues.push(definitionIssue(path, code, message));
        valid = false;
    };
    if (value["format"] !== "sentropic.registry-entry/v1")
        fail(at("format"), "invalid_entry", "expected sentropic.registry-entry/v1");
    if (value["contractVersion"] !== FOCUS_CONTRACT_VERSION)
        fail(at("contractVersion"), "incompatible_version", `expected ${FOCUS_CONTRACT_VERSION}`);
    if (value["kind"] !== "skill")
        fail(at("kind"), "invalid_entry", 'expected "skill"');
    if (value["id"] !== FOCUS_SKILL_ID)
        fail(at("id"), "invalid_entry", `expected "${FOCUS_SKILL_ID}"`);
    if (typeof value["name"] !== "string" || value["name"].length === 0)
        fail(at("name"), "invalid_entry", "expected a nonempty name");
    if (typeof value["description"] !== "string" || value["description"].length === 0) {
        fail(at("description"), "invalid_entry", "expected a nonempty description");
    }
    else if (value["description"].length > MAX_SKILL_DESCRIPTION_LENGTH) {
        fail(at("description"), "invalid_entry", `description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters`);
    }
    if (typeof value["entryVersion"] !== "string" || !SEMVER.test(value["entryVersion"])) {
        fail(at("entryVersion"), "invalid_entry", "expected an exact SemVer entry version");
    }
    if (value["entryVersion"] !== FOCUS_ENTRY_VERSION)
        fail(at("entryVersion"), "incompatible_version", `expected ${FOCUS_ENTRY_VERSION}`);
    const publisher = value["publisher"];
    if (!isRecord(publisher) ||
        publisher["packageName"] !== "@sentropic/focus" ||
        typeof publisher["packageVersion"] !== "string" ||
        !SEMVER.test(publisher["packageVersion"])) {
        fail(at("publisher"), "invalid_entry", "expected the @sentropic/focus package identity with an exact version");
    }
    const compatibility = value["compatibility"];
    if (!isRecord(compatibility) || compatibility["entryContract"] !== FOCUS_CONTRACT_VERSION) {
        fail(at("compatibility"), "incompatible_version", "expected the pinned entry-contract version");
    }
    else {
        const packages = compatibility["packages"];
        if (!Array.isArray(packages) ||
            packages.some((row) => !isRecord(row) || typeof row["name"] !== "string" || typeof row["range"] !== "string")) {
            fail("$.compatibility.packages", "invalid_entry", "expected package peer rows");
        }
        const profiles = stringArray(compatibility["schemaProfiles"], "$.compatibility.schemaProfiles", issues);
        if (profiles === undefined)
            valid = false;
        else if (!profiles.includes("sentropic.parameters/2020-12-bounded-v1")) {
            fail("$.compatibility.schemaProfiles", "unsupported_schema_profile", "expected the bounded parameters profile");
        }
        if (stringArray(compatibility["requiredHostFeatures"], "$.compatibility.requiredHostFeatures", issues) === undefined)
            valid = false;
        if (stringArray(compatibility["optionalHostFeatures"], "$.compatibility.optionalHostFeatures", issues) === undefined)
            valid = false;
    }
    const parameters = value["parameters"];
    if (!isRecord(parameters) || parameters["schemaVersion"] !== FOCUS_PARAMETERS_SCHEMA_VERSION) {
        fail(at("parameters"), "unsupported_schema_profile", `expected parameter schema version ${FOCUS_PARAMETERS_SCHEMA_VERSION}`);
    }
    else {
        const schema = parameters["schema"];
        if (!isRecord(schema)) {
            fail("$.parameters.schema", "unsupported_schema_profile", "expected a schema object");
        }
        else {
            const properties = schema["properties"];
            if (schema["type"] !== "object" ||
                schema["additionalProperties"] !== false ||
                !isRecord(properties) ||
                !isRecord(properties["mode"]) ||
                properties["mode"]["const"] !== "snapshot" ||
                !isRecord(properties["preferredPresentation"]) ||
                !Array.isArray(properties["preferredPresentation"]["enum"]) ||
                !isRecord(properties["locale"]) ||
                !Array.isArray(properties["locale"]["enum"])) {
                fail("$.parameters.schema", "unsupported_schema_profile", "expected the exact §5.4 focus parameter shape");
            }
        }
        const defaults = parameters["defaults"];
        if (!isRecord(defaults) ||
            defaults["mode"] !== FOCUS_PARAMETER_DEFAULTS.mode ||
            defaults["preferredPresentation"] !== FOCUS_PARAMETER_DEFAULTS.preferredPresentation ||
            defaults["locale"] !== FOCUS_PARAMETER_DEFAULTS.locale) {
            fail("$.parameters.defaults", "invalid_parameters", "expected the exact §5.4 defaults");
        }
    }
    if (!Array.isArray(value["bindings"]))
        fail(at("bindings"), "invalid_entry", "expected a bindings array");
    const assets = value["assets"];
    if (!Array.isArray(assets) || assets.length === 0) {
        fail(at("assets"), "invalid_entry", "expected a nonempty asset list");
    }
    else {
        assets.forEach((asset, index) => {
            const path = `$.assets[${index}]`;
            if (!isRecord(asset) ||
                typeof asset["role"] !== "string" ||
                typeof asset["path"] !== "string" ||
                typeof asset["mediaType"] !== "string" ||
                typeof asset["sha256"] !== "string" ||
                !HEX64.test(asset["sha256"])) {
                fail(path, "invalid_entry", "expected { role, path, mediaType, sha256 } with a full SHA-256 hex digest");
            }
        });
    }
    const skill = value["skill"];
    if (!isRecord(skill) || value["mcp"] !== undefined) {
        fail(at("skill"), "invalid_entry", "expected exactly the skill payload (no mcp arm)");
    }
    else {
        if (skill["profile"] !== "instructions")
            fail("$.skill.profile", "invalid_entry", 'expected the instruction-only profile');
        const metadata = skill["metadata"];
        if (!isRecord(metadata) ||
            typeof metadata["category"] !== "string" ||
            !Array.isArray(metadata["toolNames"]) ||
            metadata["toolNames"].length !== 0) {
            fail("$.skill.metadata", "invalid_entry", "expected category metadata with empty toolNames");
        }
        if (typeof skill["instructionsAsset"] !== "string")
            fail("$.skill.instructionsAsset", "invalid_entry", "expected one SKILL.md asset path");
        const capabilities = skill["capabilities"];
        if (!Array.isArray(capabilities) ||
            !capabilities.some((capability) => isRecord(capability) &&
                capability["id"] === "sentropic.focus.decision-dossier" &&
                capability["effect"] === "read-only")) {
            fail("$.skill.capabilities", "invalid_entry", "expected the read-only sentropic.focus.decision-dossier capability");
        }
        if (!Array.isArray(skill["tools"]) || skill["tools"].length !== 0) {
            fail("$.skill.tools", "invalid_entry", "instruction-only entries carry no tools");
        }
        const schemas = skill["documentSchemas"];
        if (!Array.isArray(schemas) ||
            !schemas.some((schema) => isRecord(schema) &&
                schema["name"] === "DecisionDossierDocument" &&
                schema["schemaId"] === "urn:sentropic:focus:DecisionDossierDocument:1.0.0" &&
                typeof schema["assetPath"] === "string" &&
                typeof schema["sha256"] === "string" &&
                HEX64.test(schema["sha256"]))) {
            fail("$.skill.documentSchemas", "invalid_entry", "expected the digest-bound DecisionDossierDocument schema reference");
        }
        if (!Array.isArray(skill["dependencies"]))
            fail("$.skill.dependencies", "invalid_entry", "expected a dependencies array");
    }
    if (!valid)
        return { ok: false, issues };
    return { ok: true, value: value };
};
/**
 * Validate Focus configuration values against the exact §5.4 profile.
 * Declared defaults apply once before validation; unknown keys refuse.
 */
export const validateFocusParameters = (value) => {
    const issues = [];
    const merged = value === undefined ? {} : isRecord(value) ? { ...value } : {};
    if (value !== undefined && !isRecord(value)) {
        return { ok: false, issues: [definitionIssue("$", "invalid_parameters", "expected an object")] };
    }
    for (const [key, fallback] of Object.entries(FOCUS_PARAMETER_DEFAULTS)) {
        if (merged[key] === undefined)
            merged[key] = fallback;
    }
    for (const key of Object.keys(merged)) {
        if (!(key in FOCUS_PARAMETER_DEFAULTS)) {
            issues.push(definitionIssue(`$.${key}`, "invalid_parameters", "unknown parameter"));
        }
    }
    if (merged["mode"] !== "snapshot") {
        issues.push(definitionIssue("$.mode", "invalid_parameters", 'mode is fixed to "snapshot"'));
    }
    const presentations = ["terminal", "markdown", "html", "mcp-app"];
    if (typeof merged["preferredPresentation"] !== "string" || !presentations.includes(merged["preferredPresentation"])) {
        issues.push(definitionIssue("$.preferredPresentation", "invalid_parameters", `expected one of: ${presentations.join(" | ")}`));
    }
    if (merged["locale"] !== "en" && merged["locale"] !== "fr") {
        issues.push(definitionIssue("$.locale", "invalid_parameters", 'expected "en" or "fr"'));
    }
    if (issues.length > 0)
        return { ok: false, issues };
    return {
        ok: true,
        value: {
            mode: "snapshot",
            preferredPresentation: merged["preferredPresentation"],
            locale: merged["locale"],
        },
    };
};
/**
 * Presentation preflight for the selected Focus configuration.
 * `loadInstructions` runs ONLY when the requested presentation is usable, so
 * an unavailable `mcp-app` (or an unsanitized `html`) refuses with
 * `unsupported_presentation` with zero instruction reads/loads.
 */
export const resolveFocusPresentation = (params, gate, loadInstructions) => {
    switch (params.preferredPresentation) {
        case "terminal":
        case "markdown":
            return { ok: true, instructions: loadInstructions() };
        case "html":
            if (!gate.htmlSanitizerAvailable) {
                return {
                    ok: false,
                    code: "unsupported_presentation",
                    message: "html presentation requires the host sanitization hook",
                };
            }
            return { ok: true, instructions: loadInstructions() };
        case "mcp-app":
            if (!gate.uiSelectedAndQualified) {
                return {
                    ok: false,
                    code: "unsupported_presentation",
                    message: "mcp-app presentation requires the separately selected and qualified UI entry",
                };
            }
            return { ok: true, instructions: loadInstructions() };
    }
};
const packageRequire = createRequire(import.meta.url);
/**
 * Read the package-owned registry manifest (`registry/entries.v1.json`).
 * Called explicitly by the host; importing this module alone reads nothing.
 */
export const loadFocusSkillDescriptor = () => packageRequire("../../registry/entries.v1.json");
/** Recompute every asset/schema digest over the supplied bytes. */
export const verifyAssetDigests = (entry, readFile) => {
    const issues = [];
    const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");
    for (const asset of entry.assets) {
        const bytes = readFile(asset.path);
        if (bytes === null) {
            issues.push(definitionIssue(`asset:${asset.path}`, "invalid_entry", "asset missing from the package"));
        }
        else if (digestOf(bytes) !== asset.sha256) {
            issues.push(definitionIssue(`asset:${asset.path}`, "integrity_mismatch", "asset bytes do not match the entry digest"));
        }
    }
    for (const schema of entry.skill.documentSchemas) {
        const bytes = readFile(schema.assetPath);
        if (bytes === null) {
            issues.push(definitionIssue(`asset:${schema.assetPath}`, "invalid_entry", "schema asset missing from the package"));
        }
        else if (digestOf(bytes) !== schema.sha256) {
            issues.push(definitionIssue(`asset:${schema.assetPath}`, "integrity_mismatch", "schema bytes do not match the entry digest"));
        }
    }
    return issues;
};
/** Refuse absolute paths, traversal, escapes and duplicates. */
export const assertSafeAssetPaths = (entry) => {
    const issues = [];
    const seen = new Set();
    for (const asset of entry.assets) {
        const path = asset.path;
        const segments = path.split("/");
        if (path.length === 0 ||
            path.startsWith("/") ||
            path.includes("\\") ||
            segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
            issues.push(definitionIssue(`asset:${path}`, "path_escape", "asset path must be a clean package-relative POSIX path"));
        }
        if (seen.has(path)) {
            issues.push(definitionIssue(`asset:${path}`, "duplicate_entry", "asset path listed twice"));
        }
        seen.add(path);
    }
    return issues;
};
