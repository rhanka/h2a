import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const native = 'packages/h2a-runtime/src/';
export const heritageRoots = ['native-terminal/supervisor.ts', 'native-terminal/process.ts',
  'native-terminal/journal.ts', 'native-terminal/op.ts', 'launch-guard.ts', 'pty.ts',
  'index.ts', 'status-projection.ts']
  .map(p => native + p).concat('packages/h2a/src/runtime/drive/pty-actuator.ts');
const packageEntries = { '@sentropic/h2a-runtime': `${native}index.ts`,
  '@sentropic/h2a': 'packages/h2a/src/index.ts', '@sentropic/h2a-runtime/status': `${native}status-projection.ts` };

export function auditHeritage(reference) {
  const ref = execFileSync('git', ['rev-parse', '--verify', `${reference}^{commit}`], { encoding: 'utf8' }).trim();
  const paths = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { encoding: 'utf8' }).trim().split('\n'));
  const source = (path) => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 2 ** 24 });
  const seen = new Set(); const files = []; const externalDependencies = []; const unresolved = [];
  const external = new Set();
  const walk = (path) => {
    if (seen.has(path)) return; seen.add(path);
    if (!paths.has(path)) throw new Error(`heritage_source_missing:${path}`);
    const content = source(path);
    files.push({ source: path, emitted: path.replace('/src/', '/dist/').replace(/\.ts$/, '.js'),
      sourceDigest: `sha256:${createHash('sha256').update(content).digest('hex')}` });
    const tree = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const edge = (specifier) => {
      if (specifier.startsWith('node:')) return;
      if (specifier.startsWith('.')) {
        const resolved = posix.normalize(posix.join(posix.dirname(path), specifier));
        const candidates = [resolved.replace(/\.js$/, '.ts'), resolved];
        const target = candidates.find(p => paths.has(p));
        if (target) walk(target); else unresolved.push({ source: path, specifier, kind: 'relative-edge-missing' });
      } else if (packageEntries[specifier]) walk(packageEntries[specifier]);
      else if (!external.has(specifier)) { external.add(specifier); externalDependencies.push({ specifier, firstSource: path }); }
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const binding = node.importClause?.namedBindings;
        const onlyTypes = !node.importClause?.name && binding && ts.isNamedImports(binding) &&
          binding.elements.length > 0 && binding.elements.every(e => e.isTypeOnly);
        if (!onlyTypes) edge(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) edge(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) edge(node.arguments[0].text);
        else unresolved.push({ source: path, line: tree.getLineAndCharacterOfPosition(node.pos).line + 1, kind: 'dynamic-load' });
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' &&
          node.arguments?.length === 2 && ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[1].getText(tree) === 'import.meta.url') {
        const specifier = node.arguments[0].text;
        if (/\.(?:js|ts)$/.test(specifier)) edge(specifier);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  };
  heritageRoots.forEach(walk);
  const installer = source('packages/h2a/src/runtime/upgrade/index.ts');
  if (!installer.includes('join(stagingPkgDir, "node_modules", "node-pty")')) throw new Error('legacy_probe_changed');
  const sort = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en');
  return { schemaVersion: 1, ref, roots: heritageRoots, files: files.sort((a, b) => a.source.localeCompare(b.source, 'en')),
    externalDependencies: externalDependencies.sort(sort), unresolved: unresolved.sort(sort),
    legacyNativeProbe: '<stagedPkgDir>/node_modules/node-pty',
    additionalPinnedResources: ['node-pty/lib/**', 'node-pty/build/Release/pty.node', 'node-addon-api provenance',
      'runtime/package.json (version diagnostic)', 'fixed system bash/setpriv per qualified profile'],
    finalDistQualification: 'blocked-until-final-0.98.6-dist' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(auditHeritage(process.argv[2]), null, 2) + '\n');
}
