# h2a durable supervisor — systemd `--user` unit

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

# 2. (If needed) edit ExecStart to the absolute path of `h2a`
#    and Environment=H2A_ROOT to your h2a root.
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
