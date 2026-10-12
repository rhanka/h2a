# Test and release execution evidence

`run-test-gates.mjs` still runs every gate and reports every verdict. The Node,
Track and runtime steps also require results from the current invocation, written
under a unique temporary directory. A report cleanup failure invalidates evidence.

All three runners use `test-execution-evidence.mjs`: file and assertion identities
must be unique, every discovered file must be present, failures remain failures,
and counters must equal the observed statuses. Skips are rejected unless the exact
file, assertion and status appear in `test-skip-exceptions.json`. A comment or a
skip declaration never grants an exception. The named train scenarios cannot skip.

`test-inventory.json` preserves the existing required files and normative test
identities. Discovery also includes new suites. Update the inventory deliberately
when changing a required test; do not regenerate it during a test run. The named
spec-v5 requirements in `spec-0985-test-inventory.json` become mandatory when the
runtime manifest is `0.98.5`, including the two crash suites. This gates checkout
retains its existing `0.98.4` manifests; it cannot run the packaged `0.98.5` smoke
until the conductor integrates the runtime fixes and version bump.

Vitest configurations are literal data contracts. Unsupported effective options
are rejected, including hooks that suppress unhandled asynchronous errors.

`release-execution-plan.json` is the complete qualified execution plan, checked
against parsed YAML. YAML comments and display names are excluded; every script
line is retained, including comment-shaped lines inside quotes. All executable
fields, action inputs, contexts, job edges and step ordering are checked. Changing
the pipeline requires an explicit reviewed update to this contract and its
negative controls. Additional checkouts, shells, environment overrides, artifact
origins, mutation steps or publication routes fail qualification.

Verify builds the three lockstep tarballs once. Smoke installs those same local
tarballs and checks that their bytes remain unchanged. Upload immediately follows
smoke. Publish downloads the current run's artifact, validates its release SHA and
hashes, then rechecks hashes immediately before publishing each tarball. Track
keeps its existing workspace publication exception.

The smoke qualification executes the real orchestration with simulated packaged
dependencies and observes cold-boot seeding, local installs, faulty connection
bytes and close, stderr close, unchanged PID/generation, present-then-gone prune,
and PTY marker commands after both faults. It is a qualification of the smoke;
the conductor must additionally execute the packaged smoke on the integrated
candidate and the real GitHub negative release run required by R8.5.
