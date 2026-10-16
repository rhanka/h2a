#!/usr/bin/env node
// CI workspace only. Never call release.mjs or change the release versioning path.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { GITHUB_ACTIONS, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = process.env
if (GITHUB_ACTIONS !== 'true' || !/^[1-9]\d*$/.test(GITHUB_RUN_ID ?? '') ||
    !/^[1-9]\d*$/.test(GITHUB_RUN_ATTEMPT ?? '')) {
  throw new Error('rehearsal-version requires GitHub Actions and positive numeric run identifiers')
}

const names = ['track', 'h2a-runtime', 'h2a', 'h2a-cli']
const manifests = names.map((name) => {
  const path = join('packages', name, 'package.json')
  return { path, manifest: JSON.parse(readFileSync(path, 'utf8')) }
})
const base = manifests[0].manifest.version
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(base)) {
  throw new Error(`expected a stable release train, got ${base}`)
}
for (const [i, { manifest }] of manifests.entries()) {
  if (manifest.name !== `@sentropic/${names[i]}` || manifest.version !== base) {
    throw new Error(`published package name/version drift: ${manifest.name}@${manifest.version}`)
  }
}
const version = `${base}-rehearsal.${GITHUB_RUN_ID}.${GITHUB_RUN_ATTEMPT}`
const smokePath = 'scripts/smoke-artifact.mjs'
const smoke = readFileSync(smokePath, 'utf8')
const pin = `const PINNED_RUNTIME_VERSION = '${base}'`
if (smoke.split(pin).length !== 2) throw new Error('smoke pin must match the release train exactly once')

const internal = new Set(manifests.map(({ manifest }) => manifest.name))
for (const { path, manifest } of manifests) {
  manifest.version = version
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      // Exact pins prevent a stable registry version from satisfying the smoke install.
      if (internal.has(name)) manifest[field][name] = version
    }
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
}
// Keep the independent literal proof; only its CI copy changes, never the release smoke.
writeFileSync(smokePath, smoke.replace(pin, `const PINNED_RUNTIME_VERSION = '${version}'`))
console.log(`rehearsal-version: stamped ${names.join(', ')} and smoke pin with ${version}`)
