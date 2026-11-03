import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertUpgradeAuthority } from './upgrade-authority.js';
import { assessNpmCommand } from './npm-command.js';
import { readState } from '../handover/state.js';

// CLI resume/abort dispatch over inter-transaction authority (F): the
// presented controller is checked first with CLI-level reasons (foreign vs
// revoked), then the engine re-checks the current process identity itself
// and reconciles or aborts. Read-only authority, engine-owned mutation:
// resume never advances a phase by itself, abort only closes a reversible
// (PREPARING/PREPARED) transaction, idempotently.
const invalid = () => { throw new Error('upgrade_dispatch_invalid'); };
const TXNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

function check(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) invalid();
  const { store, upgradeId, controller } = envelope;
  if (!store || typeof store.reconcile !== 'function' || typeof store.abort !== 'function' ||
    typeof upgradeId !== 'string' || !upgradeId ||
    (controller !== undefined && (!controller || typeof controller !== 'object' || Array.isArray(controller)))) {
    invalid();
  }
  return { store, upgradeId, controller };
}

export function resumeUpgrade(envelope = {}) {
  const { store, upgradeId, controller } = check(envelope);
  const grant = assertUpgradeAuthority({ store, upgradeId, controller });
  const tx = store.reconcile(upgradeId);
  return Object.freeze({ upgradeId, installationState: tx.installationState, controllerEpoch: grant.epoch });
}

export function abortUpgrade(envelope = {}) {
  const { store, upgradeId, controller } = check(envelope);
  const grant = assertUpgradeAuthority({ store, upgradeId, controller });
  const tx = store.abort(upgradeId);
  return Object.freeze({ upgradeId, installationState: tx.installationState, controllerEpoch: grant.epoch });
}

// Read-only overall status for `h2a upgrade status` (no upgradeId): the
// durable selection plus one row per journal transaction. Reads nothing
// outside the store state dir, writes nothing, advances no phase.
export function statusUpgrade(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) invalid();
  const { store } = envelope;
  if (!store || typeof store.status !== 'function' || typeof store.state !== 'string' || !store.state) invalid();
  const durable = readState(join(store.state, 'selected-build.json'), 'selection')?.value ?? null;
  let names;
  try {
    names = readdirSync(join(store.state, 'upgrade', 'transactions')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') names = [];
    else throw error;
  }
  const transactions = [];
  for (const name of names) {
    if (!TXNAME.test(name)) throw new Error('RECOVERY_BLOCKED:unknown_journal');
    const tx = store.status(name.slice(0, -5));
    transactions.push(Object.freeze({ upgradeId: tx.upgradeId, phase: tx.installationState,
      requestedTarget: tx.requestedTarget ?? null, updatedAt: tx.updatedAt ?? null }));
  }
  return Object.freeze({ durable, transactions: Object.freeze(transactions) });
}

// Upgrade-level successor gate: a recorded SUCCESSOR_FAILED component
// reservation beside the selection is a real failure (exit 1), never
// something a status or run may report as healthy. Absent control state
// means no successor is outstanding. Malformed control state fails closed.
export function assertNoSuccessorFailure(store) {
  if (!store || typeof store.state !== 'string' || !store.state) invalid();
  let control;
  try {
    control = readFileSync(join(store.state, 'component-control.json'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(control);
  } catch {
    throw new Error('successor_state_unreadable');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    typeof parsed.activeTransaction !== 'string' || !parsed.activeTransaction) {
    throw new Error('successor_state_unreadable');
  }
  let reservation;
  try {
    reservation = JSON.parse(readFileSync(join(store.state, parsed.activeTransaction), 'utf8'));
  } catch {
    throw new Error('successor_state_unreadable');
  }
  if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) {
    throw new Error('successor_state_unreadable');
  }
  if (reservation.state === 'SUCCESSOR_FAILED') throw new Error('successor_failed');
}

// Read-only unmanage preview for `h2a upgrade unmanage --dry-run`: the same
// quiescence and link preconditions `unmanageInstallation` enforces, without
// swapping the command link or writing the opt-out marker.
const QUIESCENT = new Set(['SELECTED', 'COMPLETED', 'ABORTED']);

export function previewUnmanage(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) invalid();
  const { store, commandPath, originalTarget, managedDir } = envelope;
  if (!store || typeof store.status !== 'function' || typeof store.state !== 'string' || !store.state ||
    typeof commandPath !== 'string' || !commandPath || typeof originalTarget !== 'string' || !originalTarget ||
    typeof managedDir !== 'string' || !managedDir) invalid();
  let names;
  try {
    names = readdirSync(join(store.state, 'upgrade', 'transactions')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') names = [];
    else throw error;
  }
  for (const name of names) {
    if (!TXNAME.test(name)) throw new Error('unmanage_journal_unsafe');
    let tx;
    try {
      tx = store.status(name.slice(0, -5));
    } catch {
      throw new Error('unmanage_journal_unsafe');
    }
    if (!tx || typeof tx.installationState !== 'string') throw new Error('unmanage_journal_unsafe');
    if (!QUIESCENT.has(tx.installationState)) throw new Error(`unmanage_transaction_engaged:${tx.installationState}`);
  }
  try {
    readFileSync(originalTarget);
  } catch {
    throw new Error('unmanage_link_unrestorable');
  }
  const verdict = assessNpmCommand({ commandPath, managedLauncher: join(managedDir, 'launcher', 'h2a.mjs'), legacyEntry: originalTarget });
  return Object.freeze({ wouldRestore: { commandPath, originalTarget, managedDir, forced: true },
    linkVerdict: verdict.state });
}

// Component-scoped compensation routing for `h2a upgrade compensate`.
// Authority-checked read of the named transaction, then the component
// disposition. The component compensation engine exists and is proven at
// handover depth (`prepareCompensation`/`compensateCold`, M24/M25); what is
// missing in this lane is the H4 upgrade-to-component routing (no COMPLETED
// precedent, no upgradeId-to-component mapping), so a well-routed request
// is recorded as explicitly incomplete (exit 2), never as done and never
// as a silent no-op. This function mutates nothing: no journal write, no
// install, no spawn.
const COMPONENTS = ['mcp', 'gateway'];

export function compensateUpgrade(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) invalid();
  const { store, upgradeId, controller, component } = envelope;
  if (!store || typeof store.status !== 'function' ||
    typeof upgradeId !== 'string' || !upgradeId || typeof component !== 'string') invalid();
  if (!COMPONENTS.includes(component)) throw new Error('upgrade_component_unknown');
  const grant = assertUpgradeAuthority({ store, upgradeId, controller });
  const tx = store.status(upgradeId);
  return Object.freeze({ upgradeId, component, installationState: tx.installationState,
    controllerEpoch: grant.epoch, compensated: false, reason: 'compensation_engine_pending' });
}
