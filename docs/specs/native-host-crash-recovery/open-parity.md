# Parité native-CLI — objectif suivi (spec/open-parity)

Owner requirement (verbatim 20/10): « tu DOIS faire des tests de démarrage
lorsqu'il y a bcp de session (meme si simulé) pour assurer un démarrage SANS
ovehead a la cli native ».

Conductor decision 21/10: PR #390 merges on crash/lock/bounded-startup scope.
Native-CLI parity becomes a dedicated spec lane (spec/open-parity). It is a
REPORTED tracked objective, not a merge gate for #390. It becomes BLOCKING
when the parity lane lands; the release workflow keeps requiring the
non-regression gate (a) and the incident scenarios until then.

## Target

Same deterministic CLI launched directly vs through h2a (`run` fresh and
`run --resume`), time to usable prompt + first I/O ack, paired per
repetition, ≥3 samples per cell:

- paired overhead median ≤ +250 ms
- paired overhead p95 ≤ +500 ms

`restore` is reported separately (full terminal/GUI restoration per tab).

## Measured on this head (CI run 39540422206, head bcdfe0d75, no-systemd witness)

Paired overhead median/p95 vs direct CLI, 1 request, empty registry:

| mode | host | médiane | p95 | Δ médiane vs +250 | Δ p95 vs +500 |
|---|---|---:|---:|---:|---:|
| fresh | live | +732 | +772 | +482 | +272 |
| fresh | absent | +845 | +862 | +595 | +362 |
| fresh | killed | +838 | +847 | +588 | +347 |
| resume | live | +739 | +861 | +489 | +361 |
| resume | absent | +855 | +858 | +605 | +358 |
| resume | killed | +845 | +862 | +595 | +362 |
| restore | live | +1143 | +1508 | reporté | reporté |
| restore | absent | +1219 | +1220 | reporté | reporté |
| restore | killed | +1230 | +1265 | reporté | reporté |

Deterministic CLI, no gateway/sidecar. Spent in Node loading + sequential
op.js helpers (see open-latency-analysis in reviews). NOT reached on this
head — the gap is owned by the parity lane, with the client-partagé,
allègement CLI, attach événementiel and host-bootstrap pistes already
analysed there.

## Qualification wiring (this PR)

- Every matrix cell publishes `startup-matrix-parity-report` (paired
  median/p95 + delta to target) and appends the job summary table
  (« REPORTED tracked objective (spec/open-parity, non-blocking) »).
- Nothing is asserted on parity; nothing is skipped: the job runs, the
  numbers publish, the release gate requires the non-regression baselines
  (startup-baselines.json) and the incident scenarios instead.
