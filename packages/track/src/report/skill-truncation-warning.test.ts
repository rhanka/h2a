import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli, type CliIO } from '../cli/index.js'

// An independent review leg found that `--width <n>` reaches the same compact renderer as
// `--inline` — at EVERY width it drops HORS ROLLUP and ACTIONS DÉRIVÉES, collapses a tail into
// "+N autres", and prints its own deterministic PRÉCO block. The skill warned about `--inline`
// only, while its honesty rules promised, without qualification, that every row appears. A cold
// agent typing `--width 200` therefore got a truncated report under a promise of completeness.
//
// The fix is a skill edit, so the guarantee is only as strong as this test: without it, the
// warning is a sentence someone can delete without anything turning red. These assertions pin
// the two facts that make the warning true — the flag couples to inline, and the skill names it.

const SKILL = join(
  __dirname,
  '..',
  '..',
  '..',
  'h2a',
  'skills',
  'harness',
  'track-report',
  'SKILL.md',
)

const readSkill = (): string => readFileSync(SKILL, 'utf8')

const capture = (argv: string[]): string => {
  let out = ''
  const io: CliIO = { cwd: process.cwd(), out: (s) => (out += s), err: () => {} }
  runCli(argv, io)
  return out
}

const captureErr = (argv: string[]): string => {
  let err = ''
  const io: CliIO = { cwd: process.cwd(), out: () => {}, err: (s) => (err += s) }
  runCli(argv, io)
  return err
}

describe('track-report skill — the compact route is named, not implied', () => {
  it('couples --width to the inline renderer, which is what makes the warning necessary', () => {
    // Not a documentation claim: `--width` alone is rejected for any non-text format exactly as
    // `--inline` is, which is the observable proof that it selects the same route.
    expect(captureErr(['report', '--wp', '--width', '120', '--format', 'json'])).toMatch(
      /--inline\/--width accepts no --format, or --format text/u,
    )
  })

  it('names --width in the same paragraph as --inline, not somewhere else in the file', () => {
    const skill = readSkill()
    const paragraph = skill
      .split(/\n\s*\n/u)
      .find((p) => p.includes('--inline') && p.includes('compact'))
    expect(paragraph, 'no paragraph warns about the compact route').toBeDefined()
    expect(paragraph).toContain('--width')
  })

  it('tells the reader what the compact route actually drops', () => {
    const skill = readSkill()
    // The four-section rewrite (spec 2026-07-29) changed WHAT the compact route drops: `HORS ROLLUP` and
    // `ACTIONS DÉRIVÉES` are no longer sections of any report, so naming them would be stale. The warning
    // must name the sections that exist and that `--inline` still omits.
    const paragraph = readSkill()
      .split(/\n\s*\n/u)
      .find((p) => p.includes('--inline') && p.includes('compact'))!
    for (const dropped of ['DÉCISIONS', 'RECOMMANDATION', '+N autres', 'PRÉCO']) {
      expect(paragraph, `the compact-route warning does not name ${dropped}`).toContain(dropped)
    }
    expect(skill).not.toMatch(/^\s*\*\*(HORS ROLLUP|ACTIONS DÉRIVÉES)\*\*/mu)
  })

  it('scopes the honesty rules to the complete route instead of stating them unconditionally', () => {
    const skill = readSkill()
    const rules = skill.slice(skill.indexOf('## Honesty rules'))
    // The rules must carry their own boundary; an unqualified guarantee is a statement broader
    // than its evidence, which is the defect class this whole spec exists to close.
    expect(rules).toMatch(/guarantees of that route only/u)
  })

  it('does not describe --track-dir as read-only, because it redirects writes too', () => {
    const skill = readSkill()
    expect(skill).not.toMatch(/selects a fixture store and does not\s+write one/u)
    expect(skill).toMatch(/reads and\s*\n?writes alike/u)
  })
})

describe('track --help documents the placement of the store override', () => {
  it('states that --track-dir may appear before or after the command', () => {
    // `report --help` already said this; the global help did not, so the criterion held on one
    // surface and not the other — the exact split-surface defect this PR exists to close.
    const help = capture(['--help'])
    expect(help).toContain('--track-dir')
    expect(help).toMatch(/before or after the command/u)
  })
})
