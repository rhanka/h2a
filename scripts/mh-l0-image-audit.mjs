import ts from 'typescript';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { builtinModules } from 'node:module';
import { safeRelative } from '../packages/h2a/src/runtime/handover/formats.js';

// Build-time literal-edge audit, not an executable closure certificate.
// Bundles/load traces must bound indirect loaders; this is not in the shim.
export async function auditModuleGraph(root, manifest) {
  const files = new Map(manifest.files.map(f => [f.path, f])); const edges = [];
  const builtin = new Set(builtinModules.map(s => s.replace(/^node:/, '')));
  const edge = (from, specifier) => {
    if (specifier.startsWith('node:') && builtin.has(specifier.slice(5))) return;
    if (!specifier.startsWith('.')) throw new Error(`image_external_module:${from}:${specifier}`);
    const path = join(dirname(join(root, from)), specifier);
    const target = relative(root, path);
    if (!safeRelative(target)) throw new Error('image_dependency_outside');
    if (!files.has(target)) throw new Error(`image_dependency_missing:${from}:${target}`);
    if (!safeRelative(relative(root, realpathSync(path)))) throw new Error('image_dependency_outside');
    edges.push({ from, target });
  };
  for (const file of manifest.files) {
    if (file.type !== 'file' || !/\.(?:mjs|cjs|js)$/.test(file.path)) continue;
    const tree = ts.createSourceFile(file.path, readFileSync(join(root, file.path), 'utf8'), ts.ScriptTarget.Latest, true);
    if (tree.parseDiagnostics.length) throw new Error('image_invalid_javascript');
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error('image_dynamic_resolution');
        edge(file.path, node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error('image_dynamic_resolution');
        edge(file.path, node.arguments[0].text);
      }
      if (ts.isIdentifier(node) && ['eval', 'createRequire'].includes(node.text)) throw new Error('image_dynamic_resolution');
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
        if (!node.arguments || node.arguments.length !== 2 || !ts.isStringLiteral(node.arguments[0]) ||
            node.arguments[1].getText(tree) !== 'import.meta.url') throw new Error('image_dynamic_resolution');
        edge(file.path, node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return { schemaVersion: 1, edges, external: [], qualification: 'static-literal-graph-only' };
}
