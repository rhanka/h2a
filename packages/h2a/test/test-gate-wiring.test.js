/**
 * Cross-guard the declarations that make the excluded gate-runner self-test run.
 *
 * run-test-gates.test.js cannot protect its own CI invocation: deleting that
 * workflow step means the test is never called. This file is deliberately
 * discovered by `npm test`, so it catches a removed, reordered, conditional, or
 * non-blocking direct step. The direct test in turn catches a broken runner and
 * an inert scripts.test command. That is a cross-check, not a claim that npm test
 * can grade the runner that decides npm test's verdict.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DIRECT_SELF_TEST = 'node --test packages/h2a/test/run-test-gates.test.js'
const DIRECT_SELF_TEST_NAME = '- name: Test npm test gate runner directly'
const NPM_TEST = '- run: npm test'

function readRepoFile(...parts) {
  return readFileSync(resolve(REPO_ROOT, ...parts), 'utf8')
}

/** Return a top-level Actions job split into its configuration and steps. */
function workflowJob(workflow, job) {
  const lines = readRepoFile('.github', 'workflows', workflow).split(/\r?\n/)
  const start = lines.findIndex((line) => line === `  ${job}:`)
  assert.notEqual(start, -1, `${workflow} must define the ${job} job`)
  const end = lines.findIndex((line, index) => index > start && /^  [\w-]+:$/.test(line))
  const jobLines = lines.slice(start, end === -1 ? undefined : end)
  const stepsStart = jobLines.findIndex((line) => line.trim() === 'steps:')
  assert.notEqual(stepsStart, -1, `${workflow} ${job} must define steps`)
  return { config: jobLines.slice(1, stepsStart), lines: jobLines, steps: jobLines.slice(stepsStart + 1) }
}

function assertNoFailureBypass(lines, subject) {
  const bypasses = lines
    .map((line) => line.trim())
    .filter((line) => /^(if|continue-on-error):/.test(line))
  assert.deepEqual(
    bypasses,
    [],
    `${subject} must be unconditional and failure-propagating, not bypassed with if/continue-on-error`,
  )
}

function stepContaining(lines, index) {
  let start = index
  while (start > 0 && !lines[start].trim().startsWith('- ')) start -= 1
  assert.ok(lines[start].trim().startsWith('- '), 'the direct invocation must belong to a workflow step')
  let end = index + 1
  while (end < lines.length && !lines[end].trim().startsWith('- ')) end += 1
  return lines.slice(start, end)
}

/** Require one active direct self-test step before npm test in an unbypassable job. */
function assertWorkflowSelfTestWiring(workflow, job) {
  const workflowJobParts = workflowJob(workflow, job)
  const direct = workflowJobParts.lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line === `run: ${DIRECT_SELF_TEST}`)
  const npmTest = workflowJobParts.lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line === NPM_TEST)
  assert.equal(direct.length, 1, `${workflow} ${job} must invoke the direct self-test once`)
  assert.equal(npmTest.length, 1, `${workflow} ${job} must invoke npm test once`)
  assert.ok(
    direct[0].index < npmTest[0].index,
    `${workflow} ${job} must run the direct self-test before npm test`,
  )
  const directStep = stepContaining(workflowJobParts.lines, direct[0].index)
  assert.ok(
    directStep.map((line) => line.trim()).includes(DIRECT_SELF_TEST_NAME),
    `${workflow} ${job} must name the direct self-test step`,
  )
  assertNoFailureBypass(directStep, `${workflow} ${job} direct self-test step`)
  assertNoFailureBypass(workflowJobParts.config, `${workflow} ${job} job`)
}

test('npm test invokes the gate runner, not a string that merely mentions it', () => {
  const manifest = JSON.parse(readRepoFile('package.json'))
  assert.equal(
    manifest.scripts?.test,
    'node scripts/run-test-gates.mjs',
    'scripts.test must execute the gate runner directly',
  )
})

test('ci build-and-test invokes an unconditional direct self-test before npm test', () => {
  assertWorkflowSelfTestWiring('ci.yml', 'build-and-test')
})

test('release verify invokes an unconditional direct self-test before npm test', () => {
  assertWorkflowSelfTestWiring('release.yml', 'verify')
})

test('the local release path invokes the direct self-test before npm test', () => {
  const release = readRepoFile('scripts', 'release.mjs')
  const directSelfTest = /^  runStep\(\n    "Test npm test gate runner directly",\n    "node",\n    \["--test", "packages\/h2a\/test\/run-test-gates\.test\.js"\],\n    \{ dryRun \}\n  \);/m.exec(release)
  const npmTest = /^  runStep\("Tests", "npm", \["test"\], \{ dryRun \}\);/m.exec(release)
  assert.ok(directSelfTest, 'release must actively invoke the direct self-test')
  assert.ok(npmTest, 'release must actively invoke npm test')
  assert.ok(
    directSelfTest.index < npmTest.index,
    'release must run the direct self-test before npm test',
  )
})

test('release publish remains unconditionally blocked on the verified direct self-test job', () => {
  const publish = workflowJob('release.yml', 'publish')
  assert.ok(
    publish.config.map((line) => line.trim()).includes('needs: verify'),
    'publish relies on verify for the direct self-test; do not let it bypass that job',
  )
  assertNoFailureBypass(publish.config, 'release publish job')
})
