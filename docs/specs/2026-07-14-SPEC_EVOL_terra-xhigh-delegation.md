# SPEC_EVOL — Terra xhigh delegation

Date: 2026-07-14
Status: accepted after independent review
Scope: llm-gateway catalog copies and `h2a delegate` Claude/Codex argv

## Decisions

1. `claude-opus-4-8` resolves to `gpt-5.6-terra` in both maintained gateway
   catalogs. `gpt-5.6-luna` remains a supported explicit catalog id.
2. `OPENAI_MODEL_MAP` keeps precedence over built-in aliases.
3. A delegated `--effort xhigh` is explicit end to end: Claude receives
   `--effort xhigh`; Codex receives the argv pair
   `-c model_reasoning_effort="xhigh"`. The same model/effort overrides survive
   queued launches, local/remote launch construction, and throttled headless
   resumes.
4. Gateway translation preserves Claude's xhigh tier: a thinking budget of at
   least 50,000 tokens becomes `reasoning.effort: "xhigh"` on the Codex
   Responses path and `reasoning_effort: "xhigh"` on the OpenAI path.

## Guardrails

- No shell interpolation carries model, effort, or prompt values.
- Codex accepts `low|medium|high|xhigh`; Claude additionally retains `max`.
- No global installation, process restart, or live provider call belongs to
  this change.

## Acceptance

- Both catalog copies route Opus 4.8 to Terra and explicit Luna to Luna.
- Proxy tests observe Terra plus xhigh in the actual upstream request body.
- Delegation tests prove Claude/Codex first-launch and resume argv.
- Targeted tests, typecheck/build, and `git diff --check` pass.
