// Frozen L0 expectations, independent of the product synchronizer's inventory.
// Old skill bytes are v0.98.6:packages/h2a/skills/h2a-run/SKILL.md.
// The native ownership records use rc.7's schema, with synthetic owned bytes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { getStaticTOMLValue, parseForESLint } from 'toml-eslint-parser';
import YAML from 'yaml';
import { hash, json } from './cleanse-artifact.mjs';
import { mcpState, toolVisible } from './cleanse-host-state.mjs';

const oldSkill = readFileSync(new URL('./fixtures/cleanse-old-run.md', import.meta.url), 'utf8');
const put = (p, bytes) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); };

export function seedHosts(a, { agyEnabled = true, vibeDisabled = false, mcpDisabled = [], mcpFilters = {} } = {}) {
  const home = a.env.HOME;
  a.env.CLAUDE_CONFIG_DIR = join(home, 'claude-config');
  a.env.CODEX_HOME = join(home, 'codex-config');
  a.env.VIBE_HOME = join(home, 'vibe-config');
  const specs = [
    ['claude', a.env.CLAUDE_CONFIG_DIR, '.claude.json'],
    ['codex', a.env.CODEX_HOME, 'config.toml'],
    ['gemini', join(home, '.gemini'), 'settings.json'],
    ['agy', join(home, '.gemini'), 'config/mcp_config.json'],
    ['hermes', join(home, '.hermes'), 'config.yaml'],
    ['opencode', join(home, '.config/opencode'), 'opencode.json'],
    ['muse', join(home, '.config/muse'), 'settings.json'],
    ['vibe', a.env.VIBE_HOME, 'config.toml'],
  ];
  const inventory = specs.map(([host, root, config]) => {
    const shared = ['agy', 'gemini'].includes(host);
    const skill = join(root, shared ? 'commands/h2a-run.toml' : 'skills/h2a-run/SKILL.md');
    const old = shared ? `description = "old h2a-run"\nprompt = '''\n${oldSkill}\n'''\n` : oldSkill;
    put(skill, old);
    const resource = join(root, shared ? '.h2a-install/skill-resources/track/' + a.version + '/present-decision/assets/native-questions.md' : 'skills/present-decision/assets/native-questions.md');
    // A previous release's resource is deliberately different from the candidate.
    const oldResource = 'h2a-owned historical native-question resource\n';
    const oldResourcePath = shared ? resource.replace(a.version, '0.98.6') : resource;
    put(oldResourcePath, oldResource);
    const mcp = join(root, config);
    const command = join(a.root, 'old-prefix/bin/h2a');
    const server = host === 'opencode' ? { type: 'local', command: [command, 'mcp-serve'] } : { command, args: ['mcp-serve'], transport: 'stdio' };
    put(mcp, config.endsWith('.toml') ? `${host === 'vibe' ? '[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"' + (vibeDisabled ? '\ndisabled = true' : '') : '[mcp_servers.h2a]'}\ncommand = "${command}"\nargs = ["mcp-serve"]\n\n[fixture]\nsentinel = "third-party"\n` :
      config.endsWith('.yaml') ? `mcp_servers:\n  h2a:\n    command: ${command}\n    args: [mcp-serve]\nfixture: third-party\n` :
      JSON.stringify({ [host === 'opencode' ? 'mcp' : 'mcpServers']: { h2a: server },
        ...(host === 'opencode' ? { instructions: ['third-party'] } : { fixture: 'third-party' }) }));
    const mcpEnabled = !mcpDisabled.includes(host) && !(host === 'vibe' && vibeDisabled);
    if (!mcpEnabled && !(host === 'vibe' && vibeDisabled)) {
      if (config.endsWith('.toml')) put(mcp, readFileSync(mcp, 'utf8').replace('command = ', (host === 'vibe' ? 'disabled = true' : 'enabled = false') + '\ncommand = '));
      else if (config.endsWith('.yaml')) put(mcp, readFileSync(mcp, 'utf8').replace('    command:', '    enabled: false\n    command:'));
      else {
        const value = { [host === 'opencode' ? 'mcp' : 'mcpServers']: { h2a: server },
          ...(host === 'opencode' ? { instructions: ['third-party'] } : { fixture: 'third-party' }) };
        if (host === 'claude') value.projects = { [a.root]: { disabledMcpServers: ['h2a'] } };
        else if (host === 'gemini') value.mcp = { excluded: ['h2a'] };
        else server[host === 'agy' ? 'disabled' : 'enabled'] = host === 'agy';
        put(mcp, JSON.stringify(value));
      }
    }
    const filters = mcpFilters[host];
    if (filters) {
      if (config.endsWith('.toml')) {
        const fields = Object.entries(filters.server ?? {}).map(([k, v]) => `${k} = ${JSON.stringify(v)}\n`).join('');
        const globals = Object.entries(filters.global ?? {}).map(([k, v]) => `${k} = ${JSON.stringify(v)}\n`).join('');
        put(mcp, globals + readFileSync(mcp, 'utf8').replace('command = ', fields + 'command = '));
      } else {
        const value = config.endsWith('.yaml') ? YAML.parse(readFileSync(mcp, 'utf8')) : json(mcp);
        Object.assign(value, filters.global);
        Object.assign((value.mcp_servers ?? value.mcpServers ?? value.mcp).h2a, filters.server);
        put(mcp, config.endsWith('.yaml') ? YAML.stringify(value) : JSON.stringify(value));
      }
    }
    const state = join(root, shared ? '.h2a-install-agy' : '.h2a-install');
    const manifestName = shared ? 'shared-owner.json' : 'manifest.json';
    const record = { schema: 1, host: shared ? 'gemini-commands' : host, root, version: '0.98.6', files: {
      [skill.slice(root.length + 1)]: { sha256: hash(old), source: 'h2a@0.98.6/h2a-run', selected: true },
      [oldResourcePath.slice(root.length + 1)]: { sha256: hash(oldResource), source: 'track@0.98.6/present-decision/assets/native-questions.md', selected: true },
    } };
    let helper;
    if (['agy', 'muse'].includes(host)) {
      helper = join(state, 'hooks/workspace-scope-guard.mjs');
      const bytes = '// h2a-owned historical workspace helper\n';
      put(helper, bytes);
      record.files[helper.slice(root.length + 1)] = { sha256: hash(bytes), source: 'h2a@0.98.6/hooks/workspace-scope-guard.mjs', selected: true };
    }
    let hooks, imported;
    if (['agy', 'muse'].includes(host)) {
      const workspace = join(a.root, 'workspace');
      const hooksRoot = host === 'muse' ? join(workspace, '.muse') : join(root, 'config');
      hooks = join(hooksRoot, 'hooks.json');
      const command = commandForOldHelper(a.root, host);
      const value = host === 'muse' ? { hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command }] }] }, fixture: 'third-party' } :
        { 'sentropic-h2a-workspace-scope': { enabled: true, PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command }] }] }, fixture: 'third-party' };
      const bytes = JSON.stringify(value);
      put(hooks, bytes);
      record.workspaceScope = { enabled: true, ...(host === 'muse' ? { workspace } : {}) };
      if (host === 'muse') put(join(hooksRoot, '.h2a-scope-install/manifest.json'), JSON.stringify({ schema: 1, host: 'muse-scope', root: hooksRoot, version: '0.98.6',
        files: { 'hooks.json': { sha256: hash(bytes), source: 'h2a@0.98.6/native-scope-hooks', selected: true } } }));
      else record.files['config/hooks.json'] = { sha256: hash(bytes), source: 'h2a@0.98.6/native-scope-hooks', selected: true };
    }
    if (host === 'agy') {
      imported = join(a.root, 'vendor-state/agy/commands/h2a-run.toml');
      put(imported, old);
      put(join(a.root, 'vendor-state/agy/enabled'), String(agyEnabled));
    }
    put(join(state, manifestName), JSON.stringify(record));
    let registration;
    if (['claude', 'codex'].includes(host)) {
      const cache = join(root, 'plugins/cache/sentropic/h2a/0.98.6');
      put(join(cache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'h2a', version: '0.98.6' }));
      put(join(cache, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'h2a', version: '0.98.6' }));
      put(join(cache, 'skills/h2a-run/SKILL.md'), oldSkill);
      // Stable historical bytes: a digest must not encode the random lab root.
      put(join(cache, 'hooks/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ command: 'node old-prefix/hooks/workspace-scope-guard.mjs --host ' + host }] } }));
      const marketplace = join(root, host === 'codex' ? '.tmp/marketplaces/sentropic' : 'plugins/marketplaces/sentropic');
      put(join(marketplace, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'sentropic', plugins: [{ name: 'h2a', source: './packages/h2a' }] }));
      if (host === 'claude') {
        registration = join(root, 'plugins/installed_plugins.json');
        put(registration, JSON.stringify({ version: 2, plugins: { 'h2a@sentropic': [{ scope: 'user', installPath: cache, version: '0.98.6' }] } }));
        put(join(root, 'settings.json'), JSON.stringify({ enabledPlugins: { 'h2a@sentropic': true } }));
        put(join(root, 'plugins/known_marketplaces.json'), JSON.stringify({ sentropic: { source: { source: 'github', repo: 'rhanka/h2a' }, installLocation: marketplace } }));
      } else {
        // Codex uses TOML registrations, not Claude's installed_plugins.json.
        registration = mcp;
        put(mcp, readFileSync(mcp, 'utf8') + '\n[plugins."h2a@sentropic"]\nenabled = false\n\n[marketplaces.sentropic]\nsource_type = "git"\nsource = "https://github.com/rhanka/h2a.git"\nref = "main"\n');
      }
    }
    // Host executables are observable fixtures. Plugin commands really copy a
    // supplied local payload and update the private registration, never just 0.
    put(join(a.root, 'bin', host), `#!${process.execPath}
      const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2),root=${JSON.stringify(root)};
      fs.appendFileSync(root+'/fixture-cli-calls',JSON.stringify(args)+'\\n');
      if(args.includes('--version')){console.log('${host} 1.0.0');process.exit(0)}
      if('${host}'==='agy'&&args.join(' ')==='plugin import gemini'){
        fs.cpSync(path.join(root,'commands'),${JSON.stringify(join(a.root, 'vendor-state/agy/commands'))},{recursive:true});process.exit(0);
      }
      if('${host}'==='agy'&&args.join(' ')==='plugin enable h2a'){
        fs.writeFileSync(${JSON.stringify(join(a.root, 'vendor-state/agy/enabled'))},'true');process.exit(0);
      }
      const source=args.find(x=>path.isAbsolute(x)&&fs.existsSync(path.join(x,'.claude-plugin/plugin.json')));
      if(source&&args.includes('plugin')){
        const meta=JSON.parse(fs.readFileSync(path.join(source,'.claude-plugin/plugin.json'),'utf8'));
        const cache=path.join(root,'plugins/cache/sentropic/h2a',meta.version);
        fs.cpSync(source,cache,{recursive:true});
        if('${host}'==='claude')fs.writeFileSync(path.join(root,'plugins/installed_plugins.json'),JSON.stringify({version:2,plugins:{'h2a@sentropic':[{scope:'user',installPath:cache,version:meta.version}]}}));
        process.exit(0);
      }
      if(args.includes('list')){console.log('{}');process.exit(0)}
      console.error('unsupported fixture CLI operation');process.exit(64);
    `);
    chmodSync(join(a.root, 'bin', host), 0o700);
    // put() preserves a deliberately constrained executable path.
    const item = { host, root, skill, resource, mcp, helper, hooks, imported, registration, agyEnabled, vibeDisabled, mcpEnabled, format: shared ? 'toml' : 'markdown' };
    const initial = parseConfig(item);
    const registered = entries(initial, host).find(([name]) => name === 'h2a');
    assert.ok(registered, host + ': initial native MCP registration is required');
    item.mcpName = registered[0];
    item.mcpState = structuredClone(mcpState(a, host, initial, registered[1]));
    return item;
  });
  return inventory;
}

function commandForOldHelper(root, host) {
  return `${process.execPath} ${join(root, 'old-prefix/hooks/workspace-scope-guard.mjs')} --host ${host}`;
}

const text = path => path && existsSync(path) ? readFileSync(path, 'utf8') : undefined;
const digest = path => path && existsSync(path) ? hash(readFileSync(path)) : undefined;
const prompt = path => { const bytes = text(path); return bytes === undefined ? undefined : getStaticTOMLValue(parseForESLint(bytes).ast).prompt?.trim(); };
const scopeFiles = ['workspace-scope-guard.mjs', 'workspace-scope-shell.mjs', 'workspace-scope-state.mjs'];
const parseConfig = item => item.mcp.endsWith('.toml') ? getStaticTOMLValue(parseForESLint(text(item.mcp)).ast) :
  item.mcp.endsWith('.yaml') ? YAML.parse(text(item.mcp)) : json(item.mcp);
const entries = (config, host) => {
  if (host === 'muse' && config.mcp_servers && config.mcpServers) return [];
  const servers = host === 'opencode' ? config.mcp ?? {} : ['vibe', 'codex', 'hermes'].includes(host) ? config.mcp_servers ?? {} :
    host === 'muse' ? config.mcpServers ?? config.mcp_servers ?? {} : config.mcpServers ?? {};
  if (host === 'vibe') return Array.isArray(servers) ? servers.map(s => [s?.name, s]) : [];
  return servers && typeof servers === 'object' && !Array.isArray(servers) ? Object.entries(servers) : [];
};
const argv = server => Array.isArray(server?.command) ? server.command : [server?.command, ...(server?.args ?? [])];
function executable(a, arg) {
  if (typeof arg !== 'string') return undefined;
  const base = a.cwd ?? a.root;
  const paths = isAbsolute(arg) ? [arg] : arg.includes('/') || arg.includes('\\') ? [resolve(base, arg)] :
    a.env.PATH.split(delimiter).map(dir => resolve(base, dir, arg));
  for (const path of paths) {
    try { return realpathSync(path); } catch { /* Missing executables are not current. */ }
  }
}

function payload(root) {
  const out = {};
  function walk(path, relative) {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative + '/' + entry.name, child = join(path, entry.name);
      if (entry.isDirectory()) walk(child, name);
      else if (entry.isFile()) out[name] = digest(child);
    }
  }
  for (const dir of ['skills', 'hooks']) walk(join(root, dir), dir);
  for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.mcp.json']) out[path] = digest(join(root, path));
  return out;
}

function pluginState(a, item, config) {
  if (!item.registration) return undefined;
  if (item.host === 'claude') {
    const registrations = json(item.registration).plugins?.['h2a@sentropic'] ?? [];
    return { registrations, caches: registrations.map(active => ({ path: active.installPath,
      payload: payload(active.installPath) })) };
  }
  // Resolve the SELECTED marketplace first. A guessed candidate cache directory
  // says nothing about what Codex will load (including disabled installations).
  const selected = config.marketplaces?.sentropic;
  const marketplace = selected?.source_type === 'local' ? selected.source :
    selected?.source_type === 'git' ? join(item.root, '.tmp/marketplaces/sentropic') : undefined;
  const manifestPath = marketplace && join(marketplace, '.claude-plugin/marketplace.json');
  const manifest = text(manifestPath) ? json(manifestPath) : undefined;
  const plugins = manifest?.plugins?.filter(p => p.name === 'h2a') ?? [];
  const source = plugins[0]?.source;
  const relative = typeof source === 'string' ? source : source?.source === 'local' ? source.path : undefined;
  const sourceRoot = marketplace && relative ? join(marketplace, relative) : undefined;
  const meta = sourceRoot && text(join(sourceRoot, '.codex-plugin/plugin.json'));
  const version = meta ? JSON.parse(meta).version : undefined;
  const cache = version && join(item.root, 'plugins/cache/sentropic/h2a', version);
  return { selected, manifest, source: sourceRoot, sourcePayload: sourceRoot ? payload(sourceRoot) : undefined,
    version, cache, cachePayload: cache ? payload(cache) : undefined };
}

function hostEvidence(a, item, config) {
  const servers = entries(config, item.host).filter(([name]) => /^h2a|^track/.test(name));
  const globals = item.host === 'claude' ? { disabledMcpServers: config.projects?.[a.root]?.disabledMcpServers } :
    item.host === 'gemini' ? { allowed: config.mcp?.allowed, excluded: config.mcp?.excluded } :
    item.host === 'vibe' ? { enable_mcp: config.enable_mcp, enabled_tools: config.enabled_tools,
      disabled_tools: config.disabled_tools, tools: config.tools } :
    item.host === 'opencode' ? { tools: config.tools, permission: config.permission,
      default_agent: config.default_agent, agent: config.agent?.[config.default_agent ?? 'build'] } : {};
  // Ordered entries keep OpenCode's last-matching permission rules significant
  // through the ledger's canonical object-key sorting.
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ?
    { $entries: Object.entries(value).map(([key, value]) => [key, ordered(value)]) } : value;
  const selection = servers.map(([name, server]) => {
    try { return [name, ordered(mcpState(a, item.host, config, server))]; }
    catch (error) { return [name, { invalid: error.message }]; }
  });
  return {
    skill: digest(item.skill), resource: digest(item.resource),
    mcp: { servers, globals: ordered(globals), selection },
    helper: item.helper ? Object.fromEntries(scopeFiles.map(name => [name, digest(join(dirname(item.helper), name))])) : undefined,
    hooks: item.hooks ? json(item.hooks) : undefined,
    imported: item.imported ? { sha256: digest(item.imported), enabled: text(join(a.root, 'vendor-state/agy/enabled')) } : undefined, plugin: pluginState(a, item, config),
  };
}

function servesMcp(a, command, context) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'L0', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(JSON.stringify).join('\n') + '\n';
  const result = spawnSync(command[0], command.slice(1), { ...context, input,
    encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 ** 2 });
  if (result.error || result.status !== 0) return false;
  try {
    const messages = result.stdout.trim().split('\n').map(JSON.parse);
    const init = messages.find(m => m.id === 1)?.result, tools = messages.find(m => m.id === 2)?.result?.tools;
    return init?.serverInfo?.name === '@sentropic/h2a' && init.serverInfo.version === a.version &&
      Array.isArray(tools) && tools.every(t => typeof t.name === 'string') && tools.some(t => t.name.startsWith('h2a_'))
      ? tools.map(t => t.name) : undefined;
  } catch { return undefined; }
}

// Parse only literal argv: do not execute shell syntax, comments or wrappers.
function hookArgv(command) {
  if (typeof command !== 'string') return [];
  const matches = [...command.trim().matchAll(/(?:^|\s+)('([^']*)'|"([^"]*)"|([^\s'"`$;&|<>\\]+))(?=\s|$)/g)];
  if (matches.map(m => m[0]).join('') !== command.trim()) return [];
  return matches.map(m => m[2] ?? m[3] ?? m[4]);
}

function selectedHook(a, item, config, helpersCurrent) {
  if (!helpersCurrent || config.enabled === false) return false;
  const hooks = item.host === 'muse' ? config.hooks : config['sentropic-h2a-workspace-scope'];
  if (!hooks || hooks.enabled === false) return false;
  const groups = hooks.PreToolUse;
  if (!Array.isArray(groups) || groups.length !== 1 || groups[0].matcher !== '.*') return false;
  const commands = groups[0].hooks;
  if (!Array.isArray(commands) || commands.length !== 1 || commands[0].type !== 'command' || commands[0].enabled === false) return false;
  const command = hookArgv(commands[0].command);
  const options = command.slice(2);
  // The real parser takes the last option. Reject ambiguous and unknown argv.
  const allowed = new Set(item.host === 'agy' ? ['--host', '--session-store'] : ['--host', '--workspace']);
  const seen = new Set();
  for (let i = 0; i < options.length; i += 2) {
    if (!allowed.has(options[i]) || seen.has(options[i]) || !options[i + 1] || options[i + 1].startsWith('--')) return false;
    seen.add(options[i]);
  }
  if (!seen.has('--host')) return false;
  if (executable(a, command[0]) !== realpathSync(process.execPath) || executable(a, command[1]) !== executable(a, item.helper) ||
      options[options.indexOf('--host') + 1] !== item.host) return false;
  const anchor = item.host === 'agy' ? '--session-store' : '--workspace';
  const expected = item.host === 'agy' ? dirname(dirname(item.helper)) : dirname(dirname(item.hooks));
  const anchorIndex = options.indexOf(anchor);
  if (anchorIndex >= 0 ? options[anchorIndex + 1] !== expected : item.host === 'agy') return false;
  const result = spawnSync(command[0], command.slice(1), { cwd: item.host === 'muse' ? expected : a.root, env: a.env, input: '{',
    encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  return !result.error && /H2A_SCOPE:UNVERIFIABLE/.test(result.stderr) &&
    JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision === 'deny';
}

function currentMcp(a, server, transports, item, config = {}) {
  // Selection is independent of argv: a healthy cached handshake cannot make
  // an entry enabled. Compare with the choice frozen BEFORE installation.
  if (!server) return false;
  let state;
  try { state = mcpState(a, item.host, config, server); }
  catch { return false; }
  const selected = item.mcpState ?? mcpState(a, item.host, {}, {});
  // Preserve native filters as well as activation. A newly written filter is a
  // changed user choice even when it matches no tool in today's catalogue.
  try { assert.deepEqual(state, selected); }
  catch { return false; }
  const enabled = state.enabled;
  if (item?.host === 'vibe' && server.transport !== 'stdio') return false;
  if (item.host === 'claude' && server.type !== undefined && server.type !== 'stdio') return false;
  if (item.host === 'opencode' && (server.type !== 'local' || !Array.isArray(server.command))) return false;
  if (item.host !== 'opencode' && typeof server.command !== 'string') return false;
  if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(arg => typeof arg !== 'string'))) return false;
  if (item.host === 'muse' && (server.type !== undefined && server.transport !== undefined ||
      server.mode !== undefined && server.required !== undefined ||
      server.type !== undefined && server.type !== 'stdio' || server.transport !== undefined && server.transport !== 'stdio')) return false;
  if (['url', 'httpUrl', 'serverUrl'].some(key => server[key] !== undefined)) return false;
  const env = server[item.host === 'opencode' ? 'environment' : 'env'] ?? {};
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.values(env).some(v => typeof v !== 'string')) return false;
  if (server.cwd !== undefined && typeof server.cwd !== 'string') return false;
  const context = { cwd: resolve(a.root, server.cwd ?? '.'), env: { ...a.env, ...env } };
  const command = argv(server), target = executable(context, command[0]);
  const direct = target === realpathSync(a.cli);
  let viaNode = false;
  if (target === realpathSync(process.execPath) && typeof command[1] === 'string') {
    try { viaNode = realpathSync(resolve(context.cwd, command[1])) === realpathSync(a.cli); }
    catch { /* An unresolved script cannot be the current installed candidate. */ }
  }
  if (!(direct || viaNode) || command[direct ? 1 : 2] !== 'mcp-serve') return false;
  // A deliberately disabled entry must keep its choice and current target;
  // it is not an effective server and must not be launched by the witness.
  if (!enabled) return true;
  const key = JSON.stringify([command, context]);
  if (!transports.has(key)) transports.set(key, servesMcp(a, command, context));
  const tools = transports.get(key);
  return Array.isArray(tools) &&
    tools.every(name => toolVisible(item.host, state, name) === toolVisible(item.host, selected, name));
}

function pluginMcp(a, root, host, transports) {
  const manifest = json(join(root, host === 'claude' ? '.claude-plugin/plugin.json' : '.codex-plugin/plugin.json'));
  const declared = manifest.mcpServers;
  if (!declared) return false;
  const config = typeof declared === 'string' ? json(join(root, declared)) : { mcpServers: declared };
  const servers = entries(config);
  return servers.length > 0 && servers.every(([, server]) => currentMcp(a, server, transports, { host }, config));
}

export function observeHosts(a, inventory) {
  const skill = text(join(a.packages, 'h2a/skills/h2a-run/SKILL.md'));
  const resource = digest(join(a.packages, 'track/skills/present-decision/assets/native-questions.md'));
  assert.ok(skill, 'candidate payload missing required h2a-run skill');
  assert.ok(resource, 'candidate payload missing required linked resource');
  for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.mcp.json', 'hooks/hooks.json',
    'hooks/deny-manual-h2a-cli.mjs', ...scopeFiles.map(name => 'hooks/' + name)]) {
    assert.ok(digest(join(a.packages, 'h2a', path)), 'candidate payload missing required ' + path);
  }
  const expectedHelpers = Object.fromEntries(scopeFiles.map(name => [name, digest(join(a.packages, 'h2a/hooks', name))]));
  const expectedPlugin = payload(join(a.packages, 'h2a'));
  const observations = [];
  const transports = new Map();
  for (const item of inventory) {
    const config = parseConfig(item), evidence = hostEvidence(a, item, config);
    const add = (family, actual, key) => observations.push({ id: item.host + ' installed ' + family, lot: 'L3+L4',
      actual, expected: true, evidence: evidence[key] });
    assert.ok(text(item.mcp).includes('third-party'), item.host + ': preserve unrelated configuration');
    const installedSkill = text(item.skill);
    const rendered = item.format === 'toml' ? prompt(item.skill) : undefined;
    add('skill bytes', item.format === 'markdown' ? installedSkill === skill :
      rendered?.trim() === skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim(), 'skill');
    add('linked resource bytes', evidence.resource === resource, 'resource');
    const servers = entries(config, item.host), routes = servers.filter(([name, server]) =>
      /^h2a/.test(name) || argv(server).some(arg => typeof arg === 'string' && arg.includes(a.cli)));
    add('MCP resolves activated prefix', routes.length === 1 && routes[0][0] === item.mcpName && servers.filter(([name]) => /^track/.test(name)).length <= 1 &&
      currentMcp(a, routes[0]?.[1], transports, item, config), 'mcp');
    let helpersCurrent;
    if (item.helper) {
      helpersCurrent = JSON.stringify(evidence.helper) === JSON.stringify(expectedHelpers);
      add('selected helper bytes', helpersCurrent, 'helper');
    }
    if (item.hooks) {
      assert.ok(text(item.hooks).includes('third-party'), 'preserve unrelated workspace hooks');
      add('selected hook registration', selectedHook(a, item, evidence.hooks, helpersCurrent), 'hooks');
    }
    if (item.imported) add('observed Agy imported bytes', evidence.imported.enabled === String(item.agyEnabled) && prompt(item.imported) ===
      skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim(), 'imported');
    if (item.registration) {
      const plugin = evidence.plugin;
      let current;
      if (item.host === 'claude') {
        assert.equal(json(join(item.root, 'settings.json')).enabledPlugins['h2a@sentropic'], true);
        current = plugin.registrations.length === 1 && plugin.registrations[0].version === a.version &&
          JSON.stringify(plugin.caches[0].payload) === JSON.stringify(expectedPlugin) &&
          pluginMcp(a, plugin.registrations[0].installPath, item.host, transports);
      } else {
        assert.equal(config.plugins['h2a@sentropic'].enabled, false, 'disabled selection must stay disabled');
        current = (plugin.selected?.source_type === 'local' ||
          plugin.selected?.source_type === 'git' && plugin.selected.ref === 'v' + a.version) &&
          plugin.manifest?.plugins?.filter(p => p.name === 'h2a').length === 1 && plugin.version === a.version &&
          JSON.stringify(plugin.sourcePayload) === JSON.stringify(expectedPlugin) &&
          JSON.stringify(plugin.cachePayload) === JSON.stringify(expectedPlugin);
      }
      add('registered effective plugin cache', !!current, 'plugin');
    }
  }
  assert.equal(inventory.length, 8);
  assert.equal(observations.length, 31, 'frozen required-artifact count (8 skills + 8 resources + 8 MCP + 2 helpers + 2 registrations + Agy import + 2 plugins)');
  return observations;
}
