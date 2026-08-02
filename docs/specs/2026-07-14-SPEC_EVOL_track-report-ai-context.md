# SPEC EVOL — Track human AI report and deterministic snapshot

Status: accepted after two adversarial reviews; implementation-ready
Date: 2026-07-14
Scope: `@sentropic/track` read-only CLI/MCP surfaces and first-party h2a adapters

## Problem and product boundary

The inherited `fix/track-report-boundary` worktree moved `track report` toward
machine JSON and redirected humans to Focus Web. The owner requires the opposite:
the CLI report itself must be a concise AI interpretation of current repository,
Track, git, and h2a context. Focus Web stays a separate interactive surface.

Track therefore exposes two distinct products:

- **snapshot**: deterministic, provider-free facts for machines and diagnostics;
- **report**: a bounded, cited AI interpretation for a human.

Neither may masquerade as the other. Both are read-only with respect to `.track`
and the repository.

## D1 — legacy compatibility and `track snapshot`

`track report --format json` remains byte-for-byte identical to the current
legacy JSON for the whole deprecation window. It gains no marker, envelope,
classification field, or reordered key. Its snapshot semantics are documented,
not encoded into the legacy payload.

`track snapshot` is the new canonical deterministic command. JSON is the default
and uses a separate, versioned `track.snapshot/v1` envelope:

```ts
interface SnapshotV1 {
  schema: "track.snapshot/v1";
  baseline: { input: string; resolvedCommit: string };
  report: LegacyReport; // reader.report({ decisions:true, wpTree:true, activeRoster:false })
  wpTotals: WpTotals;   // full, unfiltered WP forest
  directives: Array<{
    id: string;
    source: "rule-derived";
    kind: string;
    aggregateId?: string;
    text: string;
  }>;
  recentEvents: Array<{
    position: number;       // append-log position, not wall-clock ordering
    eventId: string;
    kind: string;
    aggregateId?: string;
    summary?: string;
  }>;
}
```

The projection is allowlisted: arbitrary bodies, dossiers, patches, and evidence
payloads are not copied. `recentEvents` is the last 200 events in append order.
`report` always contains the four legacy buckets, the full WP tree (including
terminal roots), and all decisions with their existing outcome; it never carries
the optional presentation `view`. `decisions`, `wpTree`, and `activeRoster` are
not caller-selectable SnapshotV1 variants. `requireAccepted` affects its
bucket/acceptance projection and the explicitly resolved baseline.
All arrays have canonical stable ordering. There is no `generatedAt`, duration,
relative age, cwd, locale, timezone, git, h2a, or document content in SnapshotV1.
The same event log and resolved baseline produce the same UTF-8 bytes across cwd,
timezone, locale, and environment.

`track snapshot --format text|md` are diagnostic renderings owned by Track. They
label directives as rule-derived facts and do not present them as contextual AI
advice. `track report --raw` is an exact alias of `track snapshot` and defaults to
JSON.

During the compatibility window MCP behaves as follows:

- existing `track_report` and its `json|text|md` outputs remain unchanged;
- new `track_snapshot` returns SnapshotV1 (or its deterministic text/md render);
- neither MCP tool invokes an AI or claims to provide a human interpretation.

## D2 — normative CLI matrix

| Invocation | V1 semantics |
|---|---|
| `track report` | AI report, text |
| `track report --format text|md|html` | AI report rendered by Track |
| `track report --inline` | compact AI report with omission counts |
| `track report --format json` | exact legacy JSON bytes |
| `track report --raw [--format json|text|md]` | exact alias of `track snapshot` |
| `track snapshot [--format json|text|md]` | deterministic SnapshotV1 |
| `track report --level …` | deterministic legacy status projection; documented alias target for future `track status` |
| `track report --raw --format html` or `--raw --inline` | explicit usage error |

On the AI path, `--commit` selects the baseline, `--require-accepted` affects the
embedded snapshot, `--decisions` changes `request.decisionEmphasis` from
`open-only` to `all` over the already-present fixed decision projection (it adds
no second payload), `--active-roster` omits terminal WPs from active-work context,
and `--wp|--flat` set an explicit `request.emphasis` value (`workpackages|flat`).
No accepted flag is ignored. Unsupported combinations fail before collection or
adapter invocation.

The complete combination rules are:

- `--inline` accepts no `--format`, or `--format text`; `json|md|html` fail.
- `--width <n>` implies inline, must be an integer in `[40,240]`, and follows the
  same format rule. `--format html` rejects `--inline|--width`.
- `--level` accepts only `--commit`, `--require-accepted`, and
  `--format json|text|md`; it rejects `--raw`, `--inline`, `--width`, `--wp`,
  `--flat`, `--decisions`, and `--active-roster`.
- `track snapshot` and `report --raw` accept only `--commit`,
  `--require-accepted`, and `--format json|text|md`; every other report flag is a
  usage error. Snapshot JSON always carries the fixed full variant above.
- `report --format json` keeps all pre-existing legacy flag combinations/bytes
  except combinations explicitly rejected above; it never invokes AI.

MCP `track_snapshot` has `{baselineCommit:string, requireAccepted?:boolean,
format?:"json"|"text"|"md"}` with `baselineCommit` required because MCP has no
git boundary, rejects unknown properties, and is always deterministic. CLI
snapshot defaults the baseline input to `HEAD` and records both `HEAD` and its
resolved SHA.

## D3 — exact context contract and limits

Track builds and redacts a context body, canonically serializes that body once,
computes SHA-256 over those exact body bytes, then wraps it without mutation in
the envelope written to adapter stdin. This avoids a self-referential digest:

```ts
interface ContextReference {
  ref: string;
  kind: string;
  state: "open" | "closed" | "fact" | "degraded";
}
interface Source<T> {
  status: "ok" | "timeout" | "unavailable" | "invalid" | "truncated";
  entries: T[];
  omitted: number;
  detail?: string; // normalized enum/message, never raw stderr
}
interface ReportContextBodyV1 {
  schema: "track.ai-report.context-body/v1";
  request: {
    baselineInput: string;
    baselineCommit: string;
    format: "text" | "md" | "html" | "inline";
    emphasis: "default" | "workpackages" | "flat";
    requireAccepted: boolean;
    decisionEmphasis: "open-only" | "all";
    activeRoster: boolean;
  };
  workspace: { repoRoot: string; repoKey?: string };
  track: { snapshot: SnapshotV1 };
  git: Source<{
    ref: string; // git:commit:<sha> or git:path:<repo-relative-path>
    kind: "commit" | "changed-path" | "status" | "diff-stat";
    sha?: string;
    path?: string;
    text: string;
  }>;
  h2a: Source<{
    ref: string; // h2a:loop:<id>, h2a:session:<id>, h2a:blockage:<id>, h2a:inbox:<id>
    kind: "loop" | "session" | "blockage" | "inbox-metadata";
    workspace: string;
    text: string;
  }>;
  documents: Source<{
    ref: string; // doc:<relative-path>:chunk:<n>
    kind: "readme" | "agents" | "branch";
    path: string;
    chunk: number;
    text: string;
    untrusted: true;
  }>;
  references: ContextReference[]; // sorted unique citation index
}
interface ReportContextEnvelopeV1 {
  schema: "track.ai-report.context-envelope/v1";
  context: ReportContextBodyV1;
  contextDigest: string;
}
```

Stable Track references are `track:item:<id>`, `track:decision:<id>`,
`track:blocker:<id>`, `track:wp:<id>`, and `track:event:<position>`. Snapshot
entries expose the references needed by citation validation.
The `references` index contains every citeable ref exactly once. Open/closed
decision gates are explicit; source-status refs (`source:git`, `source:h2a`,
`source:documents`) make degraded uncertainty citeable. The adapter receives the
canonical envelope; `contextDigest` is lowercase SHA-256 of the exact canonical
`context` member bytes, not of the enclosing object.

Hard caps are: 512 KiB total canonical context; 256 KiB snapshot; 200 Track
events; 50 git commits; 500 changed/status paths; 100 KiB git total; 100 h2a
entries and 128 KiB h2a total; 32 KiB per document and 64 KiB documents total.
README/AGENTS/BRANCH are the only document classes. Git uses argv arrays with
`shell:false`, a 5 s timeout per command, 1 MiB capture cap, and
`GIT_OPTIONAL_LOCKS=0`; it never collects patch bodies. Each degraded or truncated
source remains explicit.

The optional first-party h2a projection is obtained from
`h2a report-context --workspace-root <realpath>` through an argv-only read
contract. Track validates that every returned entry belongs to the same h2a
tenant/root and that its real workspace is the repo root or a descendant. A
cross-workspace entry makes that source invalid; it is never partially accepted.
Missing h2a is a visible degraded source, not a failure of the whole report.
The collector has `shell:false`, a private temporary cwd, 5 s timeout, 128 KiB
stdout and 16 KiB stderr caps, the same environment allowlist as the AI adapter,
and never replays raw stderr. Extra stdout or an invalid envelope invalidates the
whole h2a source.

Document collectors accept only regular non-symlink files whose own realpath is
inside the repository realpath. Repository prose, Track prose, paths, and commit
messages are untrusted data, never adapter instructions.

## D4 — explicit adapter and no package cycle

V1 has one configuration mechanism: `TRACK_REPORT_AI_ARGV`, a non-empty JSON
array of non-empty strings. Shell-like strings and `TRACK_REPORT_AI_COMMAND` are
not supported. A user-level config at
`${XDG_CONFIG_HOME:-$HOME/.config}/track/report-ai.json` may contain the same
`argv` array plus an optional integer `timeoutMs` from 1,000 through 900,000;
Track and the h2a installer use exactly this lookup and an
end-to-end test writes then reads it with an injected XDG root. The environment
value wins and retains the legacy 90,000 ms deadline. A user config without
`timeoutMs` also retains that 90,000 ms fallback. Repository-local configuration
is forbidden. If neither exists, the AI path fails honestly as D7 requires.

The first-party deployment writes an explicit user config for:

```json
{"argv":["h2a","report-ai","--model","claude-opus-4-8","--effort","xhigh","--gateway","required"],"timeoutMs":600000}
```

The h2a gateway model catalog resolves `claude-opus-4-8` to Terra; the adapter
reports that resolved model. `h2a report-ai` sends one Anthropic-Messages request
directly to the required local gateway, with no `tools` field. It does not launch
Claude Code/Codex CLI and therefore cannot inherit their repo, plugin, MCP, or
shell tools. `xhigh` maps to the existing >=50,000-token thinking tier. Track
imports no h2a package. `h2a report-ai` and `h2a report-context` are leaf commands
and never call `track report` or `track snapshot`.

`--gateway required` is a distinct fail-closed adapter mode: failure to start or
contact the gateway exits nonzero before any provider call. It never falls back
to direct Claude. The response contract proves the catalog route is
`claude-opus-4-8 -> gpt-5.6-terra` and that `xhigh` reached the upstream Codex
reasoning-effort field; a different effective route makes the adapter fail.

The explicit installer is `h2a report-ai install-track-config [--force]`. It
resolves `${XDG_CONFIG_HOME:-$HOME/.config}/track/report-ai.json`, creates parent
directories and a `0600` file atomically, is a no-op for identical content, and
refuses a differing file unless `--force` is explicit. Package installation
never silently runs it. The local deployment lot invokes it without `--force`,
reports a preserved user override, and may use `TRACK_REPORT_AI_ARGV` only for a
one-command smoke without changing that override. Migrating the previous
first-party `{argv}` file to the 600,000 ms Terra/xhigh deadline is therefore an
explicit `h2a report-ai install-track-config --force` rollout; custom and legacy
files remain readable and are never silently replaced.

Track spawns the adapter with `shell:false`, stdin pipe, a private temporary cwd,
the validated config deadline (90 s for legacy config, 600 s for the first-party
Terra/xhigh install), 256 KiB stdout, and 16 KiB stderr. Raw stderr is never replayed.
The child receives only this environment allowlist when present: `PATH`, `HOME`,
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, `LANG`, `LC_ALL`,
`SSL_CERT_FILE`, `SSL_CERT_DIR`, `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, and
`H2A_ROOT`, plus `TRACK_REPORT_AI_DEPTH=1`. No provider secret environment
variable is forwarded; the first-party adapter uses its own user credential
store/transport. A nonzero existing depth is rejected before spawn, preventing a
Track↔h2a recursion loop.

The first-party adapter performs a single model request with repository/MCP/write
tools disabled. Authentication stays inside its transport. An arbitrary custom
adapter is an explicit same-user trust boundary and could still access the local
machine; Track promises only that it does not serialize secrets or grant tools.

## D5 — adapter result and citation validation

Adapter stdout is exactly one JSON object:

```ts
interface Citation { ref: string }
interface AiEntry {
  id: string;
  text: string;          // plain text only
  citations: Citation[];
}
interface AiReportResultV1 {
  schema: "track.ai-report.result/v1";
  adapter: {
    provider: string;
    model: string;
    effort?: string;
    resolvedModel?: string;
    identity: "adapter-reported";
  };
  sections: {
    summary: AiEntry[];
    facts: AiEntry[];
    changes: AiEntry[];
    activeWork: AiEntry[];
    blockers: AiEntry[];
    ownerDecisions: AiEntry[];
    suggestions: AiEntry[];
    uncertainty: AiEntry[];
  };
}
```

Unknown keys, duplicate entry ids, excessive depth, invalid UTF-8/control data,
or extra stdout fail the command. There are at most 20 entries per section,
1,000 Unicode scalar values per text, and 8 citations per entry; total validated
result is at most 128 KiB. Every entry in every section, including summary,
suggestions, and uncertainty, has at least one citation (a degraded uncertainty
cites its `source:*` ref). Every citation must equal a stable ref
present in the exact context. An owner-decision citation must resolve to a
currently open decision or decision gate in SnapshotV1; a closed or forged ref
fails the whole result. Suggestions are always rendered as AI suggestions; Track
does not attempt an impossible semantic classifier for “factual” prose. Adapter provider,
model, effort, and resolved model are displayed as `adapter-reported`; Track
attests only the context digest it computed itself.

## D6 — Track-owned rendering

Adapter strings are data, never markup. Track normalizes them by removing ANSI,
C0/C1 controls (except internal normalized newlines), NUL, and dangerous bidi
controls.

- text: Track owns headings, bullets, attribution, and visible citation refs;
- Markdown: every AI string and citation is Markdown-escaped;
- HTML: every interpolation is HTML-escaped; model Markdown is never rendered;
- inline: fixed width, at most two entries per section, with an explicit omitted
  count and context digest.

All formats show `adapter-reported` provider/model identity, `contextDigest`,
degraded sources, uncertainty, and AI attribution. Existing identity sanitizer
hooks are insufficient for this path; escaping is mandatory at interpolation.

## D7 — honest failure

Missing configuration, invalid config, timeout, cap violation, nonzero exit,
malformed/extra JSON, forged citations, closed owner decisions, or render-invalid
text makes bare `track report` exit nonzero. It prints a normalized reason and
points to `track snapshot` / `track report --raw`. It never falls back to the old
rule-derived recommendation or labels a snapshot as AI output.

Redaction of common credentials/tokens in collected prose is defense in depth and
best-effort, not an absolute secret-detection guarantee. Secrets, raw environment,
private keys, raw stderr, and provider credentials are never deliberately
serialized into context, diagnostics, or result.

## D8 — h2a facade and skills

`h2a report` delegates to the same AI path and preserves stdout/stderr/exit;
`h2a snapshot` delegates to the canonical snapshot path. The existing MCP
`track_report` stays legacy deterministic; new `track_snapshot` is the canonical
machine read.

The source `track-operation` skill, its installed slash commands, Gemini TOML,
and generated copies are updated together. A human report runs the AI path. If it
fails, the skill states that failure, may fetch snapshot facts under an explicit
“factual snapshot (not an AI report)” label, and never rewrites those facts into
invented advice.

## Acceptance gates

1. Golden bytes prove legacy CLI JSON unchanged with/without `--wp` and
   `--decisions`, and legacy MCP `json|text|md` unchanged.
2. Snapshot JSON is stable across timezone, locale, cwd, and environment, with a
   resolved baseline, the fixed full report variant, and canonical ordering.
3. A full flag-matrix test proves every invocation above and every incompatible
   combination.
4. Fake adapters prove exact post-redaction digest bytes, rich Track/git/h2a/doc
   context, attribution, and Track-owned text/md/html/inline rendering without a
   network.
5. Missing, recursive, timeout, nonzero, invalid/extra JSON, JSON bomb, cap,
   malicious stderr, ANSI/C0/C1/bidi, Markdown/HTML, prompt-injection prose,
   absent/forged citations, and closed-decision citations fail or escape exactly
   as specified.
6. Symlinks/out-of-repo documents and cross-workspace h2a entries are rejected;
   no secret/env value appears in stdin, stdout, or diagnostics fixtures.
7. `h2a report-ai` uses a no-tools model call, `h2a report-context` is
   scoped/read-only/capped, neither calls Track report, gateway-required never
   falls back direct, Opus resolves Terra, xhigh reaches upstream, and facade
   stdout/stderr/exit parity is tested.
8. Skill source and every installed/generated host command follow the new
   AI/factual-snapshot distinction.
9. Track-only and full h2a tarball smokes pass; all Track, h2a facade, public
   contract, build, and typecheck suites pass without a live network in tests.
10. Installer tests cover XDG/default paths, `0600`, atomic/no-op behavior,
    preserve-without-force, explicit force, and environment override precedence.
