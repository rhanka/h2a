/** Release qualification is exact, evidence based and independent of host flags. */
export type ClaudeQualificationManifest = Readonly<{
  schemaVersion: 1;
  clients: readonly Readonly<{
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

export function qualifiedClaudeInitialize(
  request: unknown,
  manifest: ClaudeQualificationManifest = claudeQualificationManifest
): boolean {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const value = request as { jsonrpc?: unknown; method?: unknown; params?: {
    clientInfo?: { name?: unknown; version?: unknown }; protocolVersion?: unknown
  } };
  if (value.jsonrpc !== '2.0' || value.method !== 'initialize') return false;
  const client = value.params?.clientInfo;
  if (!client || typeof client.name !== 'string' || typeof client.version !== 'string') return false;
  return manifest.schemaVersion === 1 && manifest.clients.some(entry =>
    entry.name === client.name && entry.version === client.version &&
    entry.platform === process.platform && entry.nodeMajors.includes(Number(process.versions.node.split('.')[0])) &&
    entry.protocolVersions.includes(String(value.params?.protocolVersion)) &&
    entry.initialization === true && entry.recovery === true && entry.usability === true &&
    entry.dynamicCatalog.protocol === true && entry.dynamicCatalog.usage === true && Boolean(entry.evidence)
  );
}
