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

`h2a host plugin --host claude|codex|gemini --instance SESSION --workspace WORKSPACE
--owner-key /owner-controlled/scope-public.pem --write SETTINGS` installs a command
with a fixed workspace, session and verification key. `--scaffold DIR` on Codex
includes that command in the generated marketplace plugin. Run installation from
the owner's terminal, substituting one host and concrete paths. The key option is
optional: without a pinned key no grant can authorize an exception. No automatic
trust enrollment or environment-supplied verification key exists.

Vibe installation copies the guard and its helpers and registers a separate strict
`pre_tool` hook. It does not depend on MCP guard qualification. Its initial
workspace/session/key binding is retained in the managed installation manifest;
doctor does not silently rebind it to another cwd. Use a dedicated Vibe profile
for that workspace/session. Host execution qualification remains separate from
configuration tests. agy and muse expose no verified pre-action hook: rendering
and installation reports explicitly say that workspace scope is **not enforced**.

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
needs `action: "release"`, bound to its exact repo/ref. For `npm version patch`,
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
the commit index, pushed trees/refspecs and incoming merge refs. Before PR merge
or ready, read-only `gh` calls inspect the diff; candidate changes are verified
against full base/head manifests to distinguish private packages and nested
metadata. Missing baseline, unavailable PR inspection and dynamic sensitive
commands fail closed. Ordinary own-repo commands and quoted prose pass through.

Refusals have `[H2A_SCOPE:CODE]`, machine-readable `code`, an explicit handoff to
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
configuration. agy/muse enforcement and an external OS trust boundary remain
uncovered. No package version is changed by this feature.
