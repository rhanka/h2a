#!/usr/bin/env node
// Keep npm from combining a published core with incompatible newer siblings.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOCKSTEP_PACKAGES = ['h2a', 'h2a-cli', 'h2a-runtime', 'track'];

export function checkLockstepVersions(root) {
  const packages = LOCKSTEP_PACKAGES.map(name => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')));
  const versions = Object.fromEntries(packages.map(pkg => [pkg.name, pkg.version]));
  const expected = packages[0].version;
  for (const [index, pkg] of packages.entries()) {
    if (pkg.name !== '@sentropic/' + LOCKSTEP_PACKAGES[index] || pkg.version !== expected) {
      throw new Error(`Lockstep package ${LOCKSTEP_PACKAGES[index]} must be @sentropic/${LOCKSTEP_PACKAGES[index]}@${expected}`);
    }
  }
  for (const pkg of packages) {
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const [dep, requirement] of Object.entries(pkg[field] ?? {})) {
        if (Object.hasOwn(versions, dep) && requirement !== versions[dep]) {
          throw new Error(`${pkg.name} ${field}.${dep} must be exactly ${versions[dep]}, got ${requirement}`);
        }
      }
    }
  }
  return expected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Exact lockstep packages verified: ${checkLockstepVersions(process.cwd())}`);
}
