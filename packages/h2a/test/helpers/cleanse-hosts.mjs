// Frozen L0 expectations, independent of the product synchronizer's inventory.
// Old skill bytes are v0.98.6:packages/h2a/skills/h2a-run/SKILL.md.
// The native ownership records use rc.7's schema, with synthetic owned bytes.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { getStaticTOMLValue, parseForESLint } from 'toml-eslint-parser';
import YAML from 'yaml';
import { hash, json } from './cleanse-artifact.mjs';

const oldSkill = readFileSync(new URL('./fixtures/cleanse-old-run.md', import.meta.url), 'utf8');
const put = (p, bytes) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); };

export function seedHosts(a) {
  const home = a.env.HOME;
  a.env.CLAUDE_CONFIG_DIR = join(home, 'claude-config');
  a.env.CODEX_HOME = join(home, 'codex-config');
  a.env.VIBE_HOME = join(home, 'vibe-config');
  const specs = [
    ['claude', a.env.CLAUDE_CONFIG_DIR, '.config/claude/mcp.json'],
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
    const server = { command, args: ['mcp-serve'], transport: 'stdio' };
    put(mcp, config.endsWith('.toml') ? `${host === 'vibe' ? '[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"' : '[mcp_servers.h2a]'}\ncommand = "${command}"\nargs = ["mcp-serve"]\n\n[fixture]\nsentinel = "third-party"\n` :
      config.endsWith('.yaml') ? `mcp_servers:\n  h2a:\n    command: ${command}\n    args: [mcp-serve]\nfixture: third-party\n` :
      JSON.stringify({ mcpServers: { h2a: server }, fixture: 'third-party' }));
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
      put(join(a.root, 'vendor-state/agy/enabled'), 'true');
    }
    put(join(state, manifestName), JSON.stringify(record));
    let registration;
    if (['claude', 'codex'].includes(host)) {
      const cache = join(root, 'plugins/cache/sentropic/h2a/0.98.6');
      put(join(cache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'h2a', version: '0.98.6' }));
      put(join(cache, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'h2a', version: '0.98.6' }));
      put(join(cache, 'skills/h2a-run/SKILL.md'), oldSkill);
      put(join(cache, 'hooks/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ command: commandForOldHelper(a.root, host) }] } }));
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
    return { host, root, skill, resource, mcp, helper, hooks, imported, registration, format: shared ? 'toml' : 'markdown' };
  });
  // Mark executable fixtures only, never an installed owner binary.
  return inventory;
}

function commandForOldHelper(root, host) {
  return `${process.execPath} ${join(root, 'old-prefix/hooks/workspace-scope-guard.mjs')} --host ${host}`;
}

export function observeHosts(a, inventory) {
  const skill = readFileSync(join(a.packages, 'h2a/skills/h2a-run/SKILL.md'), 'utf8');
  const resource = readFileSync(join(a.packages, 'track/skills/present-decision/assets/native-questions.md'), 'utf8');
  const helper = readFileSync(join(a.packages, 'h2a/hooks/workspace-scope-guard.mjs'), 'utf8');
  const observations = [];
  for (const item of inventory) {
    const text = p => existsSync(p) ? readFileSync(p, 'utf8') : undefined;
    const add = (family, actual) => observations.push({ id: item.host + ' installed ' + family, lot: 'L3+L4', actual, expected: true });
    const installedSkill = text(item.skill);
    // Gemini's renderer omits frontmatter, so compare the complete body.
    add('skill bytes', item.format === 'markdown' ? installedSkill === skill : installedSkill?.includes(skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim()) === true);
    add('linked resource bytes', text(item.resource) === resource);
    const mcp = text(item.mcp);
    assert.ok(mcp?.includes('third-party'), item.host + ': preserve unrelated configuration');
    const config = item.mcp.endsWith('.toml') ? getStaticTOMLValue(parseForESLint(mcp).ast) :
      item.mcp.endsWith('.yaml') ? YAML.parse(mcp) : JSON.parse(mcp);
    const servers = config.mcp_servers ?? config.mcpServers ?? config.mcp;
    const server = Array.isArray(servers) ? servers.find(s => s.name === 'h2a') : servers?.h2a;
    const command = Array.isArray(server?.command) ? server.command : [server?.command, ...(server?.args ?? [])];
    const executable = arg => {
      if (typeof arg !== 'string') return undefined;
      const paths = isAbsolute(arg) ? [arg] : a.env.PATH.split(delimiter).map(dir => join(dir, arg));
      for (const path of paths) {
        try { return realpathSync(path); } catch { /* Try the next PATH entry. */ }
      }
    };
    const target = executable(command[0]);
    const resolvesCandidate = target === realpathSync(a.cli) ||
      target === realpathSync(process.execPath) && executable(command[1]) === realpathSync(a.cli);
    add('MCP resolves activated prefix', resolvesCandidate);
    if (item.helper) add('selected helper bytes', text(item.helper) === helper);
    if (item.hooks) {
      const hooks = text(item.hooks);
      assert.ok(hooks?.includes('third-party'), 'preserve unrelated workspace hooks');
      add('selected hook registration', hooks.includes(item.helper) && !hooks.includes('old-prefix'));
    }
    if (item.imported) add('observed Agy imported bytes', text(item.imported)?.includes(skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim()) === true);
    if (item.registration) {
      const cache = join(item.root, 'plugins/cache/sentropic/h2a', a.version);
      const active = item.host === 'claude' ? json(item.registration).plugins['h2a@sentropic'][0] :
        { installPath: cache, version: existsSync(join(cache, '.codex-plugin/plugin.json')) ? json(join(cache, '.codex-plugin/plugin.json')).version : undefined };
      if (item.host === 'codex') assert.equal(config.plugins['h2a@sentropic'].enabled, false, 'disabled selection must stay disabled');
      else assert.equal(json(join(item.root, 'settings.json')).enabledPlugins['h2a@sentropic'], true);
      add('registered effective plugin cache', active.version === a.version &&
        text(join(active.installPath, `.${item.host}-plugin/plugin.json`)) === readFileSync(join(a.packages, `h2a/.${item.host}-plugin/plugin.json`), 'utf8') &&
        text(join(active.installPath, 'skills/h2a-run/SKILL.md')) === skill &&
        text(join(active.installPath, 'hooks/hooks.json')) === readFileSync(join(a.packages, 'h2a/hooks/hooks.json'), 'utf8'));
    }
  }
  assert.equal(inventory.length, 8);
  assert.equal(observations.length, 31, 'frozen required-artifact count (8 skills + 8 resources + 8 MCP + 2 helpers + 2 registrations + Agy import + 2 plugins)');
  return observations;
}
