// Plan a later withheld window from earlier actual acceptance windows.
// Sender startup jitter can erase nominal release-offset separation.
// This planner changes only how long the private controller lease is held;
// the independent verifier still judges actual signed inputs and reads.
import { verifyWakePhases, WAKE_SEPARATION_MARGIN_MS } from './xcli-ci-check.mjs';

export function wakeSeparationTargets(cells) {
  return cells.filter(cell => cell.woke === true && verifyWakePhases(cell).length === 0)
    .map(({ wakeWindows: w }) => ({ aStartMs: w.wakeAt - w.barrierAt,
      aEndMs: w.wakeAt + w.dMs - w.barrierAt,
      timestampUncertaintyMs: w.timestampUncertaintyMs }));
}

export function planWakeRelease({ barrierAt, deliveryAt, w1Ms, releaseOffsetMs,
  timestampUncertaintyMs = 1, targets = [] }) {
  const nominal = deliveryAt + w1Ms + releaseOffsetMs;
  const feasible = (Array.isArray(targets) ? targets : []).flatMap(target => {
    if (!target || !['aStartMs', 'aEndMs', 'timestampUncertaintyMs']
      .every(key => Number.isSafeInteger(target[key]) && target[key] >= 0) ||
      target.aEndMs <= target.aStartMs) return [];
    const marginMs = Math.max(WAKE_SEPARATION_MARGIN_MS,
      timestampUncertaintyMs + 1, target.timestampUncertaintyMs + 1);
    // A late delivery cannot contain this earlier acceptance window.
    if (deliveryAt - barrierAt + marginMs > target.aStartMs) return [];
    return [{ target, releaseAt: Math.max(nominal, barrierAt + target.aEndMs + marginMs + 1) }];
  }).sort((a, b) => a.releaseAt - b.releaseAt);
  return feasible[0] ?? { releaseAt: nominal, target: null };
}
