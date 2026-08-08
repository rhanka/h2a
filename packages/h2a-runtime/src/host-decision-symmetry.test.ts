/**
 * Restore↔act host-decision symmetry (folded into #199).
 *
 * The defect this file pins: restore used to RE-IMPLEMENT the host-choice
 * rules (persisted kind wins, dual-host fails closed) instead of consuming
 * `resolveManagedHost` — a DUPLICATED INVARIANT in two places: same rule,
 * two codes, nothing binding them, both green, and nothing reddens the day
 * one side moves. Restore now derives every per-session host decision from
 * the ONE resolver (its single batch snapshot injected as `probes`), and
 * this file is the binding: the SAME input goes through the act path's
 * decision function AND the OBSERVABLE restore plan, and must come out as
 * the SAME host decision — especially on `ambiguous` and `unknown`. If
 * either side is hardened alone, this file reddens.
 *
 * SCOPE: this file asserts the two paths reach the SAME host DECISION; the
 * EFFECT — that the ambiguous/dual-host session is actually DROPPED from the
 * restore plan — is guarded separately by
 * RESTORE_PERSISTED_DUAL_HOST_IDENTITY_FAILS_CLOSED
 * (restore-live-recovery.test.ts). If that test is removed, this file does
 * NOT cover the loss.
 *
 * Everything here is pure: injected registry entries, injected probes, no
 * live tmux/native host is ever consulted.
 */
import { describe, expect, it } from "vitest";

import { resolveManagedHost, type RegistryEntry } from "./registry.js";
import { dropDualHostIdentities, registrySessions } from "./restore.js";

type LegacySessionEvidence = import("./restore.js").LegacySessionEvidence;
type ManagedLiveLookup = import("./restore.js").ManagedLiveLookup;

const HOME = "/home/host-symmetry-test";
const CONV_UUID = "5a6b7c8d-1234-4abc-9def-0123456789ab";
const iso = new Date().toISOString();

const evidence: LegacySessionEvidence = {
  home: "/nonexistent-evidence-home",
  liveTmuxSessions: [],
};

const row = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  id: "lane",
  label: "lane",
  convId: CONV_UUID,
  tool: "claude",
  kind: "local-native",
  cwd: `${HOME}/src/proj`,
  tmuxSession: "h2a-lane",
  sessionClass: "human",
  source: "run",
  enrolledAt: iso,
  lastSeenAt: iso,
  ...over,
});

/**
 * One comparable decision shape for both paths. "host" carries the exact
 * kind + managed name an act/tab would be served on; the refuse verdicts are
 * the two fail-closed outcomes this file pins.
 */
type HostDecision =
  | { verdict: "host"; kind: "local-native" | "local-tmux"; name: string }
  | { verdict: "refuse-ambiguous" }
  | { verdict: "refuse-unknown" };

/**
 * The ACT path's decision: resume/attach/stop all call resolveManagedHost on
 * the identity's managed name; recorded/discovered serve the act on that
 * host, ambiguous and unknown refuse it (fail closed).
 */
function actDecision(
  target: string,
  entries: RegistryEntry[],
  probes?: Parameters<typeof resolveManagedHost>[2],
): HostDecision {
  const r = resolveManagedHost(target, entries, probes);
  if (r.state === "recorded" || r.state === "discovered") {
    return { verdict: "host", kind: r.kind, name: r.name };
  }
  if (r.state === "ambiguous") return { verdict: "refuse-ambiguous" };
  if (r.state === "unknown") return { verdict: "refuse-unknown" };
  throw new Error(`unexpected act resolution for this fixture: ${r.state}`);
}

/**
 * The RESTORE path's decision, read off the OBSERVABLE plan
 * (registrySessions + dropDualHostIdentities) — deliberately NEVER off the
 * resolver directly, so a restore that re-forked its own host logic would
 * diverge here and redden the symmetry assertions.
 */
function restoreDecision(
  entries: RegistryEntry[],
  liveView?: ManagedLiveLookup,
): HostDecision {
  const sessions = registrySessions(HOME, entries, undefined, evidence, liveView);
  const { kept, ambiguousNames } = dropDualHostIdentities(sessions);
  if (ambiguousNames.length > 0) return { verdict: "refuse-ambiguous" };
  const hosted = kept.find(
    (s) => s.hostKind !== undefined && s.managedName !== undefined,
  );
  if (hosted !== undefined) {
    return {
      verdict: "host",
      kind: hosted.hostKind!,
      name: hosted.managedName!,
    };
  }
  // No hosted tab was emitted for these single-identity fixtures: the plan
  // failed closed (unknown host state yields no tab at all).
  return { verdict: "refuse-unknown" };
}

describe("restore consumes the ONE resolver — no duplicated host invariant", () => {
  it("RESTORE_AND_ACT_PATHS_RESOLVE_THE_SAME_HOST_DECISION_FOR_AMBIGUOUS_AND_UNKNOWN", () => {
    // AMBIGUOUS — one exact managed identity recorded on BOTH local hosts.
    const dual = [
      row({ kind: "local-native" }),
      row({ id: "lane-legacy", kind: "local-tmux" }),
    ];
    const actOnDual = actDecision("h2a-lane", dual);
    // Not vacuous: the act side must actually be the ambiguous refusal.
    expect(actOnDual).toEqual({ verdict: "refuse-ambiguous" });
    expect(restoreDecision(dual)).toEqual(actOnDual);

    // UNKNOWN — an identity with no readable persisted match whose host
    // probes FAIL. Same probe answers injected on both sides: a probe
    // failure is never proof of death, so both paths must refuse to place
    // the session on any host.
    const orphan = [row({ tmuxSession: "orphan-lane" })];
    const unknownView: ManagedLiveLookup = () => ({ state: "unknown" });
    const actOnUnknown = actDecision("orphan-lane", orphan, {
      native: () => "unknown",
      tmux: () => "unknown",
    });
    expect(actOnUnknown).toEqual({ verdict: "refuse-unknown" });
    expect(restoreDecision(orphan, unknownView)).toEqual(actOnUnknown);
  });

  it("RESTORE_AND_ACT_PATHS_RESOLVE_THE_SAME_HOST_DECISION_FOR_RECORDED_KINDS", () => {
    // Control cases: a single recorded row of each kind must come out as the
    // SAME exact host + managed name through both paths — and the recorded
    // host must win REGARDLESS of liveness (a dead snapshot changes nothing:
    // liveness gates the act, never which host serves it).
    const deadView: ManagedLiveLookup = () => ({ state: "dead" });

    const native = [row({ kind: "local-native" })];
    const actOnNative = actDecision("h2a-lane", native);
    expect(actOnNative).toEqual({
      verdict: "host",
      kind: "local-native",
      name: "h2a-lane",
    });
    expect(restoreDecision(native)).toEqual(actOnNative);
    expect(restoreDecision(native, deadView)).toEqual(actOnNative);

    const tmux = [row({ kind: "local-tmux" })];
    const actOnTmux = actDecision("h2a-lane", tmux);
    expect(actOnTmux).toEqual({
      verdict: "host",
      kind: "local-tmux",
      name: "h2a-lane",
    });
    expect(restoreDecision(tmux)).toEqual(actOnTmux);
    expect(restoreDecision(tmux, deadView)).toEqual(actOnTmux);
  });
});
