// Lot 2 (D10) — the stage/status lexicon: human labels for the new surface
// come from a per-language lexicon keyed by an open `--lang <bcp47>`
// parameter. Codes are the identity; an unknown language renders the codes
// themselves — never a closed language enum, never a silent French fallback.
import { describe, expect, it } from 'vitest'

import {
  resolveStageStatusLabels,
  STAGE_STATUS_LEXICON,
} from './stage-status-lexicon.js'

describe('stage/status lexicon — codes are the identity', () => {
  it('covers every stage and status code in every shipped language', () => {
    for (const [lang, labels] of Object.entries(STAGE_STATUS_LEXICON)) {
      expect(Object.keys(labels.stage).sort()).toEqual(['deployed', 'dev', 'merged', 'pr', 'published', 'review', 'spec'])
      expect(Object.keys(labels.status).sort()).toEqual([
        'blocked',
        'decision-awaited',
        'not-qualified',
        'progressing',
        'unforeseen',
        'withdrawn',
      ])
      for (const label of [...Object.values(labels.stage), ...Object.values(labels.status)]) {
        expect(label.trim().length, `${lang} label`).toBeGreaterThan(0)
      }
    }
  })

  it('resolves an open BCP47 tag: exact, then primary subtag', () => {
    expect(resolveStageStatusLabels('es').matched).toBe(true)
    expect(resolveStageStatusLabels('es-MX').lang).toBe('es')
    expect(resolveStageStatusLabels('JA').lang).toBe('ja')
    expect(resolveStageStatusLabels('ar-EG').lang).toBe('ar')
  })

  it('an unprepared language renders the codes themselves, never silent French', () => {
    const resolved = resolveStageStatusLabels('xx')
    expect(resolved.matched).toBe(false)
    expect(resolved.labels.stage).toEqual({
      spec: 'spec',
      dev: 'dev',
      pr: 'pr',
      review: 'review',
      merged: 'merged',
      published: 'published',
      deployed: 'deployed',
    })
    expect(resolved.labels.status).toEqual({
      progressing: 'progressing',
      unforeseen: 'unforeseen',
      blocked: 'blocked',
      'decision-awaited': 'decision-awaited',
      'not-qualified': 'not-qualified',
      withdrawn: 'withdrawn',
    })
    // No silent French fallback: an unknown tag never yields French words.
    expect(JSON.stringify(resolved.labels)).not.toContain('bloqué')
  })

  it('freezes the shipped lexicon surface', () => {
    expect(STAGE_STATUS_LEXICON).toMatchSnapshot()
  })
})
