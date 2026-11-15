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
      expect(Object.keys(labels.stage).sort()).toEqual([
        'brainstorm',
        'dev',
        'done',
        'merged',
        'plan',
        'pr',
        'preprod',
        'prod',
        'published',
        'review',
        'spec',
        'test',
      ])
      expect(Object.keys(labels.status).sort()).toEqual([
        'blocked',
        'done',
        'not-qualified',
        'not-started',
        'on-track',
        'unforeseen',
        'waiting',
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
      brainstorm: 'brainstorm',
      spec: 'spec',
      plan: 'plan',
      dev: 'dev',
      test: 'test',
      pr: 'pr',
      review: 'review',
      merged: 'merged',
      published: 'published',
      preprod: 'preprod',
      prod: 'prod',
      done: 'done',
    })
    expect(resolved.labels.status).toEqual({
      'on-track': 'on-track',
      waiting: 'waiting',
      unforeseen: 'unforeseen',
      blocked: 'blocked',
      'not-started': 'not-started',
      done: 'done',
      withdrawn: 'withdrawn',
      'not-qualified': 'not-qualified',
    })
    // No silent French fallback: an unknown tag never yields French words.
    expect(JSON.stringify(resolved.labels)).not.toContain('bloqué')
  })

  it('freezes the shipped lexicon surface', () => {
    expect(STAGE_STATUS_LEXICON).toMatchSnapshot()
  })
})
