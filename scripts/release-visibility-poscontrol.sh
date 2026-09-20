#!/usr/bin/env bash
# Positive control for the release.yml visibility-check fix.
# Proves the fixed step: (1) STILL FAILS when the publish genuinely did not happen
# (never-published = blocking), (2) does NOT fail when the publish succeeded but the
# registry visibility lags (benign, transitory), (3) skips + passes when already
# published (idempotency preserved). Distinction is gated on `npm publish` exit code.
set -u

# --- the FIXED step logic under test (one package; sleep is a no-op here) ---
sleep() { :; }   # skip the 10s waits in the test
run_step() {
  local pkg="$1" v="$2"
  if npm view "$pkg@$v" version >/dev/null 2>&1; then
    echo "  $pkg@$v already on registry; skipping publish."
  else
    # A FAILED publish is the real, blocking failure ("never published").
    if ! npm publish --workspace "$pkg" --access public; then
      echo "  ::error::$pkg@$v: npm publish failed (not published)." >&2
      return 1
    fi
  fi
  # Package IS published now (pre-existing or just accepted by npm). Registry
  # VISIBILITY can lag a successful publish; that lag is benign and must NOT fail
  # the step. Poll to confirm propagation, WARN if slow, never exit non-zero.
  local attempt
  for attempt in $(seq 1 18); do
    if npm view "$pkg@$v" version >/dev/null 2>&1; then
      echo "  $pkg@$v visible (attempt $attempt)."
      return 0
    fi
    if [[ "$attempt" -eq 18 ]]; then
      echo "  ::warning::$pkg@$v was published but not yet visible after 18 attempts — propagation lag; NOT failing." >&2
      return 0
    fi
    sleep 10
  done
}

# --- stub npm: behaviour controlled by env STUB_VIEW / STUB_PUBLISH ---
npm() {
  case "$1" in
    view)    return "${STUB_VIEW:-1}" ;;      # 0 = visible/exists, 1 = not
    publish) echo "    (stub) npm publish -> exit ${STUB_PUBLISH:-0}"; return "${STUB_PUBLISH:-0}" ;;
    *)       return 0 ;;
  esac
}

fail=0
echo "CASE 1 — genuine non-publish (npm publish FAILS): must BLOCK (exit != 0)"
STUB_VIEW=1 STUB_PUBLISH=1 run_step "@sentropic/h2a" "0.97.4"; rc=$?
echo "  => rc=$rc  $([[ $rc -ne 0 ]] && echo 'PASS (still blocks a real non-publish)' || { echo 'FAIL (false success!)'; fail=1; })"
echo
echo "CASE 2 — published but never visible (publish OK, view lags): must NOT fail (exit 0, warns)"
STUB_VIEW=1 STUB_PUBLISH=0 run_step "@sentropic/h2a" "0.97.4"; rc=$?
echo "  => rc=$rc  $([[ $rc -eq 0 ]] && echo 'PASS (no false failure of a succeeded publish)' || { echo 'FAIL (still false-fails!)'; fail=1; })"
echo
echo "CASE 3 — already on registry (idempotent skip): must pass (exit 0)"
STUB_VIEW=0 STUB_PUBLISH=0 run_step "@sentropic/h2a" "0.97.4"; rc=$?
echo "  => rc=$rc  $([[ $rc -eq 0 ]] && echo 'PASS (idempotency preserved)' || { echo 'FAIL'; fail=1; })"
echo
echo "RESULT: $([[ $fail -eq 0 ]] && echo 'ALL PASS' || echo 'SOME FAILED')"
exit $fail
