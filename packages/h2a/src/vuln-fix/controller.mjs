import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquire, readState, writeJson } from './state.mjs';
import { pair, selectSeats, validateConfig } from './policy.mjs';
import { Repository } from './repository.mjs';
import { LocalSeats } from './seats.mjs';

export async function runDaily(config, { dryRun = false, now = () => new Date(),
  runner = new LocalSeats(), repository = spec => new Repository(spec) } = {}) {
  validateConfig(config);
  const release = await acquire(config.stateDir);
  const day = now().toISOString().slice(0, 10);
  const report = { version: 1, id: randomUUID(), day, dryRun, startedAt: now().toISOString(), repositories: [], failures: [] };
  const saveReport = () => {
    writeJson(join(config.stateDir, 'reports', `${day}-${report.id}.json`), report);
    writeJson(join(config.stateDir, dryRun ? 'latest-dry-run.json' : 'latest.json'), report);
  };
  try {
    const state = readState(config.stateDir);
    state.quarantines ??= {};
    const save = () => writeJson(join(config.stateDir, 'state.json'), state);
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
        item.baseline = await repo.prepare();
        item.before = await repo.scan();
        if (!item.before.complete) throw new Error(`incomplete detection: ${item.before.errors.join('; ')}`);
        if (!item.before.findings.length) { checkpoint({ status: 'clean' }); continue; }
        const existing = await repo.existingPr();
        if (existing) { checkpoint({ status: 'existing-pr', pr: existing.url, sha: existing.headRefOid,
          blocked: true, reason: 'open PR requires conductor resolution; readiness is not requalified by its existence' }); continue; }
        if (state.attempts[key]) { checkpoint({ status: 'already-attempted', attempt: state.attempts[key] }); continue; }
        const ambiguous = Object.values(state.attempts).find(x => x.repository === spec.github && x.published && !x.pr);
        if (ambiguous) throw new Error(`prior publication requires reconciliation: ${ambiguous.branch}`);
        if (dryRun) { checkpoint({ status: 'would-attempt' }); continue; }
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
          } catch (error) { unavailable.push({ seat: seat.id, reason: error.message }); }
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
        if (author.code !== 0) throw new Error(`author failed: ${author.error ?? author.code}`);
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
          item.reviews.push({ seat: seat.id, identity: pair(seat), lens: index, approved, verdict,
            admission: receipt.admission,
            ...(approved ? {} : { failure: receipt.error ?? 'review rejected or invalid/mismatched receipt' }) });
          checkpoint({ status: 'draft' });
        }
        await repo.assertHead(item.sha);
        if (verified && item.reviews.length === 2 && item.reviews.every(x => x.approved)) {
          await repo.ready(item.pr, item.sha);
          checkpoint({ status: 'ready' });
        } else checkpoint({ status: 'draft-blocked', reason: 'verification, supply-chain admission or independent review blocked readiness' });
      } catch (error) {
        if (error.checks) item.verificationFailure = error.checks;
        if (error.quarantine) {
          repo.quarantined = true;
          state.quarantines[spec.github] = { at: now().toISOString(), error: error.message, workspace: repo.workspace };
          save();
        }
        report.failures.push({ repository: spec.github, error: error.message });
        checkpoint({ status: 'failed', error: error.message });
      } finally {
        try { await repo.cleanup(); }
        catch (error) { report.failures.push({ repository: spec.github, error: `cleanup failed: ${error.message}` }); checkpoint({ cleanupFailed: true }); }
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
