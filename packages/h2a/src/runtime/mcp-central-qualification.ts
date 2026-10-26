/** Release qualification is exact, evidence based and independent of host flags. */
/** Native CLIs with a central admission adapter. H1 mechanism only: the
 * shipped manifest stays empty and H6 populates it from measured evidence.
 * Hosts outside this set (hermes, gemini, opencode, ...) stay on stdio. */
export const SUPPORTED_CENTRAL_HOSTS = Object.freeze(["claude", "codex", "agy", "Muse", "vibe"] as const);
export type SupportedCentralHost = (typeof SUPPORTED_CENTRAL_HOSTS)[number];

export function isSupportedCentralHost(host: unknown): host is SupportedCentralHost {
  return typeof host === "string" && (SUPPORTED_CENTRAL_HOSTS as readonly string[]).includes(host);
}

export type ClaudeQualificationManifest = Readonly<{
  schemaVersion: 1;
  clients: readonly Readonly<{
    /** Admitted host. Absent means "claude" so existing manifests keep working. */
    host?: string;
    name: string;
    version: string;
    platform: string;
    nodeMajors: readonly number[];
    protocolVersions: readonly string[];
    initialization: boolean;
    recovery: boolean;
    dynamicCatalog: Readonly<{ protocol: boolean; usage: boolean }>;
    usability: boolean;
    evidence: string;
  }>[];
}>;

// MH-L8 supplies measured release observations. No Claude version is inferred
// from the launcher environment or admitted on protocol fixtures alone.
export const claudeQualificationManifest: ClaudeQualificationManifest = Object.freeze({
  schemaVersion: 1, clients: Object.freeze([])
});

export function qualifiedHostInitialize(
  host: unknown,
  request: unknown,
  manifest: ClaudeQualificationManifest = claudeQualificationManifest
): boolean {
  if (!isSupportedCentralHost(host)) return false;
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const value = request as { jsonrpc?: unknown; method?: unknown; params?: {
    clientInfo?: { name?: unknown; version?: unknown }; protocolVersion?: unknown
  } };
  if (value.jsonrpc !== '2.0' || value.method !== 'initialize') return false;
  const client = value.params?.clientInfo;
  if (!client || typeof client.name !== 'string' || typeof client.version !== 'string') return false;
  return manifest.schemaVersion === 1 && manifest.clients.some(entry =>
    (entry.host ?? 'claude') === host &&
    entry.name === client.name && entry.version === client.version &&
    entry.platform === process.platform && entry.nodeMajors.includes(Number(process.versions.node.split('.')[0])) &&
    entry.protocolVersions.includes(String(value.params?.protocolVersion)) &&
    entry.initialization === true && entry.recovery === true && entry.usability === true &&
    entry.dynamicCatalog.protocol === true && entry.dynamicCatalog.usage === true && Boolean(entry.evidence)
  );
}

export function qualifiedClaudeInitialize(
  request: unknown,
  manifest: ClaudeQualificationManifest = claudeQualificationManifest
): boolean {
  return qualifiedHostInitialize('claude', request, manifest);
}
