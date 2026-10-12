import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse the .6 leaf exactly; never load its readers or an installed h2a dist.
export async function procClassifier(temp) {
  const source = execFileSync('git', ['show', '0b9cf8862be689380c3bcb6e7cb35dc1e10b5cbf:packages/h2a-runtime/src/proc-identity.ts'],
    { encoding: 'utf8' });
  const ts = createRequire(import.meta.url)('typescript');
  const path = join(temp, 'proc-identity.mjs');
  writeFileSync(path, ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  return (await import(pathToFileURL(path).href)).classifyDurableProcFrame;
}
