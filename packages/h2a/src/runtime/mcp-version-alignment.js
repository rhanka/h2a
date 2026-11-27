/**
 * Compare the host plugin version (`plugin.json`) and explicit central protocol
 * markers against the installed bridge/central contract.
 *
 * SemVer differences across plugin versions (including `0.x` minor transitions,
 * major changes, patches, or RC tags) emit a non-blocking warning because the
 * bridge executes from the installed CLI rather than plugin code. Refusal
 * (`incompatible_version`) occurs ONLY when an explicit protocol marker
 * (central protocol version, marker schema version, handover protocol, or MCP
 * protocol version overlap) indicates an incompatible wire contract.
 */

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const EXPECTED_CENTRAL_PROTOCOL = 2;
const EXPECTED_CENTRAL_SCHEMA_VERSION = 2;
const EXPECTED_HANDOVER_PROTOCOL = 1;

export function parseSemverVersion(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = SEMVER_RE.exec(trimmed);
  if (!match) return null;
  return {
    raw: trimmed,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  };
}

function checkExplicitProtocolMarkers(pluginVersion, centralVersion, options) {
  const marker = options?.centralMarker;
  const centralProtocol = options?.centralProtocol ?? marker?.protocol;
  const expectedProtocol = options?.expectedProtocol ?? EXPECTED_CENTRAL_PROTOCOL;
  if (typeof centralProtocol === 'number' && centralProtocol !== expectedProtocol) {
    return (
      `incompatible_version: step=plugin-central-version-check: central protocol ${centralProtocol} ` +
      `is incompatible with bridge protocol ${expectedProtocol} (plugin ${pluginVersion || 'unknown'}, central ${centralVersion || 'unknown'}); ` +
      `restart the central daemon ("h2a central stop")`
    );
  }
  const centralSchema = options?.centralSchemaVersion ?? marker?.schemaVersion;
  const expectedSchema = options?.expectedSchemaVersion ?? EXPECTED_CENTRAL_SCHEMA_VERSION;
  if (typeof centralSchema === 'number' && centralSchema !== expectedSchema) {
    return (
      `incompatible_version: step=plugin-central-version-check: central marker schemaVersion ${centralSchema} ` +
      `is incompatible with expected schemaVersion ${expectedSchema} (plugin ${pluginVersion || 'unknown'}, central ${centralVersion || 'unknown'}); ` +
      `restart the central daemon ("h2a central stop")`
    );
  }
  const handoverProtocol = options?.centralHandoverProtocol ?? marker?.handoverProtocol;
  const expectedHandover = options?.expectedHandoverProtocol ?? EXPECTED_HANDOVER_PROTOCOL;
  if (typeof handoverProtocol === 'number' && handoverProtocol !== expectedHandover) {
    return (
      `incompatible_version: step=plugin-central-version-check: central handoverProtocol ${handoverProtocol} ` +
      `is incompatible with expected handoverProtocol ${expectedHandover}; restart the central daemon ("h2a central stop")`
    );
  }
  const centralMcpProtocols = Array.isArray(options?.centralProtocolVersions ?? marker?.mcpProtocolVersions)
    ? (options?.centralProtocolVersions ?? marker?.mcpProtocolVersions)
    : null;
  const supportedProtocols = Array.isArray(options?.supportedProtocols) ? options.supportedProtocols : null;
  if (
    centralMcpProtocols &&
    centralMcpProtocols.length > 0 &&
    supportedProtocols &&
    supportedProtocols.length > 0 &&
    !centralMcpProtocols.some((p) => supportedProtocols.includes(p))
  ) {
    return (
      `incompatible_version: step=plugin-central-version-check: central MCP protocols [${centralMcpProtocols.join(', ')}] ` +
      `share no compatible version with bridge protocols [${supportedProtocols.join(', ')}]; restart the central daemon ("h2a central stop")`
    );
  }
  return null;
}

/**
 * Evaluate compatibility between plugin manifest version, central version,
 * and optional explicit central protocol markers:
 * - explicit protocol marker mismatch -> `"refuse"` (`incompatible_version`)
 * - identical plugin/central versions -> `"aligned"`
 * - any SemVer difference (major, `0.x` minor, patch, RC) -> `"warn"` (`version_skew`)
 */
export function comparePluginAndCentralVersions(pluginVersion, centralVersion, options = {}) {
  const plugin = typeof pluginVersion === 'string' ? pluginVersion.trim() : '';
  const central = typeof centralVersion === 'string' ? centralVersion.trim() : '';
  const protocolError = checkExplicitProtocolMarkers(plugin, central, options);
  if (protocolError) {
    return {
      status: 'refuse',
      code: 'incompatible_version',
      reason: 'protocol_mismatch',
      pluginVersion: plugin || null,
      centralVersion: central || null,
      message: protocolError
    };
  }
  if (!plugin || !central) {
    return { status: 'unknown', pluginVersion: plugin || null, centralVersion: central || null };
  }
  if (plugin === central) {
    return { status: 'aligned', pluginVersion: plugin, centralVersion: central };
  }
  return {
    status: 'warn',
    code: 'version_skew',
    pluginVersion: plugin,
    centralVersion: central,
    message:
      `[h2a-shim] WARNING (step=plugin-central-version-check): plugin version ${plugin} differs from central MCP version ${central}; ` +
      `bridge stays connected using the installed CLI (update plugin cache / run "h2a doctor --repair" or let central handover run to realign)`
  };
}
