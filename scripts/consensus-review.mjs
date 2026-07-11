#!/usr/bin/env node
// consensus-review — one independent, adversarial review leg of a design doc via the OpenAI
// Responses API (gpt-5.5, high reasoning). This is the machine leg of the repo's double-consensus
// method (the human/Claude leg is a peer agent). Committed so it runs as stable tooling instead of
// ad-hoc bash that needs re-approval each time.
//
// Usage:
//   node scripts/consensus-review.mjs --spec <file> [--context <file>]... [--prior <file>]
//        [--focus <text>] [--model <id>] [--effort low|medium|high] [--out <file>]
//   npm run consensus -- --spec docs/specs/foo.md
//
//   --spec <file>       the design doc to review (required)
//   --context <file>    extra grounding file(s) passed verbatim (repeatable)
//   --prior <file>      a prior review → turns this into a CLOSURE pass (verify its must-fixes closed)
//   --focus <text>      extra reviewer instruction (what to stress)
//   --model <id>        default: gpt-5.5
//   --effort <level>    reasoning effort, default: high
//   --out <file>        write the review here (default: stdout)
//
// Key resolution: OPENAI_API_KEY, else the first `OPENAI_API_KEY=` in ~/src/sentropic/.env then
// .env.prod (never hardcoded, never logged).

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

function parseArgs(argv) {
  const out = { context: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => argv[++i]
    if (a === '--spec') out.spec = val()
    else if (a === '--context') out.context.push(val())
    else if (a === '--prior') out.prior = val()
    else if (a === '--focus') out.focus = val()
    else if (a === '--model') out.model = val()
    else if (a === '--effort') out.effort = val()
    else if (a === '--out') out.out = val()
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`unknown arg: ${a}`)
  }
  return out
}

function apiKey() {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim()
  const base = path.join(homedir(), 'src', 'sentropic')
  for (const f of [path.join(base, '.env'), path.join(base, '.env.prod')]) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const m = /^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/.exec(line)
        if (m) return m[1].replace(/^["']|["']$/g, '')
      }
    } catch {
      /* next candidate */
    }
  }
  return undefined
}

const HELP = `consensus-review — one adversarial gpt-5.5 review leg of a design doc.
Usage: node scripts/consensus-review.mjs --spec <file> [--context <f>]... [--prior <f>] [--focus <t>] [--model <id>] [--effort <lvl>] [--out <f>]`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.spec) {
    process.stdout.write(HELP + '\n')
    process.exit(args.help ? 0 : 2)
  }
  const spec = readFileSync(args.spec, 'utf8')
  const contexts = args.context.map((f) => `\n\n======== CONTEXT: ${f} ========\n${readFileSync(f, 'utf8')}`)
  const prior = args.prior ? readFileSync(args.prior, 'utf8') : undefined

  const base = `You are an INDEPENDENT, adversarial senior design/security reviewer (max rigor). No praise,
no restating the doc. Find what is WRONG, WEAK, UNDER-SPECIFIED, or OVER-CLAIMED. Judge as a
DESIGN-ONLY doc: a deferred *mechanism* behind a normative *property* is acceptable; an unresolved
safety/correctness/privacy *hole* is not.${args.focus ? `\n\nStress especially: ${args.focus}` : ''}`

  const task = prior
    ? `This is a CLOSURE pass. Below is your PRIOR review, then the REVISED doc. For EACH prior must-fix
state CLOSED / PARTIAL / OPEN citing the exact section that closes it. Flag any NEW hole.`
    : `Cover: (1) correctness/soundness, (2) gaps that bite at plan/impl time, (3) security/privacy/trust
hazards, (4) anything over-claimed or internally inconsistent.`

  const verdict = `\n\nEnd with VERDICT: GO / GO-WITH-FIXES / NO-GO, then a SHORT ordered list of concrete
required fixes tagged [must-fix]/[nice]. If NO-GO, name the single blocking issue first. Terse and specific.`

  const prompt =
    `${base}\n\n${task}${verdict}` +
    (prior ? `\n\n======== YOUR PRIOR REVIEW ========\n${prior}` : '') +
    contexts.join('') +
    `\n\n======== DOC TO REVIEW (${args.spec}) ========\n${spec}`

  const key = apiKey()
  if (!key) {
    process.stderr.write('consensus-review: no OPENAI_API_KEY (env or ~/src/sentropic/.env{,.prod})\n')
    process.exit(3)
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: args.model ?? 'gpt-5.5',
      input: prompt,
      reasoning: { effort: args.effort ?? 'high' },
    }),
  })
  const j = await res.json()
  if (!res.ok) {
    process.stderr.write(`consensus-review: HTTP ${res.status} ${JSON.stringify(j).slice(0, 800)}\n`)
    process.exit(4)
  }
  let text = j.output_text
  if (!text && Array.isArray(j.output)) {
    text = j.output
      .flatMap((o) => (o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text))
      .join('\n')
  }
  text = text || JSON.stringify(j).slice(0, 2000)
  if (args.out) {
    writeFileSync(args.out, text)
    process.stderr.write(`consensus-review: wrote ${text.length} chars → ${args.out}\n`)
  } else {
    process.stdout.write(text + '\n')
  }
}

main().catch((e) => {
  process.stderr.write(`consensus-review: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
