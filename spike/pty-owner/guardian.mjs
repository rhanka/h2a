// Exact source wrapper from packages/h2a-runtime/src/pty.ts (origin/main).
export const original = [
  'h2a_expected_parent=$1', 'shift',
  '[ "$PPID" -eq "$h2a_expected_parent" ] || { builtin kill -KILL -- "-$$"; exit 127; }',
  'h2a_forward() { local h2a_signal=$1; trap "" "$h2a_signal"; builtin kill "-$h2a_signal" -- "-$$" 2>/dev/null || :; trap "h2a_forward $h2a_signal" "$h2a_signal"; }',
  'h2a_force() { trap - HUP USR1 USR2; builtin kill -KILL -- "-$$"; }',
  'trap h2a_force HUP', "trap 'h2a_forward INT' INT", "trap 'h2a_forward TERM' TERM",
  'trap h2a_force USR1 USR2', '"$@" < /dev/tty &', 'h2a_child=$!',
  'while true; do', '  wait "$h2a_child"', '  h2a_status=$?',
  '  kill -0 "$h2a_child" 2>/dev/null || exit "$h2a_status"', 'done',
].join('\n');
// Experimental fix, only in this spike. Bash expands self fd list, then closes
// each inherited fd before spawning CLI. This also closes the inherited listener.
const closeForeign = 'for spike_fd_path in /proc/self/fd/*; do spike_fd=${spike_fd_path##*/}; if [[ $spike_fd -ge 3 ]]; then eval "exec ${spike_fd}>&-" 2>/dev/null; fi; done';
export const hygienic = original.replace('"$@" < /dev/tty &', `${closeForeign}\n"$@" < /dev/tty &`);
