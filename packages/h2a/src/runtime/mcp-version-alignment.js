/**
 * Compare the host plugin version (`plugin.json`) against the central MCP
 * server version (`marker.packageVersion`) so skew emits an actionable warning
 * or refuses cleanly when incompatible.
 */

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

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

/**
 * Evaluate compatibility between plugin manifest version and central version:
 * - identical strings -> `"aligned"`
 * - major difference (or `0.x` minor difference) -> `"refuse"` (incompatible)
 * - patch or prerelease (`-rc.N`) skew on compatible minor -> `"warn"`
 */
export function comparePluginAndCentralVersions(pluginVersion, centralVersion) {
  const plugin = typeof pluginVersion === 'string' ? pluginVersion.trim() : '';
  const central = typeof centralVersion === 'string' ? centralVersion.trim() : '';
  if (!plugin || !central) {
    return { status: 'unknown', pluginVersion: plugin || null, centralVersion: central || null };
  }
  if (plugin === central) {
    return { status: 'aligned', pluginVersion: plugin, centralVersion: central };
  }
  const parsedPlugin = parseSemverVersion(plugin);
  const parsedCentral = parseSemverVersion(central);
  if (!parsedPlugin || !parsedCentral) {
    return {
      status: 'warn',
      code: 'version_skew',
      pluginVersion: plugin,
      centralVersion: central,
      message:
        `[h2a-shim] WARNING (step=plugin-central-version-check): plugin version ${JSON.stringify(plugin)} ` +
        `differs from central MCP version ${JSON.stringify(central)}; update the plugin cache, run "h2a doctor --repair", and restart the host session`
    };
  }
  const majorMismatch = parsedPlugin.major !== parsedCentral.major;
  const zeroMajorMinorMismatch =
    parsedPlugin.major === 0 && parsedCentral.major === 0 && parsedPlugin.minor !== parsedCentral.minor;
  if (majorMismatch || zeroMajorMinorMismatch) {
    return {
      status: 'refuse',
      code: 'incompatible_version',
      pluginVersion: plugin,
      centralVersion: central,
      message:
        `incompatible_version: step=plugin-central-version-check: plugin version ${plugin} is incompatible with central MCP version ${central}; ` +
        `upgrade the plugin ("claude plugin update h2a@sentropic" / "h2a doctor --repair") and restart central ("h2a central stop")`
    };
  }
  return {
    status: 'warn',
    code: 'version_skew',
    pluginVersion: plugin,
    centralVersion: central,
    message:
      `[h2a-shim] WARNING (step=plugin-central-version-check): plugin version ${plugin} differs from central MCP version ${central}; ` +
      `update the plugin cache / run "h2a doctor --repair" and restart the session so skills and validators stay aligned`
  };
}
