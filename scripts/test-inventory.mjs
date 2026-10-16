import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { identityPath, readTrainRequirements } from './test-execution-evidence.mjs'

// Parse declarations, not comments, string examples, or skip markers. The
// checked-in inventory is the requirement; this parser never rewrites it.
export function declaredTests(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const tests = []
  function callKind(node) {
    let expression = node.expression
    while (ts.isCallExpression(expression)) expression = expression.expression
    while (ts.isPropertyAccessExpression(expression)) expression = expression.expression
    return ts.isIdentifier(expression) ? expression.text : ''
  }
  function visit(node, parents) {
    if (ts.isCallExpression(node)) {
      const kind = callKind(node)
      const arg = node.arguments[0]
      if (['describe', 'suite', 'test', 'it'].includes(kind) && arg && ts.isStringLiteralLike(arg)) {
        const names = [...parents, arg.text]
        if (kind === 'test' || kind === 'it') tests.push({ fullName: names.join(' '), expression: node.expression.getText(ast) })
        else {
          for (const child of node.arguments.slice(1)) visit(child, names)
          return
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, parents))
  }
  visit(ast, [])
  return tests
}

export function readDeclaredNonTests(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/test-non-tests-0986.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.release !== '0.98.6' || !Array.isArray(manifest.entries)) {
    throw new Error('invalid RC 0.98.6 declared non-test manifest version')
  }
  const identities = new Set()
  for (const entry of manifest.entries) {
    if (typeof entry.file !== 'string' || !/^(?:packages\/h2a\/test\/[^/*]+\.test\.js|packages\/h2a-runtime\/src\/(?:[\w-]+\/)*[\w-]+\.test\.ts)$/.test(entry.file)
      || typeof entry.fullName !== 'string' || !entry.fullName.trim()
      || !['skipped', 'todo'].includes(entry.status) || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error('invalid RC 0.98.6 declared non-test identity, status or reason')
    }
    const identity = entry.file + ' :: ' + entry.fullName
    if (identities.has(identity)) throw new Error(`duplicate declared non-test: ${identity}`)
    identities.add(identity)
  }
  return manifest.entries
}

export function policyFor(root, inventory, scope) {
  return {
    requiredTests: Object.fromEntries(Object.entries(inventory).map(([file, names]) => [identityPath(join(root, file)), names])),
    requiredTitles: readTrainRequirements(root).titles.filter((entry) => scope === undefined || entry.scope === scope).map((entry) => entry.anyOf),
    // Existing nonnormative, explicitly tracked debt. Each exception names
    // one assertion and status; no source marker can grant an exception.
    allowedSkips: JSON.parse(readFileSync(join(root, 'scripts/test-skip-exceptions.json'), 'utf8'))
      .map((entry) => ({ ...entry, file: join(root, entry.file) })),
    // Owner decision for this RC only. These are declarations, not coverage;
    // the execution proof must also detect activation or disappearance.
    declaredNonTests: readDeclaredNonTests(root)
      .filter(entry => scope === undefined || (scope === 'runtime') === entry.file.startsWith('packages/h2a-runtime/'))
      .map((entry) => ({ ...entry, file: join(root, entry.file) })),
  }
}

export function declarationFailures(root, inventory) {
  const failures = []
  const registered = []
  for (const [file, names] of Object.entries(inventory)) {
    let declared
    try { declared = new Set(declaredTests(readFileSync(join(root, file), 'utf8'), file).map((test) => test.fullName)); registered.push(...declared) }
    catch { failures.push(`${file}: normative suite unavailable`); continue }
    for (const name of names) if (!declared.has(name)) failures.push(`${file} :: ${name}: normative test not declared`)
  }
  for (const entry of readTrainRequirements(root).titles) {
    const titles = entry.anyOf
    if (!titles.some((title) => registered.some((name) => name === title || name.endsWith(' ' + title)))) failures.push(`${titles.join(' / ')}: normative scenario not declared`)
  }
  return failures
}
