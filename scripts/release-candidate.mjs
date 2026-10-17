#!/usr/bin/env node
// CI-only release preparation and promotion proof. No registry writes here.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { checkLockstepVersions } from './check-lockstep-versions.mjs'

const names = ['track', 'h2a-runtime', 'h2a', 'h2a-cli']
const triple = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)'
const tag = process.env.BACKFILL_VERSION ? `v${process.env.BACKFILL_VERSION}` : process.env.GITHUB_REF?.replace(/^refs\/tags\//, '')
if (process.env.GITHUB_ACTIONS !== 'true' || !new RegExp(`^v${triple}(-rc\\.(0|[1-9]\\d*))?$`).test(tag ?? '')) {
  throw new Error('release-candidate requires GitHub Actions and a vX.Y.Z or vX.Y.Z-rc.N tag')
}
const version = tag.slice(1), base = version.split('-')[0], rc = version !== base
const command = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
const tree = () => command('git', ['rev-parse', 'HEAD^{tree}'])
const repository = process.env.GITHUB_REPOSITORY
// Focus joins the release wave, but keeps its own stable version in Git.
const focusPath = 'packages/focus/package.json'
const focus = JSON.parse(readFileSync(focusPath, 'utf8'))
if (focus.name !== '@sentropic/focus' || !new RegExp(`^${triple}(-rc\\.(0|[1-9]\\d*))?$`).test(focus.version)) {
  throw new Error('focus must have its own valid release version')
}
const focusBase = focus.version.split('-')[0]
const packageVersions = releaseVersion => ({
  ...Object.fromEntries(names.map(name => ['@sentropic/' + name, releaseVersion])),
  '@sentropic/focus': focusBase + releaseVersion.slice(releaseVersion.split('-')[0].length),
})
const packages = packageVersions(version)

function prepare() {
  if (checkLockstepVersions(process.cwd()) !== base) throw new Error('tag base must match the stable lockstep release train')
  const smokePath = 'scripts/smoke-artifact.mjs'
  const smoke = readFileSync(smokePath, 'utf8'), pin = `const PINNED_RUNTIME_VERSION = '${base}'`
  if (smoke.split(pin).length !== 2) throw new Error('smoke pin must match the release train exactly once')
  if (focus.version !== focusBase) throw new Error('focus must keep its stable version in the source checkout')
  if (rc) {
    for (const name of [...names, 'focus']) {
      const path = join('packages', name, 'package.json'), manifest = JSON.parse(readFileSync(path, 'utf8'))
      manifest.version = packages[manifest.name]
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
        for (const dep of Object.keys(manifest[field] ?? {})) if (Object.hasOwn(packages, dep)) manifest[field][dep] = packages[dep]
      }
      writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
    }
    writeFileSync(smokePath, smoke.replace(pin, `const PINNED_RUNTIME_VERSION = '${version}'`))
  }
  appendFileSync(process.env.GITHUB_ENV, `RELEASE_VERSION=${version}\nRELEASE_TAG=${tag}\n`)
  console.log(`Prepared ${version}; registry tag: ${rc ? 'next' : 'latest/backfill'}`)
}

function context() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') ||
      !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? '') ||
      !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')) throw new Error('missing CI repository/run identity')
}

function attest() {
  context()
  if (rc) {
    if (process.env.RC_SMOKE_PASSED !== 'true') throw new Error('RC post-publish install smoke must actually pass before attestation')
    for (const [name, packageVersion] of Object.entries(packages)) {
      if (JSON.parse(command('npm', ['view', name, 'dist-tags.next', '--json'])) !== packageVersion) {
        throw new Error(`${name}: next must point to ${packageVersion} before attestation`)
      }
      // An idempotent skip must not certify bytes published from another tree.
      const bytes = readFileSync(join('dist-tarballs', `sentropic-${name.slice('@sentropic/'.length)}-${packageVersion}.tgz`))
      const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
      if (JSON.parse(command('npm', ['view', `${name}@${packageVersion}`, 'dist.integrity', '--json'])) !== integrity) {
        throw new Error(`${name}: registry integrity differs from the verify-built RC tarball`)
      }
    }
  }
  const record = { schema: 1, kind: rc ? 'rc' : 'stable', repository,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    version, sourceSha: command('git', ['rev-parse', 'HEAD']), sourceTree: tree(),
    registryTag: rc ? 'next' : 'latest/backfill', smokePassed: process.env.RC_SMOKE_PASSED === 'true', packages }
  mkdirSync('release-attestation', { recursive: true })
  writeFileSync('release-attestation/attestation.json', JSON.stringify(record, null, 2) + '\n')
  console.log(`Recorded ${record.kind} attestation for run ${record.runId}, tree ${record.sourceTree}`)
}

function requireRc() {
  if (rc) { console.log('RC publication does not require an earlier candidate'); return }
  context()
  const sourceTree = tree()
  // Repository-scoped workflow API, not caller-supplied files or PR artifacts.
  // Paginate so an unrelated later release cannot hide a still-valid proof.
  const api = path => JSON.parse(command('gh', ['api', path]))
  const pages = path => JSON.parse(command('gh', ['api', '--paginate', '--slurp', path]))
  const runs = pages(`repos/${repository}/actions/workflows/release.yml/runs?event=push&status=success&per_page=100`).flatMap(page => page.workflow_runs)
  for (const run of runs) {
    const candidate = run.head_branch?.replace(/^v/, '')
    if (run.event !== 'push' || run.status !== 'completed' || run.conclusion !== 'success' ||
        run.path !== '.github/workflows/release.yml' || run.head_repository?.full_name !== repository ||
        run.head_branch !== `v${candidate}` ||
        !new RegExp(`^${base.replaceAll('.', '\\.')}\\-rc\\.(0|[1-9]\\d*)$`).test(candidate ?? '') ||
        !/^[1-9]\d*$/.test(String(run.id)) || !/^[1-9]\d*$/.test(String(run.run_attempt)) ||
        !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')) continue
    const artifacts = pages(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`).flatMap(page => page.artifacts)
      .filter(artifact => artifact.name === `release-attestation-${run.run_attempt}` && artifact.expired === false &&
        artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === run.head_sha)
    if (artifacts.length !== 1) continue
    const dir = mkdtempSync(join(tmpdir(), 'release-rc-proof-'))
    try {
      command('gh', ['run', 'download', String(run.id), '--repo', repository,
        '--name', artifacts[0].name, '--dir', dir])
      const record = JSON.parse(readFileSync(join(dir, 'attestation.json'), 'utf8'))
      const expected = { schema: 1, kind: 'rc', repository, runId: String(run.id), runAttempt: String(run.run_attempt),
        version: candidate, sourceSha: run.head_sha, sourceTree, registryTag: 'next', smokePassed: true,
        packages: packageVersions(candidate) }
      if (!isDeepStrictEqual(record, expected)) continue
      // Check the source digest against GitHub's Git object, not just the assertion.
      if (api(`repos/${repository}/git/commits/${run.head_sha}`).tree?.sha !== sourceTree) continue
      console.log(`Accepted RC run ${run.id}: ${candidate}, source tree ${sourceTree}`)
      return
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  throw new Error(`No successful RC attestation for ${base} with source tree ${sourceTree}; refusing stable publication (including backfills)`)
}

switch (process.argv[2]) {
  case 'prepare': prepare(); break
  case 'attest': attest(); break
  case 'require-rc': requireRc(); break
  default: throw new Error('expected prepare, require-rc or attest')
}
