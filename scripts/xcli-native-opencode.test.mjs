import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {environment, cliPath} from './xcli-lab.mjs';

test('R32: native OpenCode connects MCP and loads the scoped plugin without a model', async () => {
  const executable = process.env.XCLI_OPENCODE_BINARY ?? cliPath('opencode', process.env.PATH);
  const { openCodeCellConfig, openCodePluginSource, OPENCODE_TOOLS } = await import('./xcli-opencode.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-opencode-native-'));
  try {
    assert.ok(executable, 'an explicit native OpenCode oracle is required');
    const env = environment(root);
    const plugin = join(root, 'h2a-plugin.mjs');
    fs.writeFileSync(plugin, openCodePluginSource());
    const configDir = join(env.XDG_CONFIG_HOME, 'opencode');
    fs.mkdirSync(configDir, { recursive: true });
    const server = join(root, 'mcp-fixture.mjs');
    fs.writeFileSync(server, `import {createInterface} from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
 const rpc=JSON.parse(line);if(rpc.id===undefined)continue;
 const result=rpc.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'h2a-fixture',version:'1.0.0'}}:
 rpc.method==='tools/list'?{tools:${JSON.stringify(OPENCODE_TOOLS.map(name=>({name:name.slice(4),description:'synthetic oracle',inputSchema:{type:'object',properties:{}}})))}}:{};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result})+'\\n');
}`);
    fs.writeFileSync(join(configDir, 'opencode.json'), JSON.stringify(openCodeCellConfig(
      { command: process.execPath, args: [server] }, plugin)));
    const resolved = spawnSync(executable, ['debug', 'config'], { env, cwd: root,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(resolved.status, 0, resolved.stderr);
    const parsed = JSON.parse(resolved.stdout);
    assert.deepEqual(parsed.mcp.h2a.command, [process.execPath, server]);
    for (const tool of OPENCODE_TOOLS) assert.equal(parsed.permission[tool], 'allow');
    assert.ok(!Object.entries(parsed.permission).some(([tool, action]) => action === 'allow' && !OPENCODE_TOOLS.includes(tool)));
    const connected = spawnSync(executable, ['mcp', 'list'], { env, cwd: root,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.equal(connected.status, 0, connected.stderr);
    assert.match(connected.stdout + connected.stderr, /h2a[\s\S]*connected/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
