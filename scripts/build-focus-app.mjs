#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  FOCUS_ARTIFACT_DIR,
  FOCUS_BUILD_DIR,
  FOCUS_ROOT,
  REPO_ROOT,
  expectedFocusManifest,
  focusClientVersion,
  validateFocusArtifact,
} from './focus-app-artifact-lib.mjs'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const clientVersion = focusClientVersion()
const build = spawnSync(npm, ['run', 'build'], {
  cwd: FOCUS_ROOT,
  encoding: 'utf8',
  stdio: 'inherit',
  env: { ...process.env, FOCUS_BUILD_VERSION: clientVersion },
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

const staging = join(REPO_ROOT, 'packages', 'h2a', '.focus-app.staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
cpSync(FOCUS_BUILD_DIR, staging, { recursive: true })
writeFileSync(join(staging, 'h2a-focus.json'), `${JSON.stringify(expectedFocusManifest(staging), null, 2)}\n`, 'utf8')
rmSync(FOCUS_ARTIFACT_DIR, { recursive: true, force: true })
renameSync(staging, FOCUS_ARTIFACT_DIR)

const { errors } = validateFocusArtifact()
if (errors.length > 0) {
  process.stderr.write(`Focus artifact validation failed after build:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`Packaged Focus production build in packages/h2a/focus-app\n`)
