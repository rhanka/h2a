import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = resolve(HERE, '..')
export const FOCUS_ROOT = join(REPO_ROOT, 'apps', 'focus')
export const FOCUS_BUILD_DIR = join(FOCUS_ROOT, 'build')
export const FOCUS_ARTIFACT_DIR = join(REPO_ROOT, 'packages', 'h2a', 'focus-app')
export const FOCUS_MANIFEST_FILE = join(FOCUS_ARTIFACT_DIR, 'h2a-focus.json')
export const FOCUS_ARTIFACT_SCHEMA_VERSION = 1

const SOURCE_INPUTS = [
  'package.json',
  'package-lock.json',
  'svelte.config.js',
  'tsconfig.json',
  'vite.config.ts',
  'src',
]

function walkFiles(path) {
  if (!existsSync(path)) throw new Error(`Focus build input is missing: ${path}`)
  if (statSync(path).isFile()) return [path]
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => walkFiles(join(path, entry.name)))
}

export function focusSourceHash() {
  const hash = createHash('sha256')
  const files = SOURCE_INPUTS.flatMap((input) => walkFiles(join(FOCUS_ROOT, input)))
    .sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    const rel = relative(FOCUS_ROOT, file).split(sep).join('/')
    hash.update(rel)
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

export function focusClientVersion(sourceHash = focusSourceHash()) {
  return `h2a-focus-${sourceHash.slice('sha256:'.length, 'sha256:'.length + 16)}`
}

export function focusArtifactFiles(artifactRoot = FOCUS_ARTIFACT_DIR) {
  if (!existsSync(artifactRoot)) return {}
  return Object.fromEntries(
    walkFiles(artifactRoot)
      .filter((file) => relative(artifactRoot, file).split(sep).join('/') !== 'h2a-focus.json')
      .sort((a, b) => a.localeCompare(b))
      .map((file) => {
        const rel = relative(artifactRoot, file).split(sep).join('/')
        return [rel, `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`]
      }),
  )
}

export function expectedFocusManifest(artifactRoot = FOCUS_ARTIFACT_DIR) {
  const sourceHash = focusSourceHash()
  return {
    kind: 'sentropic.h2a.focus-app',
    schemaVersion: FOCUS_ARTIFACT_SCHEMA_VERSION,
    adapter: '@sveltejs/adapter-node',
    handler: 'handler.js',
    sourceHash,
    clientVersion: focusClientVersion(sourceHash),
    externalDependencies: ['@sentropic/track'],
    files: focusArtifactFiles(artifactRoot),
  }
}

const REQUIRED_ARTIFACT_PATHS = [
  'handler.js',
  'client/_app/version.json',
  'server',
]

function bareImports(file) {
  const source = readFileSync(file, 'utf8')
  const imports = new Set()
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const add = (specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:')) {
      imports.add(specifier)
    }
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imports
}

export function validateFocusArtifact() {
  const errors = []
  let manifest
  try {
    manifest = JSON.parse(readFileSync(FOCUS_MANIFEST_FILE, 'utf8'))
  } catch (error) {
    errors.push(`manifest missing or invalid (${error instanceof Error ? error.message : String(error)})`)
  }

  const expected = expectedFocusManifest()
  if (manifest && JSON.stringify(manifest) !== JSON.stringify(expected)) {
    errors.push(
      `manifest is stale, incomplete, or incompatible (expected sourceHash ${expected.sourceHash}, got ${manifest.sourceHash ?? 'none'})`,
    )
  }

  for (const required of REQUIRED_ARTIFACT_PATHS) {
    if (!existsSync(join(FOCUS_ARTIFACT_DIR, required))) errors.push(`required artifact path missing: ${required}`)
  }

  try {
    const clientVersion = JSON.parse(readFileSync(join(FOCUS_ARTIFACT_DIR, 'client', '_app', 'version.json'), 'utf8'))
    if (clientVersion.version !== expected.clientVersion) {
      errors.push(`client version is incompatible (expected ${expected.clientVersion}, got ${String(clientVersion.version)})`)
    }
  } catch (error) {
    errors.push(`client version missing or invalid (${error instanceof Error ? error.message : String(error)})`)
  }

  if (existsSync(FOCUS_ARTIFACT_DIR)) {
    const jsFiles = walkFiles(FOCUS_ARTIFACT_DIR).filter((file) => file.endsWith('.js'))
    const externals = new Set(jsFiles.flatMap((file) => [...bareImports(file)]))
    const declared = new Set(expected.externalDependencies)
    for (const dependency of externals) {
      if (!declared.has(dependency)) errors.push(`undeclared generated runtime dependency: ${dependency}`)
    }
    for (const dependency of declared) {
      const marker = JSON.stringify(dependency)
      const used = jsFiles.some((file) => readFileSync(file, 'utf8').includes(marker))
      if (!used) errors.push(`manifest runtime dependency is not used by the artifact: ${dependency}`)
    }
  }

  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'h2a', 'package.json'), 'utf8'))
  if (!packageJson.files?.includes('focus-app')) errors.push('@sentropic/h2a files does not include focus-app')
  for (const dependency of expected.externalDependencies) {
    if (!packageJson.dependencies?.[dependency]) {
      errors.push(`@sentropic/h2a does not declare generated runtime dependency ${dependency}`)
    }
  }

  return { errors, expected, manifest }
}
