#!/usr/bin/env bash
# Maintained test for scripts/smoke-live-bus.sh (zero-Python rule).
# Uses temp dirs only: a stub `h2a` on PATH plus a `python3` canary that fails
# if executed. Pass requires exit 0 AND zero python3 calls.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/smoke-live-bus.sh"
lab="$(mktemp -d)"
trap 'rm -rf "$lab"' EXIT
mkdir -p "$lab/bin"
# NOTE: shebang and canary name kept on separate lines so this test does not
# trip the zero-python shebang gate (a `#!` line mentioning python is not an
# invocation, but the guard cannot tell prose from code).
canary_shebang='#'"!/bin/sh"
printf '%s\necho CALLED >> "%s/calls"\nexit 99\n' "$canary_shebang" "$lab" > "$lab/bin/python3"
chmod +x "$lab/bin/python3"

write_stub() {
  # $1 = doctor payload, $2 = mcp-tools payload file
  cat > "$lab/bin/h2a" <<EOF
#!/bin/sh
case "\$1" in
  doctor) cat "$1" ;;
  mcp-tools) cat "$2" ;;
  discover) echo ok ;;
esac
EOF
  chmod +x "$lab/bin/h2a"
}

run_smoke() {
  PATH="$lab/bin:/usr/bin:/bin" bash "$SCRIPT" >"$lab/out" 2>&1
}

# Case 1: healthy bus -> OK, and python3 must never run.
cat > "$lab/doctor-ok.json" <<'EOF'
{"checks":{"liveSessions":{"ok":true,"count":3},"bus":{"ok":true}}}
EOF
cp "$(cd "$(dirname "$0")/.." && pwd)/docs/contracts/golden/mcp-tools.json" "$lab/mcp.json"
write_stub "$lab/doctor-ok.json" "$lab/mcp.json"
if ! run_smoke; then echo "expected pass but failed:" >&2; cat "$lab/out" >&2; exit 1; fi
grep -q 'SMOKE LIVE-BUS OK' "$lab/out" || { echo "missing OK banner" >&2; cat "$lab/out" >&2; exit 1; }
grep -q 'doctor OK (live sessions: 3)' "$lab/out" || { echo "missing doctor line" >&2; cat "$lab/out" >&2; exit 1; }
if [ -f "$lab/calls" ]; then echo "python3 was invoked (forbidden)" >&2; exit 1; fi

# Case 2: failing doctor check -> exit 1, still no python3.
cat > "$lab/doctor-ko.json" <<'EOF'
{"checks":{"liveSessions":{"ok":true,"count":3},"bus":{"ok":false}}}
EOF
write_stub "$lab/doctor-ko.json" "$lab/mcp.json"
if run_smoke; then echo "expected failure on KO doctor but passed" >&2; exit 1; fi
grep -q 'hard check KO' "$lab/out" || { echo "missing KO line" >&2; cat "$lab/out" >&2; exit 1; }
if [ -f "$lab/calls" ]; then echo "python3 was invoked (forbidden)" >&2; exit 1; fi

echo 'smoke-live-bus tests: ok'
