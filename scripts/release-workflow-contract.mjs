import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

export function executionPlan(workflow) {
  // Names and standalone comments describe steps. All executable fields,
  // contexts, action inputs, job edges and ordering are part of the plan.
  const clone = structuredClone(workflow.jobs)
  for (const job of Object.values(clone)) for (const step of job.steps ?? []) {
    delete step.name
    if (step.run) step.run = step.run.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  }
  return clone
}

export function releaseContractFailures(workflow, contract = JSON.parse(readFileSync(new URL('./release-execution-plan.json', import.meta.url), 'utf8'))) {
  const failures = []
  // A closed execution plan prevents unqualified steps from changing the
  // shell, tree, Node, artifacts or publication routes between validated roles.
  if (Object.keys(workflow).some((key) => !['name', 'on', 'concurrency', 'permissions', 'jobs'].includes(key))) failures.push('unqualified workflow context')
  const actual = executionPlan(workflow)
  if (!isDeepStrictEqual(actual, contract)) {
    for (const id of new Set([...Object.keys(actual), ...Object.keys(contract)])) {
      if (!isDeepStrictEqual(actual[id], contract[id])) failures.push(`${id}: execution plan/context/order differs from the qualified release contract`)
    }
  }
  return failures
}
