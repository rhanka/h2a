import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { prepareAuthority, currentIdentity } from '../../src/runtime/handover/admission.js';
import { publishState } from '../../src/runtime/handover/state.js';
import { createAuthenticatedServer } from '../../src/runtime/handover/authenticated-http.js';
import { ConnectionAuthentication } from '../../src/runtime/handover/authentication.js';
import { marker } from './mh-l0-fixtures.js';
import { bridgeCentralMcpStdio } from '../../dist/runtime/mcp-central-client.js';
import { describeCatalogue } from '../../src/runtime/handover/catalogue.js';
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from '../../dist/runtime/mcp/tools.js';

export const descriptor = describeCatalogue(JSON.parse(JSON.stringify(H2A_CLI_MCP_TOOL_DESCRIPTORS)));
export const json = (value, session) => new Response(JSON.stringify(value), { headers: {
  'content-type': 'application/json', ...(session ? { 'mcp-session-id': session } : {}) } });
export async function fixture(handler) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-net-'));
  const runtimeBase = join(dir, 'run'), root = join(dir, 'store'), directory = join(runtimeBase, 'h2a-mcp-central');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.mkdirSync(root, { mode: 0o700 });
  let server, authority;
  if (handler) {
    authority = await prepareAuthority({ directory, root, physicalPrefix: dir });
    const m = { ...marker(), root, stateDirectory: directory, authKeyReference: authority.authKeyReference, prefixId: authority.domain.prefixId,
      namespaceId: authority.domain.namespaceId, uid: process.getuid(), processIdentity: currentIdentity(), pid: process.pid };
    m.publicationEpoch.bootId = m.processIdentity.bootId;
    const auth = new ConnectionAuthentication(m, authority.rootKey);
    server = createAuthenticatedServer(auth, async request => {
      if (new URL(request.url).pathname === '/_h2a-central/catalogue') return json({ ...descriptor, revision: 1 });
      return handler(request);
    }).listen(0, '127.0.0.1'); await once(server, 'listening');
    m.endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
    publishState(join(directory, 'marker.json'), m, 'marker');
  }
  const frames = [], input = new PassThrough(), output = new PassThrough(), abort = new AbortController();
  const reader = createInterface({ input: output }); reader.on('line', line => frames.push(JSON.parse(line)));
  const endpoint = server ? `http://127.0.0.1:${server.address().port}/mcp` : 'http://127.0.0.1:1/mcp';
  const running = bridgeCentralMcpStdio({ endpoint, runtimeBase, stdin: input, stdout: output, signal: abort.signal, workspaceRoot: dir });
  let failure; void running.catch(e => { failure = e; });
  const wait = async predicate => {
    for (let i = 0; i < 200; i++) { const found = frames.find(predicate); if (found) return found; if (failure) throw failure; await new Promise(r => setTimeout(r, 5)); }
    assert.fail('expected frame: ' + JSON.stringify(frames));
  };
  return { dir, frames, input, output, running, send: message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'),
    wait, async close() { abort.abort(); input.end(); await running.catch(() => {}); reader.close(); output.end();
      if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
      fs.rmSync(dir, { recursive: true, force: true }); } };
}
