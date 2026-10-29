// Independent L0 model of the user configuration selected by each fixture.
// Sources and qualification boundaries: docs/reviews/native-cleanse-l0-r7.md.
// Each reader decides whether an unknown alias is ignored or invalid.
export function mcpState(a, host, config, server = {}) {
  const bool = (value, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new TypeError(host + ': invalid native MCP boolean');
    return value;
  };
  const vibeBool = (value, fallback) => {
    if (value === undefined) return fallback;
    if (value === true || value === 1 || typeof value === 'string' && /^(1|true|t|y|yes|on)$/i.test(value)) return true;
    if (value === false || value === 0 || typeof value === 'string' && /^(0|false|f|n|no|off)$/i.test(value)) return false;
    throw new TypeError(host + ': invalid Pydantic MCP boolean');
  };
  const list = value => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new TypeError(host + ': invalid native MCP tool list');
    return value;
  };
  switch (host) {
    case 'vibe': return { enabled: !vibeBool(server.disabled, false) && vibeBool(config.enable_mcp, true),
      allow: list(config.enabled_tools), deny: list(config.disabled_tools), disabledTools: list(server.disabled_tools), permissions: config.tools ?? {} };
    case 'codex': return { enabled: bool(server.enabled, true), allow: list(server.enabled_tools), deny: list(server.disabled_tools) };
    case 'muse': return { enabled: bool(server.enabled, true) }; // 1.3.0 records tool lists but ignores them.
    case 'hermes': return { enabled: typeof server.enabled === 'number' ? server.enabled !== 0 :
      typeof server.enabled === 'boolean' ? server.enabled :
        typeof server.enabled === 'string' ? !['false', '0', 'no', 'off'].includes(server.enabled.trim().toLowerCase()) : true,
      allow: server.tools?.include == null ? undefined : list(typeof server.tools.include === 'string' ? [server.tools.include] : server.tools.include),
      deny: server.tools?.exclude == null ? undefined : list(typeof server.tools.exclude === 'string' ? [server.tools.exclude] : server.tools.exclude) };
    case 'agy': return { enabled: !bool(server.disabled, false), allow: list(server.enabledTools), deny: list(server.disabledTools) };
    case 'gemini': return { enabled: !(list(config.mcp?.excluded) ?? []).includes('h2a') &&
      (config.mcp?.allowed === undefined || list(config.mcp.allowed).includes('h2a')),
      allow: list(server.includeTools), deny: list(server.excludeTools) };
    case 'claude': return { enabled: !(list(config.projects?.[a.root]?.disabledMcpServers) ?? []).includes('h2a') };
    case 'opencode': {
      // The supported legacy mcp.<name> schema is strict, unlike Vibe's
      // extra=ignore model. mcp.servers uses a different (new) schema.
      const fields = ['type', 'command', 'cwd', 'environment', 'enabled', 'timeout'];
      if (Object.keys(server).some(key => !fields.includes(key))) throw new TypeError('opencode: unknown MCP field');
      return { enabled: bool(server.enabled, true), tools: config.tools ?? {}, permission: config.permission ?? {},
        agent: config.agent?.[config.default_agent ?? 'build'] ?? {} };
    }
    default: throw new Error('unmodelled MCP adapter: ' + host);
  }
}

function glob(name, pattern, { insensitive = false, classes = true } = {}) {
  // Vibe/Hermes use fnmatch classes. OpenCode supports only * and ?;
  // every other character is literal, including brackets.
  let expression = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') expression += '.*';
    else if (c === '?') expression += '.';
    else if (classes && c === '[' && pattern.indexOf(']', i + 1) > i + 1) {
      const end = pattern.indexOf(']', i + 1), body = pattern.slice(i + 1, end);
      expression += '[' + (body.startsWith('!') ? '^' + body.slice(1) : body) + ']'; i = end;
    } else expression += /[.*+?^${}()|[\]\\]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^(?:' + expression + ')$', insensitive ? 'i' : '').test(name);
}
function vibeMatches(name, patterns = []) {
  return patterns.some(raw => {
    const p = raw.trim();
    if (!p) return false;
    if (!p.startsWith('re:')) return glob(name, p, { insensitive: true });
    try { return new RegExp('^(?:' + p.slice(3) + ')$', 'i').test(name); }
    catch { return false; } // Vibe ignores invalid regexes.
  });
}
export function toolVisible(host, state, name) {
  const { allow, deny } = state;
  switch (host) {
    case 'vibe': return !(state.disabledTools ?? []).includes(name) &&
      (!allow?.length || vibeMatches('h2a_' + name, allow)) && !vibeMatches('h2a_' + name, deny) &&
      state.permissions['h2a_' + name]?.permission !== 'never';
    case 'codex': case 'agy': return (allow === undefined || allow.includes(name)) && !(deny ?? []).includes(name);
    case 'gemini': return (allow === undefined || allow.some(t => t === name || t.startsWith(name + '('))) && !(deny ?? []).includes(name);
    case 'hermes': return allow !== undefined ? allow.some(p => glob(name, p)) : !(deny ?? []).some(p => glob(name, p));
    case 'opencode': {
      const tool = 'h2a_' + name;
      let enabled = true;
      for (const [rules, permission] of [[state.tools, false], [state.permission, true],
        [state.agent.tools ?? {}, false], [state.agent.permission ?? {}, true]]) for (const [p, value] of Object.entries(typeof rules === 'string' ? { '*': rules } : rules)) {
        if (glob(tool, p, { classes: false })) enabled = permission ? value !== 'deny' : value;
      }
      return enabled;
    }
    case 'claude': case 'muse': return true;
    default: throw new Error('unmodelled MCP tool adapter: ' + host);
  }
}
