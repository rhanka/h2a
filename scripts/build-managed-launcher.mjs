// Build-time dependency only. The emitted launcher imports Node builtins only.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function buildManagedLauncher() {
  const directory = fileURLToPath(new URL('../', import.meta.url));
  const result = await build({ absWorkingDir: directory, entryPoints: ['packages/h2a/src/runtime/upgrade/managed-launcher.js'],
    bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, metafile: true, logLevel: 'silent' });
  const imports = Object.values(result.metafile.outputs).flatMap(o => o.imports).filter(i => i.external).map(i => i.path);
  if (imports.some(path => !path.startsWith('node:'))) throw new Error('launcher_external_dependency');
  const code = '#!/usr/bin/env node\n' + result.outputFiles[0].text;
  return { code, digest: 'sha256:' + createHash('sha256').update(code).digest('hex'), imports };
}
