#!/usr/bin/env node

import { validateFocusArtifact } from './focus-app-artifact-lib.mjs'

const { errors, expected } = validateFocusArtifact()
if (errors.length > 0) {
  process.stderr.write(`Focus packaged artifact is not publishable:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`)
  process.stderr.write('  fix: npm ci --prefix apps/focus && npm run build:focus-app\n')
  process.exit(1)
}
process.stdout.write(`Focus packaged artifact OK (${expected.sourceHash})\n`)
