# h2a durable daemons — systemd `--user` units

Two units live here, both **opt-in** and both **off until you enable them**:

| Unit | Runs | What it is for |
|---|---|---|
| `h2a-supervisor.service` | `h2a loop supervise` | auto-relaunch opted-in objective loops |
| `h2a-mirror-push.service` | `h2a remote mirror --interval-ms 20000` | keep a hosted read-only feed warm (see the last section) |

# h2a durable supervisor — `h2a-supervisor.service`

`h2a-supervisor.service` runs `h2a loop supervise` as a durable, auto-restarting
user service. That is the piece that makes objective loops **auto-relaunch
server-side** — the way `/loop` does on Claude, but host-agnostic and without a
terminal attached.

Each beat, the supervisor takes every loop that has **opted in**
(`policy.autoTick === true`) and, for each one it can lease as the **single
writer**, runs one `tick + execute` of the existing engine, then releases the
lease. It never touches loops that have not opted in, and the global kill-switch
`H2A_LOOP_AUTOTICK_OFF` freezes all ticking without disabling the unit.

## Install (the one owner host-step)

```sh
# 1. Copy the unit into your user systemd dir
mkdir -p ~/.config/systemd/user
cp contrib/systemd/h2a-supervisor.service ~/.config/systemd/user/

# 2. (If needed) edit ExecStart to the absolute path of `h2a`.
#    The template defaults H2A_ROOT to %h/src/a2a-cli, the fleet checkout
#    convention. Change it only when your fleet uses a different root.
#    `command -v h2a` prints the path to use.

# 3. Enable + start it now
systemctl --user daemon-reload
systemctl --user enable --now h2a-supervisor

# 4. REQUIRED for a terminal-less supervisor: keep it running after you log out.
#    Without linger, the user manager (and the supervisor) stop at logout.
loginctl enable-linger "$USER"
```

Make sure `Environment=H2A_ROOT=` in the unit points at the SAME root where your
loops live (`h2a loop list --root <value>` should show them) — otherwise the
supervisor watches an empty directory and silently ticks nothing.

For the currently deployed fleet host, systemd must expand the shared-template
default to `H2A_ROOT=/home/antoinefa/src/a2a-cli`. This is a host deployment
value, not a personal path embedded in the shared template. `h2a-mirror-push`
still has its own root configuration and is intentionally outside this wire-only
supervisor change.

## Operate

```sh
systemctl --user status h2a-supervisor      # health
journalctl --user -u h2a-supervisor -f      # per-beat summaries (JSON lines)
systemctl --user stop h2a-supervisor        # stop (SIGTERM → graceful abort)

# Freeze ticking. The kill-switch is read from the supervisor process's
# environment, which is fixed at start — so it takes effect on (re)start, not on
# a running process. Set it and restart:
systemctl --user set-environment H2A_LOOP_AUTOTICK_OFF=1
systemctl --user restart h2a-supervisor
# (Persist it by adding `Environment=H2A_LOOP_AUTOTICK_OFF=1` to the unit +
# `systemctl --user daemon-reload && systemctl --user restart h2a-supervisor`.)
# To fully stop instead: `systemctl --user stop h2a-supervisor`.
```

## Opt a loop in

Auto-ticking is **off by default** for every loop. A loop is supervised only
when its policy has `autoTick: true`. Check attendance from any reader via the
`loopAttendance` projection (a loop that has opted in but has no fresh executor
heartbeat reads `unattended` — e.g. when the supervisor is not running).

---

# h2a live mirror push — `h2a-mirror-push.service`

`h2a-mirror-push.service` runs `h2a remote mirror --interval-ms 20000`: the
**same** signed one-shot push `h2a remote mirror` has always done, repeated on a
beat. That is what keeps a hosted read-only surface warm enough for a consumer
that only ever pulls — a laptop behind NAT cannot accept inbound, so the data
path has to be push (feed-contract P1 step 4a,
`docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md` Part C).

Nothing about the payload, the signature, or the accept-side verification
changes. What the daemon adds is only scheduling and failure handling:

- **Monotonic beat, no drift.** Cycle *n* is due at `anchor + n × interval`, not
  "interval after the last one finished". Slots already in the past are skipped,
  and a small ±10% jitter keeps several agents from hitting one endpoint in
  lockstep.
- **No overlap.** The daemon awaits each cycle before scheduling the next, so a
  slow push delays the following beat instead of stacking on it — and the missed
  beats are then skipped rather than fired back-to-back.
- **Transient errors keep looping.** A network failure, a 5xx or a 429 is backed
  off exponentially (5s doubling, capped at 5min) and then retried.
- **A refused key STOPS the daemon.** Repeated 401/403 means the receiving side
  does not trust this instance's key — never enrolled, revoked, or the agent
  re-anchored and now signs with a different keypair. Retrying cannot fix that,
  so after three backed-off attempts the daemon exits 1 with an explicit
  re-enrollment instruction instead of hammering a server that is saying no.
- **A refused request also stops it.** Five consecutive non-auth 4xx (a wrong
  path answering 404, a clock so skewed that every envelope reads expired) exit 1
  the same way. A looser budget than the auth one, because a stale-sequence
  rejection can genuinely clear — but not an unbounded one, because a wrong path
  never will.
- **An unusable `--url` never starts.** A target that is not a parseable http(s)
  URL — an unfilled placeholder, a typo — is refused before the first cycle. It
  would otherwise look like a network failure and be retried forever.
- **A root that cannot produce a mirror stops it.** Five consecutive local build
  failures — overwhelmingly `H2A_ROOT` pointing at a root where the instance
  never registered — exit 1. Nothing is ever sent in that state, so idling
  `active (running)` forever would report green while the feed is dead.
- **The status line says what was pushed**, not just that something was: each
  cycle logs `seq` plus the number of registrations, presence sessions and
  subagent bindings. A `presence: 0` line is a *successful push of an empty
  mirror* — the pipeline is healthy and the UI will still show nothing.
- **A dead status sink stops it cleanly.** If stdout closes (piping into
  something that exits, a journald restart), the daemon stops with exit 0 rather
  than pushing on where nobody can see what it is doing.
- **Safe logs.** One JSON status line per cycle on stdout: cycle number,
  outcome, HTTP status, a closed-vocabulary rejection reason, duration, and the
  endpoint reduced to scheme+host+path. Never key material, never a token, never
  a request or response body.

## Install (the owner host-step)

**This unit ships DISARMED**: `Environment=H2A_MIRROR_PUSH_OFF=1` is active in
the file, so enabling it as-shipped starts a process that reports itself disabled
and exits 0 — before reading the key file or validating any flag, so unfilled
placeholders cannot even produce an error. `Restart=on-failure` means that clean
exit leaves the unit **inactive**, not restarting every 30s. Arming it is a
deliberate, separate act.

```sh
# 1. Copy the unit into your user systemd dir
mkdir -p ~/.config/systemd/user
cp contrib/systemd/h2a-mirror-push.service ~/.config/systemd/user/

# 2. Edit it: replace the three ExecStart placeholders (--url, --instance,
#    --private-key) and point Environment=H2A_ROOT at the root this agent
#    actually registers in. `h2a discover --root <root>` lists the instances.

# 3. Enable + start. While the kill-switch line is present this start is a
#    no-op: the process says it is disabled and exits 0, so `systemctl --user
#    status h2a-mirror-push` reads inactive (dead) with a clean exit. That is
#    the expected state until step 5 — it is not a failure.
systemctl --user daemon-reload
systemctl --user enable --now h2a-mirror-push

# 4. Keep it running after logout
loginctl enable-linger "$USER"

# 5. ARM IT — only after this instance's CURRENT public key is enrolled on the
#    receiving side. Delete the Environment=H2A_MIRROR_PUSH_OFF=1 line, then:
systemctl --user daemon-reload
systemctl --user restart h2a-mirror-push
```

Step 5 is the one that starts real traffic. Do it after enrollment, not before:
an unenrolled key is rejected, and three rejections stop the daemon by design.

## Operate

```sh
systemctl --user status h2a-mirror-push      # health
journalctl --user -u h2a-mirror-push -f      # per-cycle status lines (JSON)
systemctl --user stop h2a-mirror-push        # stop (SIGTERM → stops between cycles)

# Freeze without disabling the unit (takes effect on restart, like the supervisor):
systemctl --user set-environment H2A_MIRROR_PUSH_OFF=1
systemctl --user restart h2a-mirror-push
```

A daemon that exits 1 stopped **on purpose** and needs a human act; the last
journal line says which:

| Message starts with | What to do |
|---|---|
| `mirror push STOPPED: the endpoint rejected this instance's signing key` | enroll this instance's current public key on the receiving side, then restart |
| `mirror push STOPPED: the endpoint rejected this mirror on every attempt` | check `--url` points at the ingester's mirror path, and check this host's clock |
| `mirror push STOPPED: this h2a root does not know the instance being mirrored` | fix `--instance` / `H2A_ROOT` — nothing was ever sent |
| `mirror push NOT STARTED: the push target is not a usable http(s) URL` | fill in / fix the `--url` in `ExecStart` |

### Why a local misconfiguration terminates instead of retrying

A wrong `H2A_ROOT` — a root where this instance never registered — cannot
self-heal. If the daemon just kept retrying it, nothing would ever be sent while
`systemctl status` reported `active (running)` indefinitely. Downstream, the feed
would behave correctly and start reporting those rows `stale` after ~2× the push
interval, because `mirroredAt` stopped advancing.

That is the problem: the two layers would **disagree**, and the honest one would
be the *far* one. `systemctl status` (right next to the fault, on the operator's
own machine) would say healthy, while a staleness flag in a web UI nobody is
watching would be the only truthful signal. The signal nearest the fault must be
at least as honest as the one furthest from it — so a non-self-healing local
failure exits 1 and says why. Transient network failures are the opposite case:
they *can* self-heal, so those keep looping.

Between the stop reasons above and the per-cycle counts below, `systemctl status`
plus `journalctl` are enough to tell "pushing real data", "pushing an empty
mirror", "being refused", "cannot build", and "stopped on purpose" apart —
without consulting the feed at all.

The unit carries `RestartPreventExitStatus=1` precisely so those stops are
respected — **do not remove that line**, or systemd will turn a deliberate stop
back into an endless retry against an endpoint that is saying no.

## Run it by hand first

The daemon is opt-in at the CLI too: `h2a remote mirror` **with no
`--interval-ms` is still exactly the one-shot it always was**. Verify a single
push is accepted before arming any unit.

**Why, concretely — two reasons, both about things that look fine for a long
time.**

*It discloses metadata repeatedly.* Daemon-ising the push means the payload —
your registrations, your live-session presence, and your subagent NHI bindings —
leaves this host every 20 seconds instead of once when you asked for it. That
envelope is **signed, but not encrypted**: the signature proves who wrote it, it
does not hide what it says. A mistyped `--url` therefore does not merely fail, it
*keeps disclosing that metadata* to whatever host answers — and if that host
returns a 2xx, the journal logs a contented `ok` every cycle while it happens.

*A misconfigured root can look healthy at the unit level.* A one-shot tells you
immediately whether this root can even build a mirror for this instance. Skip it,
and the failure you get instead is the one described above — a unit that reads
`active (running)` while the only honest signal is a staleness flag in a web UI
you are not watching.

One-shot first, and read the response:

```sh
h2a remote mirror --url <endpoint> --instance <id> --private-key <pem>   # one-shot
h2a remote mirror --url <endpoint> --instance <id> --private-key <pem> \
  --interval-ms 20000 --max 3                                            # 3 cycles, then stop
```
