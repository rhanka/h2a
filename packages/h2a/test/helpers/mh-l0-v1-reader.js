import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function v1Reader(temp) {
  const source = execFileSync('git', ['show', 'e3fc1a52eb8bc8e5794ced5e17e201e1bcfa99d2:packages/h2a/src/runtime/mcp-central.ts'],
    { encoding: 'utf8' });
  const pieces = [
    ['function uid()', '/** Only explicit'],
    ['function isLoopbackHostname(', '/**\n * Validate'],
    ['export function parseCentralMcpEndpoint(', 'export type CentralMcpClientEndpoint'],
    ['function expectedMode(', '/** Read the token'],
    ['function readCentralClientMarker(', '/**\n * Read the protected']
  ].map(([start, end]) => {
    const from = source.indexOf(start); const to = source.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error('v1_reader_extraction_failed');
    return source.slice(from, to);
  });
  const ts = createRequire(import.meta.url)('typescript');
  const code = `import { lstatSync, readFileSync } from 'node:fs';\nconst H2A_MCP_CENTRAL_ENDPOINT_ENV='H2A_MCP_CENTRAL_ENDPOINT';\n` +
    pieces.join('\n') + '\nexport { readCentralClientMarker };';
  const path = join(temp, 'published-v1-reader.mjs');
  writeFileSync(path, ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  return (await import(pathToFileURL(path).href)).readCentralClientMarker;
}
