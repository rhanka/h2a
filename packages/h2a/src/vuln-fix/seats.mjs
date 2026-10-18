import { command } from './process.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function scopeBundleHash() {
  const directory = new URL('../../hooks/', import.meta.url);
  const hash = createHash('sha256');
  for (const name of readdirSync(directory).filter(x => x === 'hooks.json' || /^workspace-scope.*\.mjs$/.test(x)).sort()) {
    hash.update(name + '\0'); hash.update(readFileSync(new URL(name, directory)));
  }
  return hash.digest('hex');
}

export class LocalSeats {
  constructor({ execute = command, renderScope = async (profile, workspace) => {
    const { renderWorkspaceScope } = await import('../hosts/plugin.js');
    return renderWorkspaceScope(profile, workspace);
  }, importRuntime = async () => {
    const name = '@sentropic/h2a-runtime';
    return import(name);
  } } = {}) { this.execute = execute; this.importRuntime = importRuntime; this.renderScope = renderScope; }

  async available(seat, workspace) { return this.admit(seat, workspace, 'status'); }

  async admit(seat, workspace, action) {
    if (seat.enabled === false) throw new Error('seat disabled');
    if (!['claude', 'codex'].includes(seat.profile)) throw new Error('native headless/tool restrictions not qualified for this CLI');
    // Admission belongs to the seat authority. No quota guess, credit fallback
    // or reads of custody/native host state in this controller.
    if (!seat.admission) throw new Error('seat admission command required (quota + guard qualification)');
    const result = await this.execute(seat.admission.command, seat.admission.args, { cwd: workspace, timeout: 30_000,
      input: JSON.stringify({ action, units: 1, workspace, seat: seat.id, profile: seat.profile, model: seat.model,
        purpose: 'vulnerability-remediation', scopeBundleSha256: scopeBundleHash() }) });
    if (result.code !== 0) throw new Error('seat admission failed');
    const receipt = JSON.parse(result.stdout);
    const age = Date.now() - Date.parse(receipt.scope?.qualifiedAt);
    if (receipt.scope?.workspace !== workspace || receipt.scope?.host !== seat.profile ||
      receipt.scope?.bundleSha256 !== scopeBundleHash() || !Number.isFinite(age) || age < 0 || age > 86_400_000 ||
      (seat.profile === 'codex' && receipt.scope?.plugin !== 'h2a@sentropic')) throw new Error('native scope qualification receipt missing, stale or mismatched');
    if (!receipt.available || !receipt.guardQualified || !Number.isSafeInteger(receipt.remainingUnits) || receipt.remainingUnits < 0 ||
      !Number.isFinite(receipt.reservePercent) || receipt.reservePercent <= 20 || receipt.reservePercent > 100) throw new Error('quota/guard admission refused');
    if (action === 'reserve' && (receipt.reserved !== true || typeof receipt.reservationId !== 'string' || !receipt.reservationId)) throw new Error('atomic seat reservation receipt required');
    return receipt;
  }

  async run(task) {
    const admission = await this.admit(task.seat, task.workspace, 'reserve');
    const scope = await this.renderScope(task.seat.profile, task.workspace);
    if (!scope.supported) throw new Error(scope.reason);
    const runtime = await this.importRuntime();
    if (typeof runtime.runVulnerabilitySeatTask !== 'function') throw new Error('runtime lacks vulnerability seat runner; upgrade lockstep');
    return { ...await runtime.runVulnerabilitySeatTask({ ...task, scopeCommand: scope.command, nativeScope: admission.scope }),
      admission: { reservationId: admission.reservationId, scope: admission.scope } };
  }
}
