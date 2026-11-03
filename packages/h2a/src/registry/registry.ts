/**
 * R5 h2a-side MCP registry: register/select/configure/compile over the
 * package-owned `sentropic.h2a` / `sentropic.track` descriptors.
 *
 * This is the h2a composition of the contract lifecycle (§6), not the later
 * Sentropic R2/R7a/R3 delivery (public remote-bound arm, mesh remote
 * adapter/host bridge, executable installer, SKILLS facade). Anything that
 * needs those lots refuses with a typed diagnostic here:
 * `unsupported_definition_kind` for remote-bound-shaped registration input
 * (contract §3.1 day-one boundary) and `missing_binding` where a qualified
 * remote/binding port would be required. Registration never activates
 * listeners or resources; a failed candidate never disturbs the active
 * generation.
 *
 * Dependency-light: static imports are `node:`-free pure helpers plus the
 * descriptor validators, so `./registry/definitions` keeps a light graph.
 */
import {
  canonicalJson,
  normalizeConfiguration,
  sha256Hex,
  validateRegistryEntry,
  type RegistryDiagnosticCode,
  type RegistryEntry
} from "./descriptors.js";
export { RegistryError } from "./descriptors.js";
export type { RegistryDiagnosticCode, RegistryEntry };

export interface RegistryManifest {
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  resources: unknown[];
  prompts: unknown[];
}

export interface LoadedLocalDefinition {
  descriptor: unknown;
  manifest: unknown;
  handlers: Map<string, (args: unknown) => unknown>;
}

export interface LazyLocalDefinition {
  descriptor: unknown;
  manifest: unknown;
  schemas?: Record<string, unknown>;
  load: () => Promise<unknown>;
}

interface StoredDefinition {
  entry: RegistryEntry;
  digest: string;
  manifest: RegistryManifest;
  handlers: Map<string, (args: unknown) => unknown>;
  lazyLoad: (() => Promise<unknown>) | null;
}

export interface RegistryDiagnostic {
  code: RegistryDiagnosticCode;
  message: string;
}

export interface CompiledPlan {
  generation: number;
  selection: string[];
  entryDigests: Record<string, string>;
  configDigests: Record<string, string>;
  effectiveProfiles: Record<string, string>;
  orderedCapabilities: string[];
  ownership: Record<string, string>;
  bindingContracts: Record<string, string>;
  materializedManifestDigest: string;
}

export interface CompileOptions {
  bindings: Record<string, { contract: string }>;
  compatibility: {
    hostFeatures: string[];
    protocolVersions?: string[];
    requestedTransports?: string[];
  };
}

function diag(code: RegistryDiagnosticCode, message: string): RegistryDiagnostic {
  return { code, message: `${code}: ${message}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertManifestShape(manifest: unknown, id: string): asserts manifest is RegistryManifest {
  if (!isRecord(manifest)) throw Object.assign(new Error(`invalid_entry: manifest for ${id} must be an object`), { code: "invalid_entry" });
  for (const key of ["tools", "resources", "prompts"] as const) {
    if (!Array.isArray(manifest[key])) {
      throw Object.assign(new Error(`invalid_entry: manifest for ${id} must explicitly declare ${key}`), { code: "invalid_entry" });
    }
  }
  const names = new Set<string>();
  for (const tool of manifest.tools as Array<{ name?: unknown }>) {
    if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.length === 0) {
      throw Object.assign(new Error(`invalid_entry: manifest for ${id} has a nameless tool`), { code: "invalid_entry" });
    }
    if (names.has(tool.name)) throw Object.assign(new Error(`duplicate_entry: duplicate manifest tool ${tool.name} in ${id}`), { code: "duplicate_entry" });
    names.add(tool.name);
  }
}

function throwCode(code: RegistryDiagnosticCode, message: string): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
}

/** Day-one boundary (contract §3.1): remote-bound definitions are not declarable here. */
function refuseRemoteShaped(def: unknown): void {
  if (!isRecord(def)) return;
  if (def["kind"] === "remote-bound") throwCode("unsupported_definition_kind", "remote-bound definitions are not declarable in this release (later R2 arm)");
  const adapter = def["adapter"];
  if (isRecord(adapter) && adapter["kind"] === "remote-bound") {
    throwCode("unsupported_definition_kind", "remote-bound adapter records are not registrable (later R2 arm)");
  }
  const descriptor = def["descriptor"];
  if (isRecord(descriptor) && descriptor["transport"] === "remote-bound") {
    throwCode("unsupported_definition_kind", "remote-bound descriptor markers are not registrable (later R2 arm)");
  }
  if (isRecord(descriptor) && typeof descriptor["kind"] === "string" && descriptor["kind"] !== "mcp" && descriptor["kind"] !== "skill") {
    throwCode("unsupported_definition_kind", `unknown definition kind ${JSON.stringify(descriptor["kind"])}`);
  }
}

function effectiveProfileId(entry: RegistryEntry, normalized: Record<string, unknown>): string {
  if (entry.id === "sentropic.h2a") return normalized["mode"] as string;
  const profiles = entry.mcp?.capabilityProfiles;
  if (profiles !== undefined && profiles.length > 0) return profiles[0].id;
  return "default";
}

function profileTools(entry: RegistryEntry, manifest: RegistryManifest, profileId: string): string[] {
  const profiles = entry.mcp?.capabilityProfiles;
  if (profiles !== undefined) {
    const found = profiles.find((profile) => profile.id === profileId);
    if (!found) throwCode("invalid_parameters", `unknown capability profile ${profileId} for ${entry.id}`);
    const manifestNames = new Set(manifest.tools.map((tool) => tool.name));
    for (const name of found.tools) {
      if (!manifestNames.has(name)) throwCode("invalid_entry", `capability profile ${profileId} refers to unknown base capability ${name}`);
    }
    return [...found.tools];
  }
  return manifest.tools.map((tool) => tool.name);
}

export function createRegistry(): {
  register: (def: unknown) => void;
  catalog: () => Array<{ kind: string; id: string; entryVersion: string; digest: string; description: string }>;
  selection: () => string[];
  select: (ids: string[]) => void;
  configure: (id: string, values: unknown) => void;
  compile: (options: CompileOptions) => Promise<{ ok: true; plan: CompiledPlan } | { ok: false; diagnostics: RegistryDiagnostic[] }>;
  activate: (plan: CompiledPlan) => number;
  activeGeneration: () => number | null;
  dispatch: (generation: number, name: string, args: unknown) => unknown;
} {
  const definitions = new Map<string, StoredDefinition>();
  let selection: string[] = [];
  const configurations = new Map<string, Record<string, unknown>>();
  let generationCounter = 0;
  let active: CompiledPlan | null = null;
  const issuedPlans = new Map<number, CompiledPlan>();

  function keyOf(entry: RegistryEntry): string {
    return `${entry.kind}/${entry.id}`;
  }

  function register(def: unknown): void {
    refuseRemoteShaped(def);
    if (!isRecord(def)) throwCode("invalid_entry", "definition must be an object");
    const { entry, digest } = (() => {
      try {
        return validateRegistryEntry(def["descriptor"]);
      } catch (error) {
        const code = (error as { code?: string }).code ?? "invalid_entry";
        throwCode(code as RegistryDiagnosticCode, (error as Error).message);
      }
    })();
    const key = keyOf(entry);
    if (definitions.has(key)) throwCode("duplicate_entry", `duplicate provider ${key}`);
    assertManifestShape(def["manifest"], entry.id);
    const manifest = def["manifest"] as RegistryManifest;
    let handlers: Map<string, (args: unknown) => unknown>;
    let lazyLoad: (() => Promise<unknown>) | null = null;
    if (def["handlers"] instanceof Map) {
      handlers = def["handlers"] as Map<string, (args: unknown) => unknown>;
    } else if (typeof def["load"] === "function") {
      // Lazy shell: the loader is trusted host code and is NOT invoked here.
      handlers = new Map();
      lazyLoad = def["load"] as () => Promise<unknown>;
    } else {
      throwCode("invalid_entry", `definition for ${entry.id} supplies neither handlers nor a loader thunk`);
    }
    definitions.set(key, { entry, digest, manifest, handlers, lazyLoad });
  }

  function catalog(): Array<{ kind: string; id: string; entryVersion: string; digest: string; description: string }> {
    return [...definitions.values()].map((stored) => ({
      kind: stored.entry.kind,
      id: stored.entry.id,
      entryVersion: stored.entry.entryVersion,
      digest: stored.digest,
      description: stored.entry.description
    }));
  }

  function select(ids: string[]): void {
    if (!Array.isArray(ids)) throwCode("invalid_entry", "select needs an explicit id array");
    const seen = new Set<string>();
    for (const id of ids) {
      if (typeof id !== "string") throwCode("invalid_entry", "select ids must be strings");
      if (seen.has(id)) throwCode("duplicate_entry", `duplicate selected id ${id}`);
      seen.add(id);
      const known = [...definitions.values()].some((stored) => stored.entry.id === id);
      if (!known) throwCode("invalid_entry", `unknown provider ${id}`);
    }
    selection = [...ids];
  }

  function findSelected(id: string): StoredDefinition {
    if (!selection.includes(id)) throwCode("invalid_entry", `provider ${id} is not selected`);
    const stored = [...definitions.values()].find((candidate) => candidate.entry.id === id);
    if (!stored) throwCode("invalid_entry", `unknown provider ${id}`);
    return stored as StoredDefinition;
  }

  function configure(id: string, values: unknown): void {
    const stored = findSelected(id);
    let normalized: Record<string, unknown>;
    try {
      normalized = normalizeConfiguration(stored.entry, values);
    } catch (error) {
      throwCode((error as { code?: RegistryDiagnosticCode }).code ?? "invalid_parameters", (error as Error).message);
    }
    configurations.set(id, normalized as Record<string, unknown>);
  }

  async function compile(options: CompileOptions): Promise<{ ok: true; plan: CompiledPlan } | { ok: false; diagnostics: RegistryDiagnostic[] }> {
    const diagnostics: RegistryDiagnostic[] = [];
    if (!isRecord(options) || !isRecord(options.bindings) || !isRecord(options.compatibility)) {
      return { ok: false, diagnostics: [diag("invalid_entry", "compile needs {bindings,compatibility}")] };
    }
    const bindings = options.bindings as Record<string, { contract: string }>;
    const compatibility = options.compatibility as CompileOptions["compatibility"];
    const hostFeatures = Array.isArray(compatibility.hostFeatures) ? compatibility.hostFeatures : [];
    const protocolVersions = Array.isArray(compatibility.protocolVersions) ? compatibility.protocolVersions : [];

    for (const id of selection) {
      const stored = [...definitions.values()].find((candidate) => candidate.entry.id === id);
      if (!stored) return { ok: false, diagnostics: [diag("invalid_entry", `unknown provider ${id}`)] };
      if (!configurations.has(id)) {
        return { ok: false, diagnostics: [diag("invalid_parameters", `provider ${id} is selected but has no configuration`)] };
      }
    }

    // Duplicate public names fail compilation even outside the selected
    // profiles: no suffixing, no first-wins, no silent shadowing.
    {
      const declaredBy: Record<string, string> = {};
      for (const id of selection) {
        const stored = [...definitions.values()].find((candidate) => candidate.entry.id === id) as StoredDefinition;
        for (const tool of stored.manifest.tools) {
          if (declaredBy[tool.name] !== undefined) {
            return { ok: false, diagnostics: [diag("name_collision", `tool ${tool.name} is declared by ${declaredBy[tool.name]} and ${id}: refusing without rename`)] };
          }
          declaredBy[tool.name] = id;
        }
      }
    }

    const orderedCapabilities: string[] = [];
    const ownership: Record<string, string> = {};
    const entryDigests: Record<string, string> = {};
    const configDigests: Record<string, string> = {};
    const effectiveProfiles: Record<string, string> = {};
    const bindingContracts: Record<string, string> = {};
    // Scratch loader state: staged handler maps commit to the stored
    // definitions only when the whole candidate below validates.
    const stagedHandlers = new Map<StoredDefinition, Map<string, (args: unknown) => unknown>>();

    for (const id of selection) {
      const stored = [...definitions.values()].find((candidate) => candidate.entry.id === id) as StoredDefinition;
      const normalized = configurations.get(id) as Record<string, unknown>;
      entryDigests[id] = stored.digest;
      configDigests[id] = sha256Hex(canonicalJson(normalized));

      for (const required of stored.entry.compatibility.requiredHostFeatures) {
        if (!hostFeatures.includes(required)) {
          return { ok: false, diagnostics: [diag("unsupported_host", `provider ${id} requires host feature ${required}`)] };
        }
      }

      // Resolve binding references against declared binding keys.
      const resolvedContracts: Record<string, string> = {};
      for (const [field, value] of Object.entries(normalized)) {
        if (!field.endsWith("Ref") || typeof value !== "string") continue;
        const declared = stored.entry.bindings.find((binding) => binding.key === value);
        if (!declared) {
          return { ok: false, diagnostics: [diag("missing_binding", `provider ${id} references unknown binding ${JSON.stringify(value)}`)] };
        }
        const supplied = bindings[value];
        if (!supplied || supplied.contract !== declared.contract) {
          return { ok: false, diagnostics: [diag("missing_binding", `provider ${id} binding ${value} has no compatible supplied port`)] };
        }
        resolvedContracts[value] = declared.contract;
        bindingContracts[`${id}:${field}`] = declared.contract;
      }
      for (const binding of stored.entry.bindings) {
        if (!binding.required) continue;
        const supplied = bindings[binding.key];
        const referenced = Object.values(normalized).includes(binding.key);
        if ((!supplied || supplied.contract !== binding.contract) && !referenced) {
          // Required ports may be satisfied either by direct supply or by reference.
          return { ok: false, diagnostics: [diag("missing_binding", `provider ${id} is missing required binding ${binding.key}`)] };
        }
        if (supplied && supplied.contract !== binding.contract) {
          return { ok: false, diagnostics: [diag("missing_binding", `provider ${id} binding ${binding.key} contract mismatch`)] };
        }
      }

      // Mode/profile transport cross-check for the known h2a publishers.
      const profileId = effectiveProfileId(stored.entry, normalized);
      effectiveProfiles[id] = profileId;
      if (stored.entry.id === "sentropic.h2a") {
        const mode = normalized["mode"] as string;
        const ref = normalized["serviceBindingRef"] as string;
        const declared = stored.entry.bindings.find((binding) => binding.key === ref);
        const need = mode === "shared-central" ? "h2a.central-attachment/v2" : "h2a.hosted-service/v1";
        if (!declared || declared.contract !== need) {
          return { ok: false, diagnostics: [diag("missing_binding", `sentropic.h2a mode ${mode} has no compatible binding for ${JSON.stringify(ref)}`)] };
        }
      }
      if (stored.entry.id === "sentropic.track") {
        const ref = normalized["repositoryBindingRef"] as string;
        const declared = stored.entry.bindings.find((binding) => binding.key === ref);
        if (!declared || declared.contract !== "h2a.workspace/v1") {
          return { ok: false, diagnostics: [diag("missing_binding", `sentropic.track has no workspace binding for ${JSON.stringify(ref)}`)] };
        }
      }

      for (const profile of stored.entry.mcp?.transportProfiles ?? []) {
        for (const required of profile.requiredHostFeatures) {
          if (!hostFeatures.includes(required) && effectiveProfiles[id] !== undefined && profileBelongsToEffective(stored.entry, normalized, profile.id)) {
            return { ok: false, diagnostics: [diag("unsupported_host", `provider ${id} transport ${profile.id} requires host feature ${required}`)] };
          }
        }
        if (protocolVersions.length > 0 && profileBelongsToEffective(stored.entry, normalized, profile.id)) {
          const overlap = profile.protocolVersions.filter((version) => protocolVersions.includes(version));
          if (overlap.length === 0) {
            return { ok: false, diagnostics: [diag("incompatible_version", `provider ${id} transport ${profile.id} has no shared protocol version`)] };
          }
        }
      }

      let tools: string[];
      try {
        tools = profileTools(stored.entry, stored.manifest, profileId);
      } catch (error) {
        return { ok: false, diagnostics: [diag((error as { code?: RegistryDiagnosticCode }).code ?? "invalid_entry", (error as Error).message)] };
      }
      // Selected-only load: thunks run after metadata/peer/policy preflight,
      // never for unselected entries. Loaded handlers stage in scratch state
      // and commit only when the whole candidate validates: a failed
      // candidate never disturbs the stored (possibly active) handlers.
      if (stored.lazyLoad) {
        let payload: unknown;
        try {
          payload = await stored.lazyLoad();
        } catch (error) {
          return { ok: false, diagnostics: [diag("invalid_entry", `provider ${id} loader failed: ${(error as Error).message}`)] };
        }
        if (!isRecord(payload) || !(payload["handlers"] instanceof Map)) {
          return { ok: false, diagnostics: [diag("invalid_entry", `provider ${id} loader returned no handler map`)] };
        }
        const loadedManifest = payload["manifest"];
        if (isRecord(loadedManifest) && Array.isArray(loadedManifest["tools"])) {
          const registeredNames = new Set(stored.manifest.tools.map((tool) => tool.name));
          const loadedNames = new Set((loadedManifest["tools"] as Array<{ name?: unknown }>).map((tool) => (tool as { name: string }).name));
          if (registeredNames.size !== loadedNames.size || [...registeredNames].some((name) => !loadedNames.has(name))) {
            return { ok: false, diagnostics: [diag("invalid_entry", `provider ${id} loader manifest drifts from the registered shell`)] };
          }
        }
        stagedHandlers.set(stored, payload["handlers"] as Map<string, (args: unknown) => unknown>);
      }
      const effectiveHandlers = stagedHandlers.get(stored) ?? stored.handlers;
      for (const name of tools) {
        if (!effectiveHandlers.has(name)) {
          return { ok: false, diagnostics: [diag("invalid_entry", `provider ${id} supplies no handler for selected tool ${name}`)] };
        }
      }
      for (const name of tools) {
        if (ownership[name] !== undefined) {
          return { ok: false, diagnostics: [diag("name_collision", `tool ${name} is declared by ${ownership[name]} and ${id}: refusing without rename`)] };
        }
        ownership[name] = id;
        orderedCapabilities.push(name);
      }
      void resolvedContracts;
    }

    if (Array.isArray(compatibility.requestedTransports)) {
      const declaredIds = new Set<string>();
      for (const id of selection) {
        const stored = [...definitions.values()].find((candidate) => candidate.entry.id === id) as StoredDefinition;
        for (const profile of stored.entry.mcp?.transportProfiles ?? []) declaredIds.add(profile.id);
      }
      for (const requested of compatibility.requestedTransports) {
        if (!declaredIds.has(requested)) {
          diagnostics.push(diag("missing_binding", `requested transport ${requested} is not a declared publisher transport (later R2 remote arm)`));
          return { ok: false, diagnostics };
        }
      }
    }

    // The candidate validated: commit staged loader handlers to the stored
    // definitions. Every failure above returns before this point, so a
    // refused candidate leaves stored (possibly active) handlers untouched.
    for (const [stored, handlers] of stagedHandlers) stored.handlers = handlers;

    const materializedManifestDigest = sha256Hex(canonicalJson({
      selection: [...selection],
      profiles: { ...effectiveProfiles },
      tools: [...orderedCapabilities],
      ownership: { ...ownership },
      entries: { ...entryDigests },
      configs: { ...configDigests }
    }));
    generationCounter += 1;
    const plan: CompiledPlan = {
      generation: generationCounter,
      selection: [...selection],
      entryDigests,
      configDigests,
      effectiveProfiles,
      orderedCapabilities,
      ownership,
      bindingContracts,
      materializedManifestDigest
    };
    // The issued snapshot is a copy, never an alias of the returned plan:
    // caller mutation is detected by activate (integrity_mismatch) instead
    // of silently rewriting the recorded candidate.
    issuedPlans.set(plan.generation, structuredClone(plan));
    return { ok: true, plan };
  }

  function activate(plan: CompiledPlan): number {
    if (!isRecord(plan) || typeof plan.generation !== "number" || !issuedPlans.has(plan.generation)) {
      throwCode("invalid_entry", "activate needs a plan issued by compile");
    }
    const issued = issuedPlans.get(plan.generation) as CompiledPlan;
    if (sha256Hex(canonicalJson(issued)) !== sha256Hex(canonicalJson(plan))) {
      throwCode("integrity_mismatch", "plan bytes differ from the issued candidate");
    }
    active = issued;
    return issued.generation;
  }

  function activeGeneration(): number | null {
    return active ? active.generation : null;
  }

  function dispatch(generation: number, name: string, args: unknown): unknown {
    if (!active || generation !== active.generation) throwCode("stale_generation", "call targets a superseded generation");
    const owner = active.ownership[name];
    if (owner === undefined) throwCode("invalid_entry", `unknown tool ${name} for the active selection`);
    const stored = [...definitions.values()].find((candidate) => candidate.entry.id === owner) as StoredDefinition;
    const handler = stored.handlers.get(name);
    if (!handler) throwCode("invalid_entry", `no handler for selected tool ${name}`);
    return handler(args);
  }

  return { register, catalog, selection: () => [...selection], select, configure, compile, activate, activeGeneration, dispatch };
}

function profileBelongsToEffective(entry: RegistryEntry, normalized: Record<string, unknown>, transportId: string): boolean {
  if (entry.id === "sentropic.h2a") {
    const mode = normalized["mode"] as string;
    if (mode === "shared-central") return transportId === "shared-central-stdio";
    return transportId === "hosted-read-only-http";
  }
  // Track: the binding stdio transport serves the read-only profile; the
  // hosted HTTP transport serves it on the hosted composition.
  void normalized;
  return true;
}

export function configDigestForTest(values: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(values));
}
