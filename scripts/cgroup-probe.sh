#!/usr/bin/env bash
# WP7 resource-gov Lot 0 — cgroup capability/containment probe (diagnostic, no root).
# Answers: can h2a enforce a hard per-scope memory cap + freeze, without root, on this host?
# Creates a THROWAWAY transient --user scope, inspects it, then cleans up. Touches nothing real.
set -uo pipefail
pass(){ echo "  PASS  $*"; }
fail(){ echo "  FAIL  $*"; }
info(){ echo "  ..    $*"; }

echo "== 1. cgroup v2 + user delegation =="
CGROOT=/sys/fs/cgroup
if [ -f "$CGROOT/cgroup.controllers" ]; then pass "cgroup v2 unified at $CGROOT"; else fail "no cgroup v2 unified mount"; fi
USRSLICE="$CGROOT/user.slice/user-$(id -u).slice/user@$(id -u).service"
if [ -d "$USRSLICE" ]; then
  info "user manager slice: $USRSLICE"
  info "controllers available here: $(cat "$USRSLICE/cgroup.controllers" 2>/dev/null)"
  SUBTREE=$(cat "$USRSLICE/cgroup.subtree_control" 2>/dev/null)
  info "subtree_control (delegated to children): ${SUBTREE:-<empty>}"
  if grep -qw memory <<<"$SUBTREE"; then pass "memory controller DELEGATED to user children (hard cap on child scopes possible)"
  else fail "memory NOT in subtree_control → child scopes may NOT enforce MemoryMax (likely needs Delegate=)"; fi
else
  fail "no user@ manager slice — systemd --user may be unavailable"
fi

echo "== 2. systemd --user available? =="
if systemctl --user is-system-running >/dev/null 2>&1 || systemctl --user show >/dev/null 2>&1; then
  pass "systemd --user instance reachable"
else
  fail "systemd --user NOT reachable (no user manager / DBus session) → no systemd-run --user"
fi

echo "== 3. create a transient --user scope with MemoryMax and inspect it =="
UNIT="h2aprobe-$$"
# Run a tiny, harmless sleeper inside a capped scope; capture its cgroup path.
if systemd-run --user --scope -q --unit="$UNIT" -p MemoryMax=64M -p MemorySwapMax=0 \
     bash -c 'cat /proc/self/cgroup; sleep 8' >/tmp/h2aprobe.cg 2>/tmp/h2aprobe.err & then
  RUNPID=$!
  sleep 1.5
  REL=$(sed 's/^0:://' /tmp/h2aprobe.cg 2>/dev/null | head -1)
  SCOPE="$CGROOT$REL"
  if [ -n "$REL" ] && [ -d "$SCOPE" ]; then
    pass "scope created: $REL"
    MM=$(cat "$SCOPE/memory.max" 2>/dev/null)
    if [ "$MM" = "67108864" ]; then pass "memory.max ENFORCED = 64M (67108864)"; else fail "memory.max=$MM (expected 67108864 → cap NOT applied)"; fi
    info "memory.current: $(cat "$SCOPE/memory.current" 2>/dev/null) bytes"
    [ -f "$SCOPE/memory.events" ] && pass "memory.events readable (accounting works)" || fail "no memory.events"
    if [ -w "$SCOPE/cgroup.freeze" ]; then
      echo 1 > "$SCOPE/cgroup.freeze" 2>/dev/null && sleep 0.3
      FRZ=$(cat "$SCOPE/cgroup.freeze" 2>/dev/null)
      [ "$FRZ" = "1" ] && pass "cgroup.freeze WRITABLE + froze (freeze/standby possible)" || fail "freeze write did not take (got '$FRZ')"
      echo 0 > "$SCOPE/cgroup.freeze" 2>/dev/null
    else
      fail "cgroup.freeze not writable → no cgroup-level freeze"
    fi
    info "memory.oom.group present: $([ -f "$SCOPE/memory.oom.group" ] && echo yes || echo no) (anti-partial-kill)"
  else
    fail "could not resolve the scope cgroup path (rel='$REL')"
    info "stderr: $(head -2 /tmp/h2aprobe.err 2>/dev/null)"
  fi
  wait "$RUNPID" 2>/dev/null
else
  fail "systemd-run --user --scope FAILED: $(head -2 /tmp/h2aprobe.err 2>/dev/null)"
fi
systemctl --user stop "$UNIT.scope" >/dev/null 2>&1
rm -f /tmp/h2aprobe.cg /tmp/h2aprobe.err

echo "== 4. system-wide pressure signals (for the manager) =="
[ -f /proc/pressure/memory ] && pass "PSI /proc/pressure/memory present: $(head -1 /proc/pressure/memory)" || fail "no PSI memory"
info "MemAvailable: $(awk '/MemAvailable/{print $2" "$3}' /proc/meminfo)  of MemTotal: $(awk '/MemTotal/{print $2" "$3}' /proc/meminfo)"

echo "== VERDICT =="
echo "  (read the PASS/FAIL above: hard 36GB cap without root requires §1 memory-delegated + §3 memory.max enforced + cgroup.freeze; else fall back to graceful-only + refuse-new/deport)"
