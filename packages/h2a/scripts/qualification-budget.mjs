// An execution is one app-server session (forks included), or the CLI probe.
// An iteration is one model call, INCLUDING delegated subagent model calls.
export const VIBE_QUALIFICATION_PLAN = Object.freeze([
  { id: 'phase1-a', phase: 1, kind: 'session', maxIterations: 3, maxPrice: 0.15, maxSeconds: 90 },
  { id: 'phase1-b', phase: 1, kind: 'session', maxIterations: 3, maxPrice: 0.15, maxSeconds: 90 },
  { id: 'cli-probe', phase: 1, kind: 'probe', maxIterations: 3, maxPrice: 0.10, maxSeconds: 90 },
  { id: 'phase2-origin', phase: 2, kind: 'session', maxIterations: 3, maxPrice: 0.175, maxSeconds: 90 },
  { id: 'phase2-copy', phase: 2, kind: 'session', maxIterations: 3, maxPrice: 0.175, maxSeconds: 90 }
]);
export const PHASE2_RECIPE = Object.freeze({
  fork: { method: 'session/fork', attach: false, beforeDelegation: true },
  origin: ['parent requests delegation', 'child model call', 'parent final answer'],
  copy: ['request benign command', 'request guarded CLI command', 'final answer'],
  oracle: 'Origin delegates AFTER fork: one record proves both parent-only behavior and the still-active origin. Copy: allow/deny and no record modification.',
  scope: 'session/fork attaches by default; this recipe explicitly passes attach:false. /branch and ACP forks attach on resume.'
});
export class QualificationBudget {
  constructor(plan = VIBE_QUALIFICATION_PLAN, now = Date.now) {
    this.plan = plan; this.now = now; this.start = now(); this.executions = new Map();
    if (plan.length > 5 || plan.reduce((n, e) => n + e.maxIterations, 0) > 15 || plan.reduce((n, e) => n + e.maxPrice, 0) > 0.75000001 || plan.reduce((n, e) => n + e.maxSeconds, 0) > 450)
      throw new Error('qualification envelope exceeded');
    for (const e of plan) if (e.maxIterations > 3 || e.maxPrice > 0.25 || e.maxSeconds > 90) throw new Error('per-execution envelope exceeded');
    for (const phase of [1, 2]) if (plan.filter(e => e.phase === phase && e.kind === 'session').length > 2) throw new Error('too many sessions, forks included');
  }
  begin(id) {
    this.check();
    if (this.executions.has(id)) throw new Error('automatic retry/restart forbidden');
    const spec = this.plan.find(e => e.id === id); if (!spec) throw new Error('unbudgeted execution');
    this.executions.set(id, { ...spec, started: this.now(), iterations: 0, price: 0 }); return spec;
  }
  restorePhase1(entries, elapsed) {
    if (!Array.isArray(entries) || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 450_000) throw new Error('invalid prior accounting');
    const restored = new Map();
    for (const entry of entries) {
      const spec = this.plan.find(e => e.phase === 1 && e.id === entry.id);
      if (!spec || restored.has(entry.id) || !Number.isInteger(entry.iterations) || entry.iterations < 0 || entry.iterations > spec.maxIterations ||
        !Number.isFinite(entry.price) || entry.price < 0 || entry.price > spec.maxPrice + 1e-9) throw new Error('invalid prior accounting');
      restored.set(entry.id, { ...spec, iterations: entry.iterations, price: entry.price, started: this.now() - elapsed });
    }
    if (restored.size !== this.plan.filter(e => e.phase === 1).length) throw new Error('incomplete prior accounting');
    this.executions = restored; this.start = this.now() - elapsed;
  }
  remaining() { return Math.max(0, 450_000 - (this.now() - this.start)); }
  account(id, { modelCalls, price }) {
    if (!Number.isInteger(modelCalls) || modelCalls < 0 || !Number.isFinite(price) || price < 0) throw new Error('native accounting unavailable');
    const e = this.executions.get(id); if (!e) throw new Error('unknown execution');
    e.iterations += modelCalls; e.price += price;
    if (e.iterations > e.maxIterations || e.price > e.maxPrice + 1e-9) throw new Error('native execution budget reached');
    this.check(id);
  }
  check(id) {
    if (this.now() - this.start >= 450_000) throw new Error('global watchdog reached');
    const e = this.executions.get(id);
    if (e && this.now() - e.started >= e.maxSeconds * 1000) throw new Error('execution watchdog reached');
  }
}
