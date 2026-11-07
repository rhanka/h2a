import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {environment, cliPath} from './xcli-lab.mjs';

test('R32: native OpenCode connects MCP and loads the scoped plugin without a model', async () => {
  const executable = process.env.XCLI_OPENCODE_BINARY ?? cliPath('opencode', process.env.PATH);
  const { openCodeCellConfig, openCodePluginSource, openCodeEnvironment, OPENCODE_TOOLS, OPENCODE_PLUGIN_READY } = await import('./xcli-opencode.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-opencode-native-'));
  try {
    assert.ok(executable, 'an explicit native OpenCode oracle is required');
    const baseEnv = environment(root);
    const version = spawnSync(executable, ['--version'], { env: baseEnv, cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), '1.17.15', 'qualify a version drift deliberately');
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(executable)) hash.update(chunk);
    const binarySha256 = hash.digest('hex');
    const plugin = join(root, 'h2a-plugin.mjs');
    fs.writeFileSync(plugin, openCodePluginSource());
    const configDir = join(baseEnv.XDG_CONFIG_HOME, 'opencode');
    fs.mkdirSync(configDir, { recursive: true });
    const configFile = join(configDir, 'opencode.json');
    const managedDir = join(root, 'managed');
    fs.mkdirSync(managedDir);
    const env = openCodeEnvironment(baseEnv, configFile, managedDir);
    const server = join(root, 'mcp-fixture.mjs');
    const calls = join(root, 'mcp-calls.jsonl');
    fs.writeFileSync(server, `import {createInterface} from 'node:readline';
import fs from 'node:fs';
for await (const line of createInterface({input:process.stdin})) {
 const rpc=JSON.parse(line);if(rpc.id===undefined)continue;
 if(['initialize','tools/list'].includes(rpc.method))fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({method:rpc.method})+'\\n');
 const result=rpc.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'h2a-fixture',version:'1.0.0'}}:
 rpc.method==='tools/list'?{tools:${JSON.stringify(OPENCODE_TOOLS.map(name=>({name:name.slice(4),description:'synthetic oracle',inputSchema:{type:'object',properties:{}}})))}}:{};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result})+'\\n');
}`);
    fs.writeFileSync(configFile, JSON.stringify(openCodeCellConfig(
      { command: process.execPath, args: [server] }, plugin)));
    fs.chmodSync(configDir, 0o500);
    const resolved = spawnSync(executable, ['debug', 'config'], { env, cwd: root,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.ok(resolved.stderr.includes(OPENCODE_PLUGIN_READY), 'the real plugin factory must run');
    const parsed = JSON.parse(resolved.stdout);
    assert.deepEqual(parsed.mcp.h2a.command, [process.execPath, server]);
    for (const tool of OPENCODE_TOOLS) assert.equal(parsed.permission[tool], 'allow');
    assert.equal(parsed.permission['*'], 'deny');
    assert.ok(!Object.entries(parsed.permission).some(([tool, action]) => action === 'allow' && !OPENCODE_TOOLS.includes(tool)));
    const connected = spawnSync(executable, ['mcp', 'list'], { env, cwd: root,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(connected.status, 0, connected.stderr);
    assert.match(connected.stdout + connected.stderr, /h2a[\s\S]*connected/i);
    const witnessed = fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line).method);
    assert.ok(witnessed.includes('initialize'), 'native MCP initialize must reach the fixture');
    assert.ok(witnessed.includes('tools/list'), 'native MCP tool discovery must reach the fixture');
    fs.chmodSync(configDir, 0o700);
    fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { h2a: { command: process.execPath, args: [server] } } }));
    const wrongSchema = spawnSync(executable, ['debug', 'config'], { env, cwd: root,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.notEqual(wrongSchema.status, 0, 'the legacy mcpServers shape must not pass the native oracle');
    fs.writeFileSync(configFile, JSON.stringify(openCodeCellConfig({ command: process.execPath, args: [server] }, plugin + '.missing')));
    const missingPlugin = spawnSync(executable, ['debug', 'config'], { env, cwd: root,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(missingPlugin.stderr.includes(OPENCODE_PLUGIN_READY), false, 'the absent plugin cannot satisfy the readiness proof');
    console.log(JSON.stringify({ event: 'native-opencode-oracle', version: version.stdout.trim(), binarySha256,
      pluginReady: true, mcpInitialize: true, mcpToolsList: true, wrongSchemaRejected: true, absentPluginDetected: true,
      nativeMessageDelivery: false, modelCalls: 0 }));
  } finally {
    const configDir = join(root, 'home/.config/opencode');
    if (fs.existsSync(configDir)) fs.chmodSync(configDir, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
