# MH-L0 — foundations for 0.98.7

Authority: owner decisions of 2026-10-11, then spec v7
(`a7c98c83c7ac747b80401d8618c24b1ab974480d6ee853a0dd0d7d6adffe2c6e`),
amended for the independently reproduced Opus BX finding. Base is v0.98.5,
`e3fc1a52`; this branch does not integrate #316 or the moving .6 branches.

These internal leaf modules are not wired into a product strategy, CLI route,
central, shim, gateway or native host. Their code uses only Node builtins.
Build-time audit/prototype scripts and the executable peer stay outside the
published package. No fault switch or fixture key is added to a published API.

| MH-L0 output (§12) | Implementation / artifact | Nominal targeted proof |
|---|---|---|
| Canonical bytes and derivations (§4.5, §5.7) | `wire.js`, frozen test vectors | `mh-l0-wire.test.js` |
| Versioned records (§4–§8) | `schemas.js`, `formats.js`, [schemas.json](schemas.json) | `mh-l0-formats.test.js` |
| Private durable state (§6.2) | `state.js` | `mh-l0-state.test.js` |
| Marker v1/v2 (§4.3) | Closed v2 schema, legacy discriminator, decoy/reference separation | Published v1 reader extracted from Git; no installed dist |
| Lock domain and placement (§4.2–4.4) | `authority.js`, `.6` classifier dependency | `mh-l0-authority.test.js` |
| Physical layout (§8.2) | Canonical prefix/UID digest, dev/ino comparison, shared-writable prefix refusal | Same authority file |
| Image and native manifest (§8.3) | `image.js`, static literal-edge auditor | `mh-l0-image.test.js` |
| Native feasibility (§1.4, §8.3) | Direct C++ build of actual node-pty, real legacy probe | `mh-l0-native.test.js` |
| Heritage audit / freeze inputs (§8.5) | [heritage-source-manifest.json](heritage-source-manifest.json), Git audit script | `mh-l0-heritage.test.js` |
| BX / measured npm contract (§8.7) | `entry.js`, [BX-QF.md](BX-QF.md) | `mh-l0-npm.test.js` |
| Evidence vectors and network peer (§5.7, §10.2) | `evidence.js`, test-only peer executable | `mh-l0-peer.test.js` |

See [CONTRACT.md](CONTRACT.md) for bytes, persistence and consumer obligations;
[ESTIMATES.md](ESTIMATES.md) for the revised remaining effort.
`red-green-evidence.json` preserves commands, exit codes and complete tool outputs.
Initial new-feature reds are missing-module failures, separately distinguished
from reproduced assertion regressions (BX, epoch, frame projection, digest).

## Required later qualification

The nominal proofs above are **L0 foundations**, not completion of the release
matrix rows whose names they reference. In particular:

| Not proved here | Responsible lot / observable gate |
|---|---|
| True v1 starter/bridge facing a built .7 central, ping/readiness and no reclaim | MH-L2/MH-L5; M18b/M18c REL with real dists |
| Real second netns/UID, Node 20 abstract bind, inherited-FD campaign | MH-L2/MH-L5; M04b/M04c in CI/VM |
| Retirement of an anchor's disappeared netns within the same boot | MH-L2; prove old ownership retired before replacing the shared anchor; no timeout/HTTP fallback |
| Full durable H4/component state machines and atomic reader acceptance/ACK cache | MH-L2–MH-L6; U05/U06/T5 and M10b/M23/M24 |
| Static edges beyond literal imports/require/URL, whole release dependency closure | MH-L1/MH-L6; closed bundles/internal edges plus executable load traces and U12 decoys |
| Published shrinkwrap, exact runtime, integrated transport and pinned no-Python toolchain | MH-L1/MH-L6; U10 on the actual published payload, including Node 20/22 |
| Byte freeze against final .6 dist | MH-L1/MH-L8; U13 or real relaunch U07/U11 for every difference |
| Source/shims .7 driven by the peer, G0/G1 overlap, checkpoint effects and all cuts | MH-L3–MH-L5; extend the L0 peer; no substitution of product machines |
| Actual npm overwrite during a real cold stop | MH-L6; no commit-stop and visible report at each of three entry checks |
| Real Claude, gateway measures, endurance and release review | MH-L7/MH-L8 |

No suite was silently skipped. Missing qualified profiles remain explicit gates.
QF/QC/QD/QE/QG are not ratified by this branch. The external-launcher layout is
prepared; final entrypoint policy is deliberately not frozen before QF.
