#!/usr/bin/env node
// track-trace — record ONE completed unit of work in track in a single call, instead of the
// item-new → realize → accept-criterion → accept-link → accept-run bash dance (repeated by hand
// otherwise). Committed so it runs as stable tooling. Wraps the track CLI; reimplements nothing.
//
// Usage:
//   node scripts/track-trace.mjs --title <t> --commit <sha> [--kind feature|bug|chore]
//        [--role workpackage|spec-phase|stream] [--workspace <ws>] [--parent <itemId>]
//        [--body <text>] [--statement <text>] [--result pass|fail]
//   npm run trace -- --title "Foo" --commit abc1234 --statement "tests green"
//
// Does: item new → realize in-progress → realize done → accept criterion → accept link (manual)
//       → accept run <result> --commit <sha>. Prints the new item id on stdout.
//
// --workspace defaults to `track workspace-id` for the repo root (override for a specific ws).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join(REPO, 'packages', 'track', 'dist', 'cli', 'bin.js')

/**
 * The workspace to trace into: match the repo's EXISTING convention (the last `item.created`'s
 * workspace in the track log — which may be a canonical/imported id ≠ the path-derived
 * `workspace-id`), else fall back to `workspace-id`. Keeps new traces in the same bucket as the
 * repo's existing items.
 */
function defaultWorkspace() {
  try {
    const lines = readFileSync(path.join(REPO, '.track', 'events.jsonl'), 'utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i].trim()
      if (!l) continue
      try {
        const e = JSON.parse(l)
        if (e.type === 'item.created' && e.payload?.workspace) return e.payload.workspace
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no log */
  }
  return track(['workspace-id', '--cwd', REPO]).trim()
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => argv[++i]
    if (a === '--title') out.title = val()
    else if (a === '--commit') out.commit = val()
    else if (a === '--kind') out.kind = val()
    else if (a === '--role') out.role = val()
    else if (a === '--workspace') out.workspace = val()
    else if (a === '--parent') out.parent = val()
    else if (a === '--body') out.body = val()
    else if (a === '--statement') out.statement = val()
    else if (a === '--result') out.result = val()
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`unknown arg: ${a}`)
  }
  return out
}

const track = (args) => execFileSync('node', [BIN, ...args], { cwd: REPO, encoding: 'utf8' })
const firstId = (s) => (s.match(/01[0-9A-HJKMNP-TV-Z]{24}/) ?? [])[0]

const HELP = `track-trace — record one completed unit of work in track.
Usage: node scripts/track-trace.mjs --title <t> --commit <sha> [--kind <k>] [--role <r>] [--workspace <ws>] [--parent <id>] [--body <b>] [--statement <s>] [--result pass|fail]`

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (a.help || !a.title || !a.commit) {
    process.stdout.write(HELP + '\n')
    process.exit(a.help ? 0 : 2)
  }
  const kind = a.kind ?? 'feature'
  const result = a.result ?? 'pass'
  const workspace = a.workspace ?? defaultWorkspace()
  if (!workspace) throw new Error('no --workspace and none resolvable from the track log')

  const newArgs = ['item', 'new', '--kind', kind, '--title', a.title, '--workspace', workspace]
  if (a.role) newArgs.push('--role', a.role)
  if (a.parent) newArgs.push('--parent', a.parent)
  if (a.body) newArgs.push('--body', a.body)
  const id = firstId(track(newArgs))
  if (!id) throw new Error('item new did not return an id')

  track(['item', 'realize', id, 'in-progress'])
  track(['item', 'realize', id, 'done'])

  const statement = a.statement ?? `traced complete @ ${a.commit}`
  const critId = firstId(track(['accept', 'criterion', id, '--statement', statement]))
  if (!critId) throw new Error('accept criterion did not return an id')
  const evId = firstId(track(['accept', 'link', critId, '--kind', 'manual', '--locator', `commit ${a.commit}`]))
  if (!evId) throw new Error('accept link did not return an id')
  track(['accept', 'run', evId, '--result', result, '--commit', a.commit])

  process.stderr.write(`track-trace: ${id} done + acceptance ${result} @${a.commit}\n`)
  process.stdout.write(id + '\n')
}

try {
  main()
} catch (e) {
  process.stderr.write(`track-trace: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}
