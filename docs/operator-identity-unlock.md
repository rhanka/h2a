# Recover a blocked identity lock

`h2a identity unlock` retires `identity/.lock` through the SUCC protocol. It
requires the token of the observed lock and refuses any different token or
holder classified as live, even with `--assert-dead`. It never kills a PID,
reads a key, or publishes a replacement LOCK. Like the other `identity`
commands, it requires the `@sentropic/h2a-runtime` CLI runtime.

Read only the relevant LOCK file to obtain its `token` field. For a legacy
`{pid,hostname,startedAt}` lock, use `legacy-` followed by the SHA-256 of the
**exact file bytes**, including any trailing newline:

```sh
sha256sum /path/to/store/identity/.lock
h2a identity unlock --root /path/to/store --token <expected-token>
```

If the holder is undecidable, independently verify that it has stopped, then
provide this explicit assertion:

```sh
h2a identity unlock --root /path/to/store --token <expected-token> --assert-dead
```

A legacy holder stays undecidable even when its PID is absent. The JSON
`legacy-record` diagnostic names the recovery command; `legacyRecords` counts
legacy records encountered in this operation. Corrupt or unreadable locks are
refused without removal. Exit status is 0 after retirement and 1 after refusal;
a stale token requires a fresh inspection of LOCK.

The generic alias targets exactly the supplied file:

```sh
h2a lock break --path /path/to/store/identity/.lock --token <expected-token> --assert-dead
```

A certainly dead holder uses ordinary succession. An explicit operator
assertion publishes `SUCC(g){operator:true,target:g}` for an undecidable holder.
An already live successor excludes the operator. After election, the operator
re-reads `LOCK == g` immediately before removal; a winning LOCK bearing a
different token survives. After retirement, an automatic successor observing
an absent LOCK may publish a fresh token through exclusive publication.

See `h2a identity unlock --help` or `h2a lock break --help` for the options.
