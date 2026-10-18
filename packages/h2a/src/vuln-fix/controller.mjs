import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquire, readState, validateCandidate, writeJson } from './state.mjs';
import { pair, selectSeats, validateConfig } from './policy.mjs';
import { Repository } from './repository.mjs';
import { LocalSeats } from './seats.mjs';
import { redactDeep, redactSecretsText } from './redact.mjs';
import { evaluateMergeEvidence } from './verify.mjs';

/** Independent L5 seam: caller holds the existing controller lock and fsyncs
 * checkpoint into its existing state. No production adapter/placement is
 * selected here. This operation never admits inference or modifies uses. */
export async function reconcileCandidate(candidate, adapter, checkpoint,
  { now = new Date(), admissionsOpen = false, retryMs = 300_000 } = {}) {
  validateCandidate(candidate);
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(retryMs) || retryMs < 1000 || retryMs > 3_600_000) throw new Error('bounded reconciliation clock/retry required');
  if (candidate.status === 'merged') return candidate;
  const persist = async update => {
    const next = { ...candidate, reason: undefined, nextAttemptAt: undefined, ...update, observedAt: now.toISOString() };
    validateCandidate(next);
    await checkpoint(next);
    candidate = next;
    return next;
  };
  const retryAt = () => new Date(now.getTime() + retryMs).toISOString();
  let observation;
  try { observation = await adapter.observe(candidate); }
  catch (error) { return persist({ status: candidate.mergeIntent ? 'merge-pending' : 'waiting-admission',
    reason: redactSecretsText(`remote observation unavailable: ${error.message}`), nextAttemptAt: retryAt() }); }
  const ownership = observation?.ownership;
  if (!ownership || ['repository', 'pr', 'branch', 'base', 'sha'].some(key => ownership[key] !== candidate[key])) {
    return persist(evaluateMergeEvidence(candidate, observation, now));
  }
  if (observation.mergeState === 'merged') {
    if (!/^[a-f0-9]{40}$/.test(observation.mergeSha ?? '')) return persist({ status: 'quarantine', reason: 'remote merged state lacks merge SHA' });
    return persist({ status: 'merged', mergeSha: observation.mergeSha });
  }
  if (candidate.mergeIntent && observation.mergeState !== 'not-started') return persist({ status: 'merge-pending', reason: 'prior merge outcome still ambiguous', nextAttemptAt: retryAt() });
  if (admissionsOpen !== true) return persist({ status: 'waiting-admission', reason: 'admissions disabled', nextAttemptAt: retryAt() });
  const verdict = evaluateMergeEvidence(candidate, observation, now);
  if (verdict.status !== 'ready') return persist({ ...verdict,
    ...(['waiting-checks', 'waiting-admission'].includes(verdict.status) ? { nextAttemptAt: retryAt() } : {}) });
  if (observation.mergeState !== 'not-started') return persist({ status: 'needs-revalidation', reason: 'remote merge state unproven' });
  const intent = candidate.mergeIntent ?? { id: randomUUID(), expectedHead: candidate.sha, expectedBase: candidate.base, method: 'merge', createdAt: now.toISOString() };
  await persist({ status: 'merge-pending', mergeIntent: intent, reason: 'protected merge dispatched', nextAttemptAt: retryAt() });
  try { await adapter.merge(candidate, { expectedHead: candidate.sha, expectedBase: candidate.base, method: 'merge', intentId: intent.id }); }
  catch (error) { return persist({ status: 'merge-pending', reason: redactSecretsText(`merge acknowledgement uncertain: ${error.message}`), nextAttemptAt: retryAt() }); }
  // Do not accept an API acknowledgement as evidence of the remote effect.
  return reconcileCandidate(candidate, { ...adapter, merge: async () => { throw new Error('merge effect unconfirmed'); } }, checkpoint,
    { now, admissionsOpen: false, retryMs });
}

export async function runDaily(config, { dryRun = false, now = () => new Date(),
  runner = new LocalSeats(), repository = spec => new Repository(spec) } = {}) {
  validateConfig(config);
  const release = await acquire(config.stateDir);
  const day = now().toISOString().slice(0, 10);
  const report = { version: 1, id: randomUUID(), day, dryRun, startedAt: now().toISOString(), repositories: [], failures: [] };
  const saveReport = () => {
    const redacted = redactDeep(report);
    writeJson(join(config.stateDir, 'reports', `${day}-${report.id}.json`), redacted);
    writeJson(join(config.stateDir, dryRun ? 'latest-dry-run.json' : 'latest.json'), redacted);
  };
  try {
    const state = readState(config.stateDir);
    state.quarantines ??= {};
    const save = () => writeJson(join(config.stateDir, 'state.json'), redactDeep(state));
    for (const spec of config.repositories) {
      const item = { repository: spec.github, status: 'scanning' };
      report.repositories.push(item);
      const repo = repository(spec);
      const key = `${spec.github}/${day}`;
      let claimed = false;
      const checkpoint = update => {
        Object.assign(item, update);
        if (claimed) { state.attempts[key] = { ...item }; save(); }
        saveReport();
      };
      try {
        if (state.quarantines[spec.github]) throw new Error('repository quarantined after ambiguous process cleanup; conductor reconciliation required');
        const candidates = Object.values(state.candidates ?? {}).filter(candidate => candidate.repository === spec.github);
        if (candidates.length) {
          item.candidates = [];
          for (const candidate of candidates) {
            const reconciled = dryRun ? candidate : await reconcileCandidate(candidate, {
              observe: saved => {
                if (typeof repo.observeCandidate !== 'function') throw new Error('selected merge observation adapter unavailable');
                return repo.observeCandidate(saved);
              },
              merge: (saved, expected) => {
                if (typeof repo.mergeCandidate !== 'function') throw new Error('selected protected merge executor unavailable');
                return repo.mergeCandidate(saved, expected);
              },
            }, saved => { state.candidates[saved.pr] = saved; save(); }, { now: now(), admissionsOpen: config.admissionsOpen === true });
            item.candidates.push(reconciled);
          }
          item.blocked = item.candidates.some(candidate => candidate.status !== 'merged');
          if (item.blocked) item.reason = 'owned candidate remains unfixed; see durable candidate reasons and next wake-up';
          saveReport();
        }
        item.baseline = await repo.prepare();
        item.before = await repo.scan();
        if (!item.before.complete) throw new Error(`incomplete detection: ${item.before.errors.join('; ')}`);
        if (item.blocked) { checkpoint({ status: 'fix-blocked' }); continue; }
        if (!item.before.findings.length) { checkpoint({ status: 'clean' }); continue; }
        const existing = await repo.existingPr();
        if (existing) { checkpoint({ status: 'existing-pr', pr: existing.url, sha: existing.headRefOid,
          blocked: true, reason: 'open PR requires conductor resolution; readiness is not requalified by its existence' }); continue; }
        if (state.attempts[key]) { checkpoint({ status: 'already-attempted', attempt: state.attempts[key] }); continue; }
        const ambiguous = Object.values(state.attempts).find(x => x.repository === spec.github && x.published && !x.pr);
        if (ambiguous) throw new Error(`prior publication requires reconciliation: ${ambiguous.branch}`);
        if (dryRun) { checkpoint({ status: 'scanned', fixState: 'fix-blocked', blocked: true,
          reason: 'dry-run has no admitted cycle or qualified execution boundary' }); continue; }
        if (config.admissionsOpen === false) { checkpoint({ status: 'waiting-admission', blocked: true,
          reason: 'admissions disabled; detection continues without new work' }); continue; }
        const available = [], unavailable = [], capacity = {};
        for (const seat of config.seats) {
          try {
            const admission = await runner.available(seat, repo.workspace);
            if (!admission.available || !admission.guardQualified || admission.reservePercent <= 20 ||
              !Number.isFinite(admission.reservePercent) || !Number.isSafeInteger(admission.remainingUnits) || admission.remainingUnits < 1 ||
              (state.uses[`${day}/${seat.profile}`] ?? 0) >= 10) throw new Error('seat quota/guard admission refused');
            capacity[seat.profile] = Math.min(capacity[seat.profile] ?? Infinity, admission.remainingUnits,
              10 - (state.uses[`${day}/${seat.profile}`] ?? 0));
            available.push(seat);
          } catch (error) { unavailable.push({ seat: seat.id, reason: redactSecretsText(error.message) }); }
        }
        item.unavailableSeats = unavailable;
        const selected = selectSeats(available, state.cursor, capacity);
        item.author = { ...selected.author, admission: undefined };
        item.reviewers = selected.reviewers.map(x => ({ id: x.id, profile: x.profile, model: x.model, effort: x.effort }));
        item.identityBasis = 'declared/requested; effective provider model is not attested';
        claimed = true;
        state.cursor = selected.cursor;
        for (const seat of [selected.author, ...selected.reviewers]) {
          const usageKey = `${day}/${seat.profile}`;
          state.uses[usageKey] = (state.uses[usageKey] ?? 0) + 1;
        }
        checkpoint({ status: 'claimed' }); // fsync before any inference; crashes consume the UTC day.
        item.installBefore = await repo.install();
        item.testsBefore = await repo.tests('before');
        item.branch = await repo.begin(day);
        item.generatedFix = await repo.generateFix();
        const findingsFile = await repo.authorContext(item.before.findings);
        const author = await runner.run({ seat: selected.author, kind: 'author', workspace: repo.workspace,
          baseline: item.baseline, findingsFile, locks: repo.locks });
        if (author.code !== 0) throw new Error(redactSecretsText(`author failed: ${author.error ?? author.code}`));
        item.authorAdmission = author.admission;
        item.sha = await repo.seal();
        checkpoint({ status: 'candidate' });
        item.after = await repo.scan();
        item.supplyChain = await repo.supplyChain(now());
        item.testsAfter = await repo.tests('after');
        await repo.assertHead(item.sha);
        checkpoint({ status: 'publishing', published: true }); // ambiguous push/create retains recovery gate.
        item.pr = await repo.openDraft(item, config.stateDir);
        checkpoint({ status: 'draft' });
        const verified = item.after.complete && item.after.findings.length === 0 && item.supplyChain.ok && item.testsAfter.every(x => x.ok);
        item.reviews = [];
        for (const [index, seat] of selected.reviewers.entries()) {
          const workspace = await repo.reviewWorkspace(index, item.sha, { before: item.before, after: item.after,
            testsBefore: item.testsBefore, testsAfter: item.testsAfter, supplyChain: item.supplyChain });
          const receipt = await runner.run({ seat, kind: 'review', workspace, sha: item.sha,
            baseline: item.baseline, findings: item.before.findings,
            evidence: { directory: '.h2a/vuln-fix-review', files: ['diff.patch', 'evidence.json', 'locks-before.json', 'locks-after.json'] },
            lens: index === 0 ? 'correctness and regression evidence' : 'security, scope and supply chain' });
          let verdict;
          try { verdict = JSON.parse(receipt.stdout); } catch { /* Missing strict receipt is a failed review. */ }
          const approved = receipt.code === 0 && verdict?.sha === item.sha && verdict.approved === true &&
            Array.isArray(verdict.findings) && verdict.findings.length === 0;
          item.reviews.push(redactDeep({ seat: seat.id, identity: pair(seat), lens: index, approved, verdict,
            admission: receipt.admission,
            ...(approved ? {} : { failure: receipt.error ?? 'review rejected or invalid/mismatched receipt' }) }));
          checkpoint({ status: 'draft' });
        }
        await repo.assertHead(item.sha);
        if (verified && item.reviews.length === 2 && item.reviews.every(x => x.approved)) {
          await repo.ready(item.pr, item.sha);
          checkpoint({ status: 'ready' });
        } else checkpoint({ status: 'draft-blocked', reason: 'verification, supply-chain admission or independent review blocked readiness' });
      } catch (error) {
        if (error.checks) item.verificationFailure = redactDeep(error.checks);
        if (error.quarantine) {
          repo.quarantined = true;
          state.quarantines[spec.github] = { at: now().toISOString(), error: redactSecretsText(error.message), workspace: repo.workspace };
          save();
        }
        report.failures.push({ repository: spec.github, error: redactSecretsText(error.message) });
        checkpoint({ status: 'failed', error: redactSecretsText(error.message) });
      } finally {
        try { await repo.cleanup(); }
        catch (error) { report.failures.push({ repository: spec.github, error: redactSecretsText(`cleanup failed: ${error.message}`) }); checkpoint({ cleanupFailed: true }); }
      }
    }
    report.finishedAt = now().toISOString();
    const findings = report.repositories.reduce((sum, item) => sum + (item.before?.findings.length ?? 0), 0);
    const prs = report.repositories.filter(item => item.pr).length;
    const blocked = report.repositories.filter(item => item.blocked || ['draft-blocked', 'already-attempted'].includes(item.status)).length;
    report.ok = report.failures.length === 0 && blocked === 0;
    report.summary = `vuln-fix ${day}: repos=${report.repositories.length} findings=${findings} prs=${prs} failures=${report.failures.length} blocked=${blocked}${dryRun ? ' dry-run' : ''}`;
    saveReport();
    return report;
  } finally { await release(); }
}
