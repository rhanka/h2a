import ts from 'typescript'

export function assertTestConfig(config, kind) {
  const keys = kind === 'runtime' ? ['include', 'setupFiles', 'environment', 'reporters'] : ['include', 'setupFiles', 'environment']
  if (!config.test || Object.keys(config.test).some((key) => !keys.includes(key))) {
    throw new Error('unqualified Vitest option: test execution or unhandled errors can be suppressed')
  }
  return config
}

// Configs are deliberately small data objects. Extra effective options,
// spreads, hooks, plugins, projects and alternate roots change the contract.
export function configContractFailures(source, kind) {
  const ast = ts.createSourceFile('config.ts', source, ts.ScriptTarget.Latest, true)
  const failures = []
  const statement = ast.statements.find(ts.isExportAssignment)
  const call = statement?.expression
  if (!call || !ts.isCallExpression(call) || call.expression.getText(ast) !== 'defineConfig' || call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) return ['config must export defineConfig with one literal data object']
  function object(node, keys, label) {
    if (!node || !ts.isObjectLiteralExpression(node)) { failures.push(`${label}: not a data object`); return {} }
    const entries = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) { failures.push(`${label}: executable or spread property`); continue }
      const key = property.name.getText(ast).replace(/^["']|["']$/g, '')
      if (Object.hasOwn(entries, key)) failures.push(`${label}: duplicate ${key}`)
      entries[key] = property.initializer
    }
    if (JSON.stringify(Object.keys(entries).sort()) !== JSON.stringify([...keys].sort())) failures.push(`${label}: effective keys differ from the execution contract`)
    return entries
  }
  const config = object(call.arguments[0], kind === 'runtime' ? ['root', 'test'] : ['test'], 'config')
  const test = object(config.test, kind === 'runtime' ? ['include', 'setupFiles', 'environment', 'reporters'] : ['include', 'setupFiles', 'environment'], 'test')
  const strings = (node) => node && ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteralLike) ? node.elements.map((value) => value.text) : null
  if (JSON.stringify(strings(test.include)) !== JSON.stringify(['src/**/*.test.ts'])) failures.push('include must discover every source suite')
  const setup = kind === 'runtime' ? './vitest.native-isolation.mjs' : '../h2a-runtime/vitest.native-isolation.mjs'
  if (JSON.stringify(strings(test.setupFiles)) !== JSON.stringify([setup])) failures.push('isolation setup changed')
  if (!test.environment || !ts.isStringLiteralLike(test.environment) || test.environment.text !== 'node') failures.push('environment must be node')
  if (kind === 'runtime') {
    const printer = ts.createPrinter({ removeComments: true })
    const text = (node) => node ? printer.printNode(ts.EmitHint.Expression, node, ast).replace(/\s+/g, '').replace(/'/g, '"') : ''
    if (text(config.root) !== 'fileURLToPath(newURL(".",import.meta.url))') failures.push('root must be anchored to the config')
    if (text(test.reporters) !== '["default",["json",{outputFile:process.env.H2A_TEST_REPORT_PATH??fileURLToPath(newURL("../../tmp/h2a-runtime-vitest-report.json",import.meta.url))}],]') failures.push('reporters must write current invocation evidence')
  }
  return failures
}
