import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkLockstepVersions } from '../../../scripts/check-lockstep-versions.mjs'

const script = fileURLToPath(new URL('../../../scripts/rehearsal-version.mjs', import.meta.url))
const packages = ['track', 'h2a-runtime', 'h2a', 'h2a-cli', 'focus']

function fixture(t, version = '0.98.6') {
  const root = mkdtempSync(join(tmpdir(), 'rehearsal-version-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const pkg of packages) {
    mkdirSync(join(root, 'packages', pkg), { recursive: true })
    writeFileSync(join(root, 'packages', pkg, 'package.json'), JSON.stringify({
      name: `@sentropic/${pkg}`, version: pkg === 'focus' ? '0.5.0' : version,
      dependencies: { '@sentropic/track': `^${version}`, external: '^1.2.3' },
      peerDependencies: { '@sentropic/h2a-runtime': `^${version}` },
      optionalDependencies: { '@sentropic/h2a-cli': `^${version}` },
      devDependencies: { '@sentropic/h2a': `^${version}` },
    }))
  }
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'run'))
  writeFileSync(join(root, 'scripts/smoke-artifact.mjs'), `const PINNED_RUNTIME_VERSION = '${version}'\n`)
  const run = (overrides = {}) => spawnSync(process.execPath, [script], {
    cwd: root, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: root, XDG_RUNTIME_DIR: join(root, 'run'),
      GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '38901487200', GITHUB_RUN_ATTEMPT: '2', ...overrides },
  })
  return { root, run }
}

test('stamps every published manifest, internal pin and the independent smoke literal', (t) => {
  const { root, run } = fixture(t)
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  const expected = '0.98.6-rehearsal.38901487200.2'
  assert.equal(checkLockstepVersions(root), expected)
  for (const pkg of packages) {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json')))
    assert.equal(manifest.version, pkg === 'focus' ? '0.5.0-rehearsal.38901487200.2' : expected)
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
      for (const [name, value] of Object.entries(manifest[field])) {
        assert.equal(value, name === 'external' ? '^1.2.3' : expected)
      }
    }
  }
  assert.equal(readFileSync(join(root, 'scripts/smoke-artifact.mjs'), 'utf8'),
    `const PINNED_RUNTIME_VERSION = '${expected}'\n`)
})

test('different CI runs and attempts stamp different versions, including future release trains', (t) => {
  const results = [
    ['1', '1', '1.23.45-rehearsal.1.1'],
    ['1', '2', '1.23.45-rehearsal.1.2'],
    ['2', '1', '1.23.45-rehearsal.2.1'],
  ]
  for (const [id, attempt, expected] of results) {
    const { root, run } = fixture(t, '1.23.45')
    const result = run({ GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(readFileSync(join(root, 'packages/track/package.json'))).version, expected)
  }
})

test('refuses non-CI invocations or invalid run identifiers without writing', (t) => {
  for (const overrides of [{ GITHUB_ACTIONS: '' }, { GITHUB_RUN_ID: '' },
    { GITHUB_RUN_ID: '01' }, { GITHUB_RUN_ATTEMPT: 'nope' }]) {
    const { root, run } = fixture(t)
    const before = readFileSync(join(root, 'packages/track/package.json'), 'utf8')
    const result = run(overrides)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /requires GitHub Actions and positive numeric run identifiers/)
    assert.equal(readFileSync(join(root, 'packages/track/package.json'), 'utf8'), before)
  }
})

test('refuses drift in package versions or the smoke pin before writing any manifest', (t) => {
  for (const target of ['packages/h2a-cli/package.json', 'scripts/smoke-artifact.mjs']) {
    const { root, run } = fixture(t)
    const path = join(root, target)
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('0.98.6', '0.98.5'))
    const before = readFileSync(join(root, 'packages/track/package.json'), 'utf8')
    const result = run()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /version drift|smoke pin/)
    assert.equal(readFileSync(join(root, 'packages/track/package.json'), 'utf8'), before)
  }
})
