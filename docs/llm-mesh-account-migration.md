# LLM account migration

H2A 0.94 removes its legacy local account pool. Provider credentials and
account selection now belong exclusively to Sentropic llm-mesh.

Enroll the two currently supported account types through the unified CLI:

```sh
h2a llm-mesh account enroll codex
h2a llm-mesh account enroll cloud-code
```

Inspect the public account inventory, or remove an enrollment, through the
same namespace:

```sh
h2a llm-mesh account list
h2a llm-mesh account list --json
h2a llm-mesh account remove <account-id>
```

`ls` aliases `list`; `rm` and `unenroll` alias `remove`. Inventory output is
limited to public metadata owned by the local llm-mesh scope. Removal never
prints or accepts a credential.

The former `h2a account ...` namespace, the flat
`h2a llm-mesh enroll ...` spelling, `h2a account push-cluster`, and the
`--account` job option no longer exist.

`h2a run codex --no-gw` and `h2a run claude --no-gw` use the native CLI
authentication path. H2A does not select a pooled account or synthesize
`OPENAI_API_KEY`/`CLAUDE_CONFIG_DIR`. A user-owned Claude API key remains
available to the native Claude process. With `--gw`, H2A uses only the opaque
llm-mesh gateway token and fails without starting an agent if that required
gateway is unavailable.

Existing files under `~/.sentropic/` from the removed pool are not read or
deleted. `h2a doctor` reports their paths by existence only. Back them up,
verify the new enrollments, then remove them manually if no rollback is needed.
