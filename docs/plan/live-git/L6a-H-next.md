# L6a-H-next — atomic single-step lock acquisition

## Problem

`acquireStoreLock` in `packages/h2a-runtime/src/gateway-host/live-declarations.ts`
creates the lock in two syscalls (`mkdirSync(dir)` then
`mkdirSync(join(dir, token))`). A holder suspended between the two can be
dispossessed by stale takeover, then resumes inside its successor's lock
directory: two simultaneous holders, one silent overwrite (or a resurrected
removal). Opus round-3 co-review verdict: REJECTED (one MAJOR).

## Reproduction (RED at 7b2c4949, then skipped)

```sh
cd packages/h2a-runtime
npx vitest run src/gateway-host/live-declarations-process.test.ts -t "admits only one holder"
```

Result before skip: `vitest exit=1`, both child processes report `{ ok: true }`
(expected exactly one `ok`, the other `LiveRevisionConflict`). The test now
starts with `skip("L6a-H-next: ...")`; un-skip it when fixing.

## Planned fix

Atomic single-step acquisition: temp file carrying the token + exclusive link
to the lock path; stale takeover by rename to a unique name with a single
winner. Add the matching cut ("after lock mkdir", update and delete cases).

## Review cap

2 rounds maximum for the fix review.
