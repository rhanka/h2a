# Linux/macOS PTY batch ownership experiment

Owner mandate: 2026-10-17, B plus a bounded feasibility experiment; this branch
must never merge. Scope is this directory and the external spike2 report. No
product/runtime changes, installed distribution, live sessions, Track writes or
full test gates. Native binaries, sockets, HOME and XDG roots are disposable.

Reversible design decisions:

1. Node owner 2 starts owner 1 in this lab, but is not a subreaper. Linux's
   test supervisor uses a subreaper solely to collect orphan guardians in
   containers whose PID 1 does not reap. macOS uses launchd for those orphans.
2. A small native session guardian replaces the parent-death dependency. It
   owns/reaps its CLI and reports the exact wait status on a transferable
   SOCK_STREAM channel, retained until acknowledgment. It confines its CLI
   on last-owner channel EOF / terminal HUP, rather than on the first owner's
   death. The guardian stays the actual CLI parent and calls waitpid; owner 2
   receives its status, and cannot waitpid the CLI (ECHILD), on either OS.
   No guardian or owner requires PR_SET_PDEATHSIG or PR_SET_CHILD_SUBREAPER.
3. An N-API addon transfers master + status descriptors using SCM_RIGHTS on a
   private Unix SOCK_DGRAM socketpair (message boundaries on both OSes).
   A STREAM status channel provides last-owner EOF on both OSes. Children
   close inherited descriptors before exec; received FDs are CLOEXEC.
4. Freeze -> offer -> prepare -> commit. Owner 1 retains descriptors until
   preparation; owner 2 does not read staged descriptors. Inputs queue at the
   coordinator while a route is moving. Metadata includes partial control
   stream state and partial write offsets. Output remains in the PTY kernel
   buffer during the pause. Failed prepare/send resumes only the frozen batch.
5. After commit the sender closes its copies. Owner 1 exits automatically
   when empty. A failed batch must not stop unrelated I/O. This is not a
   durable crash-recovery protocol: commit ambiguity, machine crash and loss
   of owner 2 are explicit product work, not guarantees of this experiment.

Evidence: numbered inputs/ACKs, autonomous numbered output ticks, stable PIDs,
real interactive Bash/readline, kernel winsize and exact exit/signal status;
negative parent-death and exit-channel controls. Only named Node test files.
Run `node spike/pty-batch-handover/run.mjs`; it creates temporary HOME/XDG/TMP
before executing the one explicit Node test file. No dependencies installed.

Darwin differences: util.h/libproc instead of pty.h/procfs; bundle linking;
fcntl flags instead of Linux socket flags; complete close loop after fork
instead of close_range; launchd reaps orphan guardians. kqueue EVFILT_PROC /
NOTE_EXIT observes owner 1's death, but does not destroy a transferred CLI.
Liveness of the owner relationship comes from the retained STREAM endpoint.
Windows is excluded: ConPTY handles are not Unix PTY masters and cannot use
SCM_RIGHTS; it needs its own ownership/handle-transfer implementation.

## Review availability

status: selection-failed

observed-failure: harness/review requires installed h2a MCP with two eligible
cross-host reviewers and exact author model/effort. Installed h2a/live mesh
access is explicitly forbidden by the owner and no such MCP tool is available.
No external review dispatched and no consensus claimed. Harness recorder/Track
mutations and the harness full-suite gate are outside this experiment's scope.
Author host: codex; exact model/effort: unavailable in exposed session metadata.
Local adversarial checks are evidence only, not substitute peer consensus.
