import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureHistoricalGitRef, L0_HERITAGE_REF } from '../../../../scripts/historical-test-ref.mjs';

// Reuse the .6 leaf exactly; never load its readers or an installed h2a dist.
export async function procClassifier(temp) {
  // A depth-1 release checkout (and any fresh clone) does not carry the
  // pre-purge heritage commit: provide it on demand before reading it.
  ensureHistoricalGitRef(resolve(import.meta.dirname, '../../../..'), L0_HERITAGE_REF);
  const source = execFileSync('git', ['show', `${L0_HERITAGE_REF}:packages/h2a-runtime/src/proc-identity.ts`],
    { encoding: 'utf8' });
  const ts = createRequire(import.meta.url)('typescript');
  const path = join(temp, 'proc-identity.mjs');
  writeFileSync(path, ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  return (await import(pathToFileURL(path).href)).classifyDurableProcFrame;
}
