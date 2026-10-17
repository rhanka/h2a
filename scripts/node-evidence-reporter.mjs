// Node's event stream is execution evidence; stdout text and exit 0 are not.
import { identityPath } from './test-execution-evidence.mjs'

export default async function* reporter(events) {
  const files = new Map()
  const parents = new Map()
  let success = true
  for await (const { type, data } of events) {
    if (type === 'test:summary' && data.success === false) success = false
    if (!data?.file) continue
    const identity = identityPath(data.file)
    if (!files.has(identity)) files.set(identity, { name: identity, status: 'passed', assertionResults: [] })
    if (type === 'test:dequeue') {
      const stack = parents.get(identity) ?? []
      stack[data.nesting] = data.name
      stack.length = data.nesting + 1
      parents.set(identity, stack)
    }
    if (type !== 'test:pass' && type !== 'test:fail') continue
    const file = files.get(identity)
    // Nested tests are included in their parent duration. Sum only roots so
    // suite timing does not double-count describe()/it() trees.
    if (data.nesting === 0 && Number.isFinite(data.details?.duration_ms)) {
      file.durationMs = (file.durationMs ?? 0) + data.details.duration_ms
    }
    if (type === 'test:fail') { file.status = 'failed'; success = false }
    if (data.details?.type === 'suite') continue
    const fullName = [...(parents.get(identity) ?? []).slice(0, data.nesting), data.name].join(' ')
    file.assertionResults.push({ fullName, status: data.todo ? 'todo' : data.skip ? 'skipped' : type === 'test:pass' ? 'passed' : 'failed' })
  }
  const assertions = [...files.values()].flatMap((file) => file.assertionResults)
  const count = (status) => assertions.filter((a) => a.status === status).length
  yield JSON.stringify({ success, numTotalTests: assertions.length, numPassedTests: count('passed'),
    numFailedTests: count('failed'), numPendingTests: count('skipped'), numTodoTests: count('todo'), testResults: [...files.values()] })
}
