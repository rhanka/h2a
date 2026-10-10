// Isolate the specified baseline code, preserving the candidate worktree/dist.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';

const dest = resolve('tmp/launch-lab/baseline-build');
const ref = process.argv[2];
if (!ref) throw new Error('Usage: node scripts/launch-perf-baseline.mjs <baseline-git-ref>');
if (existsSync(dest)) throw new Error('Baseline build already exists');
for (const pkg of ['h2a', 'h2a-runtime']) {
  mkdirSync(join(dest, 'packages', pkg), { recursive: true });
  for (const item of ['dist', 'package.json']) cpSync(`packages/${pkg}/${item}`, join(dest, 'packages', pkg, item), { recursive: true });
  if (pkg === 'h2a') for (const item of ['fixtures', 'schema', 'skills'])
    symlinkSync(resolve('packages/h2a', item), join(dest, 'packages/h2a', item));
  symlinkSync(resolve('packages', pkg, 'node_modules'), join(dest, 'packages', pkg, 'node_modules'));
}
mkdirSync(join(dest, 'node_modules/@sentropic'), { recursive: true });
for (const name of readdirSync('node_modules')) {
  if (name === '@sentropic') continue;
  symlinkSync(resolve('node_modules', name), join(dest, 'node_modules', name));
}
for (const name of readdirSync('node_modules/@sentropic')) {
  symlinkSync(['h2a', 'h2a-runtime'].includes(name) ? join(dest, 'packages', name) : resolve('node_modules/@sentropic', name), join(dest, 'node_modules/@sentropic', name));
}
for (const path of [
  'h2a-runtime/src/native-host.ts', 'h2a-runtime/src/tmux.ts',
  'h2a/src/runtime/identity/bindings.ts', 'h2a/src/runtime/identity/migration.ts',
  'h2a/src/runtime/local-files/store.ts', 'h2a/src/cli.ts', 'h2a/src/cli-contract.ts'
]) {
  let source = execFileSync('git', ['show', `${ref}:packages/${path}`], { encoding: 'utf8' });
  if (process.argv.includes('--phase-spans')) {
    const measured = path.endsWith('/bindings.ts') ? ['findBinding', 'bindings_lookup']
      : path.endsWith('/migration.ts') ? ['listIdentityAliases', 'aliases_lookup'] : undefined;
    if (measured) {
      const [name, phase] = measured;
      source = source.replace(`export function ${name}(`, `function ${name}Measured(`);
      if (!source.includes('import { getActiveMcpTrace }'))
        source = 'import { getActiveMcpTrace } from "../mcp/phase-trace.js";\n' + source;
      source += `\nexport function ${name}(...args: Parameters<typeof ${name}Measured>): ReturnType<typeof ${name}Measured> {\n  const trace = getActiveMcpTrace();\n  const read = () => ${name}Measured(...args);\n  return trace ? trace.span("${phase}", read) : read();\n}\n`;
    }
  }
  const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  writeFileSync(join(dest, 'packages', path.replace('/src/', '/dist/').replace(/\.ts$/, '.js')), compiled.outputText);
}
writeFileSync(join(dest, 'baseline-ref.txt'), execFileSync('git', ['rev-parse', ref]));
console.log(dest);
