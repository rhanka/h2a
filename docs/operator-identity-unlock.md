# Recover a blocked identity lock (0.98.6)

Normal acquisition first tries automatic recovery. Linux recovery requires a
qualified local filesystem and an authorized death proof for every successor.
Canonical epoch-bearing legacy binding locks from 0.96.2–0.98.5 can also qualify
through the independent inter-boot filter and complete NSpid inventory. Other
legacy shapes and uncertain frames wait for normal release until the budget.
A timeout does not authorize an operator assertion.

## Explicit operator intervention

Use an identified 0.98.6 or newer runtime and an explicit, independently
validated store root. Before invoking the command:

1. Attribute that exact store to its machine and writing contexts.
2. Establish quiescence, prevent new launches, and inventory writers including
   old binaries, containers and sandboxes.
3. Verify the holder has stopped in the relevant PID namespace. EPERM, an
   inaccessible frame or absence in another namespace is insufficient.
4. Confirm unchanged generation, exact bytes and inode, including the SUCC
   chain. For legacy post-reboot intervention, the hostname must match and an
   interpretable acquisition date must precede the current boot. A present PID
   requires waiting, even when it appears to belong to another program.

For a recognized record, read its token. For a legacy record, the token is
`legacy-` followed by SHA-256 of the exact bytes, including any final newline:

```sh
sha256sum /path/to/store/identity/.lock
h2a identity unlock --root /path/to/store --token <exact-generation> --assert-dead
```

This is one invocation per token, without a retry loop or automatic retargeting.
A changed token requires a fresh independent assessment. The assertion cannot
outvote a live verdict and never sends a signal. No assertion is part of normal
acquisition.

The tool uses the identity policy and the same succession election. It keeps
the original LOCK in place while it neutralizes the shared binding tail,
revalidates durable possession and rolls forward relevant CAS slots. It confirms
file and directory synchronization before conditional retirement. It may read
local keys to prove possession; it does not mint an identity or publish a
replacement LOCK. A storage or slot-integrity error stops retirement and keeps
a barrier. Do not delete slots, keys, complete journal lines or stale files to
bypass that error.

Unknown versions/protocols require a runtime that understands them. Cull legacy,
empty/corrupt records, exhausted chains and inconsistent slots have no new
generic break recipe. `h2a lock break` continues to use the upgrade policy for
upgrade paths; its canonical identity-lock alias uses the identity repair path.
Destructive cull remains disabled pending its separate owner authorization.

Do not share an h2a store between active kernels, including NFS/SMB exports,
virtiofs, 9p or access from a VM. Local filesystem qualification cannot detect
all server-side sharing. Downgrade requires quiescence, materialized slots and a
durable terminated binding journal before conditional fence release.
