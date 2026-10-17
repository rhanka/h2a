# Focus decision dossier kit

- [ ] Objective: default portable Focus design-system dossiers with mobile ecosystem canvases.
- [ ] Scope: h2a Focus CLI, isolated Svelte consumer, reusable catalog, template, skill and targeted tests.
- [x] Guardrails: owner confinement; no installed h2a, host state, Python, full local suite or main writes.
- [x] Allowed: packages/h2a/focus-kit/**, src/focus-build.ts, bin.ts, CLI help, package metadata;
      packages/track/skills/present-decision/**; named tests; build script, CI and documentation.
- [x] Forbidden: reference kit writes, other runtime behavior and long-term DS renderer ownership.
- [x] Design: use h2a focus build, a native Focus extension, and bundle @sentropic/focus/validate unchanged.
- [x] Lot 1: closed document template, ecosystem catalog, validator/build command; focus-build.test.js.
- [x] Lot 2: DS Svelte renderer, light/dark, cards, pinch zoom, portable artifact; browser fixture.
- [ ] Lot 3: default skill, exact command, documentation, targeted skill and schema tests.
- [ ] Lot 4: package verification, push own branch, English PR, per-job CI report.
- [x] Feedback: harness review selection-failed; installed h2a/mesh access forbidden by owner.
- [x] Feedback: no Track writes through installed tools; no consensus or review identity claimed.
- [x] Feedback: generated renderer and lockfile exceed suggested commit size; bounded to requested consumer.
