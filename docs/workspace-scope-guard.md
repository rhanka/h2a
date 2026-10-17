# Workspace scope guard

An agent operates in its session workspace. Hand foreign changes to that
workspace's owning conductor unless the owner has explicitly granted the exact
operation. Published package versions belong to the owning release lane.

## Installation and authority

The npm package ships the guard under `hooks/`, with no dependency on a running
h2a daemon. Claude and Codex plugin hooks register SessionStart and all-tool
PreToolUse hooks. SessionStart records the host session identity in the launch
workspace; changing tool cwd cannot initialize another workspace. A missing
binding refuses until the plugin is reloaded.

`h2a host plugin --host claude|codex|gemini|muse --instance SESSION --workspace WORKSPACE
--owner-key /owner-controlled/scope-public.pem --write SETTINGS` installs a command
with a fixed workspace, session and verification key. `--scaffold DIR` on Codex
includes that command in the generated marketplace plugin. Run installation from
the owner's terminal, substituting one host and concrete paths. The key option is
optional: without a pinned key no grant can authorize an exception. No automatic
trust enrollment exists. Packaged Claude/Codex plugins also accept
`H2A_SCOPE_OWNER_KEY` from the owner-controlled host startup environment. Tool
payloads, command environment assignments and journal rows cannot select that key.

Vibe installation copies the guard and its helpers and registers a separate strict
`pre_tool` hook. It does not depend on MCP guard qualification. Each native session
is bound once to the hook's launch cwd in the profile's protected
`.h2a/workspace-scope/sessions.jsonl` journal beneath `.h2a-install`; later tool
cwd changes cannot rebind it. A second native session can use another repository
in the same profile. Explicit owner-key selections update the managed manifest;
ordinary convergence retains them. `--instance` selects lifecycle recording;
scope grants use the native session identity shown in refusals.

agy convergence installs `SessionStart` and all-tool `PreToolUse` in
`~/.gemini/config/hooks.json` as a named hook definition, independently of
lifecycle polling. `host plugin --host agy --write SETTINGS` installs the same
startup contract, without pinning an installer session or workspace globally.
The hook's cwd is the configuration directory. At SessionStart, exactly one
absolute directory in the host event's `workspacePaths` selects the workspace;
`conversationId` is bound once in the protected profile journal selected by
`--session-store`. Later calls use that binding, regardless of tool cwd or a
changed `workspacePaths`. Missing or ambiguous startup paths refuse. SessionStart
returns `{}`. Its `conversationId` and `toolCall.name/args` payloads are
translated to the shared policy, including `ReplacementChunks`. Startup handlers
use agy's flat handler list. It returns `decision: allow|deny`, exit 0. The schema
and default paths follow [Google's hook contract](https://antigravity.google/docs/hooks).

Muse loads project `WORKSPACE/.muse/hooks.json`. Run `h2a install-skills --host
muse --owner-key /owner-controlled/scope-public.pem` from each workspace to install
its SessionStart binding and PreToolUse guard, retaining unrelated hooks. The
guard/helper copies live in Muse's managed user profile; the project hook has its
own manifest and conflict checks. Native Muse `1.4.10-R6427.1` was verified with
a public checksum-verified binary in a disposable profile, including actual
startup and plugin hook dispatch. User-global `hooks.json` is not assumed to load.
Muse refusals use `hookSpecificOutput.permissionDecision: deny` and exit 2.
User convergence (`doctor --repair`) maintains profile helpers without creating
project hooks in its current directory. Project installation is explicit.
Other native execution qualification remains separate from configuration tests.

## Owner grant: one explicit command

The owner prepares an Ed25519 key pair outside the agent's readable/writable
boundary and pins its public key through the installation command above. The
private key must never be placed in an agent workspace or passed through agent
tools. From an independent owner terminal, one command records an authorization:

```sh
node /opt/h2a/hooks/workspace-scope-grant.mjs --key /owner-only/scope-ed25519.pem --owner antoinefa --workspace /home/antoinefa/src/sentropic --session sentropic-conductor --repo github.com/rhanka/h2a --action gh.pr.merge --ref 327 --expires 2026-10-18T00:00:00Z
```

Replace the installation path, source session/workspace, target repository/action/
reference and expiry with the exact intended operation. This is an example, not
an issued grant. The command opens the source workspace's journal in append mode:
`WORKSPACE/.h2a/workspace-scope/grants.jsonl`. Each line has exactly this format:

```json
{"grant":{"schema":1,"owner":"antoinefa","workspace":"/home/antoinefa/src/sentropic","session":"sentropic-conductor","repo":"github.com/rhanka/h2a","action":"gh.pr.merge","ref":"327","expires":"2026-10-18T00:00:00Z"},"signature":"BASE64_ED25519_SIGNATURE"}
```

The signature covers the UTF-8 bytes of `JSON.stringify(grant)` in the field order
shown above, using Ed25519 without a separate digest. Verification uses only the
deployment-pinned public key, never a key supplied in the journal. Paths are
canonical; GitHub locators normalize to `hostname/owner/repository`. Session,
workspace, repository, action and reference must match exactly; expiry must be
in the future. No wildcards. A grant can be reused for that exact operation until
expiry; use a short expiry. Agents cannot invoke the grant command through the
guard and cannot manufacture a signature without the owner key.

For a foreign PR containing a published version bump, two explicit grants are
required: `gh.pr.merge` for the foreign operation and `release` for that same PR.
An ordinary foreign grant never authorizes release. An owning release lane also
needs `action: "release"`, bound to its exact repo/ref. For a published package's `npm version patch`,
the reference is `patch`; for an edited manifest, its absolute canonical path;
for a PR, its number; for a push, the supplied refspecs joined by one space, or
the current branch when omitted. Typed denial records expose the exact requested
action/repo/ref before the owner decides whether to grant it.

## Enforced surface and audit

The guard checks explicit edits, writes and apply_patch paths, native argv tools,
literal Codex orchestration envelopes, shell cwd and git directory selectors,
GitHub repository flags/PR URLs/REST mutations, package-manager cwd flags,
release scripts and npm script aliases. Git pushes check effective push remotes,
multiple push URLs and URL rewrite rules. Sibling worktrees and nested repositories
remain foreign even if they share a Git common directory or origin.

Published `package.json` version changes are checked in proposed edits/patches,
the commit index/worktree, pushed trees/refspecs and incoming merge refs. A session
pins its first observed Git baseline in protected `baselines.jsonl`; moving local
`main`/`origin/main` refs cannot erase a bump. Direct `git update-ref` is owner-only.
Publication status also comes from that baseline: temporarily setting
`private: true` cannot exempt an already published package. Proposed patches are
applied in memory, including repeated sections, before comparing the complete
JSON manifests' top-level version fields. Multiline values have the same policy.
Manifest diffs run from the repository root, including when a command selects a
child cwd. Before PR merge
or ready, read-only `gh` calls inspect the diff; candidate changes are verified
against full base/head manifests to distinguish private packages and nested
metadata. Missing baseline, unavailable PR inspection and dynamic sensitive
commands fail closed.

The threat model is an honest agent making a workspace or release mistake.
Protected write intent must resolve with certainty to the session's own workspace
and authorized release lane. Variables in sensitive argv, substitutions,
heredocs, `eval`, shell `-c`/`-s` programs, runtime stdin/eval, symlink selectors,
and independent Git directory selectors refuse with `UNVERIFIABLE`. The guard
does not evaluate these forms to guess their intent. Heredoc preprocessing and
recursive substitution/script interpretation are deliberately absent; even data
heredocs and harmless substitutions require an explicit equivalent. The typed
message asks for the plain explicit form or an owner grant. Unresolved selectors
must first be made explicit so a grant can match the exact repo/action/ref/session.
Opaque inline runtime programs also refuse. Plain own-repo commands and quoted
prose pass through, including copies/moves into `.`, `mkdir -p .`, and `&& cd`
within the workspace. Conditional cwd alternatives are checked separately; any
unresolved foreign alternative refuses. Subshell/pipeline state is restored.
Unsupported shell control flow, functions, stateful builtins (`eval`, `export`,
aliases and related commands), reflective JavaScript tool access,
dynamic executable names and uninspectable shell stdin refuse with
`UNVERIFIABLE`. Literal shell wrappers and line continuations preserve command
boundaries; compound pipeline stages also refuse. JavaScript strings are decoded
before shell classification. Strings and comments do not count as tool references;
aliases of the tools capability refuse. Git configuration/remote mutations
refuse when later commands could depend on their unexecuted effects.
Unquoted brace expansions and ambiguous conditional environment resets also
refuse; a skipped reset cannot erase a foreign context.
Mutating `git apply`/`git am` requires owner execution because an opaque patch can
replace trust files as well as published versions; inspection flags cannot
override that protection when combined with `--apply`. `git clean` targets,
project/global hook files, installer manifests, helper code, the pinned key and
journals are protected from classified file mutations with `OWNER_ONLY`.
Every commit checks the index, with an additional worktree check for path/`--all`
commits. Multi-ref pushes inspect the union of explicit refspecs and selected
branches/tags. Patch sections
match canonical full paths, and agy replacement chunks honor their line ranges.
Read-only `npm version` queries and versioning an own package private at baseline
remain allowed; foreign package operations still require a scope grant.

Refusals have `[H2A_SCOPE:CODE]`, machine-readable `code`, exact
`repo`/`action`/`ref`/`session` selectors in stdout and stderr, an explicit handoff to
the owning conductor, and an appended record in
`WORKSPACE/.h2a/workspace-scope/audit.jsonl`. Accepted grants are recorded there
with their signed authorization. Codes include `FOREIGN_WORKSPACE`, `VERSION_BUMP`,
`RELEASE_ONLY`, `OWNER_ONLY`, `UNVERIFIABLE` and `AUDIT_UNAVAILABLE`. If the journal
cannot be written, the action remains refused and the typed result/stderr is
the host-log evidence. State symlinks are refused. Journals are human-readable
JSONL and the provided writers append/fsync rather than rewrite.

## Boundary and validation limits

PreToolUse is a development guard, not an operating-system sandbox. Protect its
launch configuration, code and pinned public key from agent writes, and the
private key from agent reads. A same-UID actor with unrestricted arbitrary code
execution can replace writable hooks, hide mutations in opaque scripts, use an
unclassified tool or edit journals directly. Application append-only writes are
not filesystem immutability. These hooks do not claim to solve those boundaries.

Static command analysis does not implement every shell dialect, Git alias,
interpreter, indirect executable or MCP mutation. Known dynamic sensitive command
envelopes refuse; arbitrary program semantics remain outside this guard. The
tests use disposable repositories, profiles and local fake GitHub read responses;
they do not qualify execution by real Claude/Codex/Vibe hosts or any live owner
configuration. Agy's global-cwd/startup contract and Muse's project installation
are tested in disposable profiles; this does not qualify full native sessions.
An external OS trust boundary remains uncovered. No package version is changed
by this feature.
