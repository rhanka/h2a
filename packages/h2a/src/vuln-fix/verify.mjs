import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { npmTreeIncludes, scanChangeProven } from './scan.mjs';
import { redactOutput, redactSecretsText } from './redact.mjs';

function testExecuted(result, expected, before) {
  if (!result || result.command !== expected.command || JSON.stringify(result.args) !== JSON.stringify(expected.args) ||
    !Number.isSafeInteger(result.code)) return false;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  if (/(?:^\s*[#ℹ]\s*(?:skipped|cancelled|todo)\s+[1-9]\d*|^\s*[#ℹ]\s*tests\s+0\b|^\s*Tests\b.*\b[1-9]\d*\s+(?:todo|skipped)\b|^\s*(?:not )?ok\b.*#\s*(?:SKIP|TODO)\b|^\s*No test files found)/im.test(output) ||
    !/(?:^\s*[#ℹ]\s*tests\s+[1-9]\d*|^\s*Tests\s+[1-9]\d*\s+(?:passed|failed))/im.test(output)) return false;
  if (before && expected.redBefore === true) {
    const assertion = expected.regression?.assertion;
    const escaped = typeof assertion === 'string' ? assertion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    const namedFailure = escaped && new RegExp(`^\\s*(?:not ok\\s+\\d+\\s*-?\\s*${escaped}|FAIL\\s+.+\\s*>\\s*${escaped}|✖\\s+${escaped}(?:\\s+\\([0-9.]+ms\\))?)\\s*$`, 'm').test(output);
    const oneFailure = /^\s*[#ℹ]\s*fail\s+1\s*$/m.test(output) || /^\s*Tests\s+1\s+failed\b/m.test(output);
    return result.code !== 0 && result.failureKind === 'assertion' &&
      typeof expected.regression?.id === 'string' && expected.regression.id.length > 0 &&
      typeof expected.regression?.assertion === 'string' && expected.regression.assertion.length > 0 &&
      result.regressionId === expected.regression.id && namedFailure && oneFailure &&
      /ERR_ASSERTION|AssertionError|AssertionError:/m.test(output) && !/MODULE_NOT_FOUND|ENOENT|SyntaxError|ReferenceError/.test(output);
  }
  return result.code === 0;
}

/** Pure placement-independent gate. The selected trusted adapter supplies
 * fresh remote observations and revalidates evidence, never model assertions. */
export function evaluateMergeEvidence(candidate, observation, now) {
  const block = (status, reason, nextAttemptAt) => ({ status, reason, ...(nextAttemptAt ? { nextAttemptAt } : {}) });
  const owns = observation?.ownership;
  if (!owns || ['repository', 'pr', 'branch'].some(key => owns[key] !== candidate[key])) return block('quarantine', 'foreign or ambiguous PR ownership');
  if (owns.sha !== candidate.sha || owns.base !== candidate.base) return block('needs-revalidation', 'candidate head or proven base changed');
  if (!['guard', 'tests', 'verification'].every(key => observation.proofDigests?.[key] === candidate.proofDigests[key])) return block('needs-revalidation', 'verification contract or proof digest changed');
  const permitted = (seat, role) => seat && ['muse', 'codex', 'vibe', 'agy'].includes(seat.profile) &&
    typeof seat.id === 'string' && seat.id.length > 0 && typeof seat.model === 'string' && seat.model.length > 0 &&
    Array.isArray(seat.usages) && seat.usages.includes('vulnerability-remediation') &&
    Array.isArray(seat.roles) && seat.roles.includes(role);
  const reviews = observation.reviews;
  if (!permitted(candidate.author, 'author') || !candidate.reviewers.every(seat => permitted(seat, 'reviewer') &&
    seat.profile !== candidate.author.profile && seat.model !== candidate.author.model && seat.id !== candidate.author.id) ||
    new Set(candidate.reviewers.map(x => `${x.profile}/${x.model}`)).size !== 2 ||
    new Set(candidate.reviewers.map(x => x.id)).size !== 2 ||
    !Array.isArray(reviews) || reviews.length !== 2 ||
    !candidate.reviewers.every(seat => reviews.some(review => review && review.id === seat.id && review.profile === seat.profile &&
      review.model === seat.model && permitted(review, 'reviewer') && review.sha === candidate.sha &&
      review.approved === true && Array.isArray(review.findings) && review.findings.length === 0 &&
      typeof review.receiptId === 'string' && review.receiptId.length > 0)) ||
    new Set(reviews.map(x => x.receiptId)).size !== 2 || observation.blockingThreads !== 0) return block('blocked-review', 'independent exact-SHA reviews or resolved threads missing');
  const checks = observation.checks;
  if (!Array.isArray(checks) || !candidate.requiredChecks.every(name => {
    const matches = checks.filter(x => x?.name === name);
    return matches.length === 1 && matches[0].sha === candidate.sha && matches[0].status === 'completed' && matches[0].conclusion === 'success';
  })) return block('waiting-checks', 'required checks missing, pending, stale, red or skipped');
  const evidence = observation.evidence;
  if (evidence?.base !== candidate.base || evidence?.sha !== candidate.sha ||
    !['lockOnly', 'compatible', 'noMajors', 'noNewPackages'].every(key => evidence.lockPolicy?.[key] === true) ||
    !scanChangeProven(evidence.before, evidence.after, candidate.targets)) return block('needs-revalidation', 'lock policy or audit RED to GREEN proof missing');
  if (!Array.isArray(evidence.testsBefore) || !Array.isArray(evidence.testsAfter) ||
    evidence.testsBefore.length !== candidate.tests.length || evidence.testsAfter.length !== candidate.tests.length ||
    !candidate.tests.every((check, i) => testExecuted(evidence.testsBefore[i], check, true) && testExecuted(evidence.testsAfter[i], check, false))) return block('needs-revalidation', 'required baseline/candidate targeted test execution unproven');
  const packages = evidence.packages;
  if (!Array.isArray(evidence.modifiedPackages) || !evidence.modifiedPackages.length ||
    new Set(evidence.modifiedPackages).size !== evidence.modifiedPackages.length ||
    !Array.isArray(packages) || packages.length !== evidence.modifiedPackages.length || packages.some(pkg => !pkg || typeof pkg !== 'object') ||
    new Set(packages.map(x => `${x.name}@${x.version}`)).size !== packages.length ||
    !packages.every(pkg => evidence.modifiedPackages.includes(`${pkg.name}@${pkg.version}`) &&
      pkg.integrityVerified === true && pkg.signatureVerified === true && pkg.provenanceVerified === true &&
      Number.isFinite(Date.parse(pkg.publishedAt)) && Date.parse(pkg.publishedAt) <= now.getTime())) return block('needs-revalidation', 'modified package integrity/signature/provenance or publication metadata unproven');
  const matureAt = Math.max(...packages.map(pkg => Date.parse(pkg.publishedAt) + 7 * 86_400_000));
  if (now.getTime() < matureAt) return block('waiting-age', 'trusted package below seven-day maturation', new Date(matureAt).toISOString());
  if (observation.rules?.satisfied !== true || observation.rules.method !== 'merge' || observation.rules.adminBypass !== false) return block('needs-revalidation', 'repository merge-commit rules not satisfied');
  return { status: 'ready' };
}

export async function supplyChain(repo, now) {
  const results = { ok: true, checks: [], errors: [] };
  for (const file of repo.locks) {
    try {
      const cwd = join(repo.workspace, dirname(file));
      for (const args of [['ci', '--ignore-scripts', ...npmTreeIncludes], ['audit', 'signatures', '--json', ...npmTreeIncludes]]) {
        const output = redactOutput(await repo.execute('npm', args, { cwd }));
        results.checks.push({ command: 'npm', args, lockfile: file, ...output });
        if (output.code !== 0) throw new Error(`npm ${args.join(' ')} failed`);
      }
      const before = JSON.parse(repo.originalLocks.get(file));
      const after = JSON.parse(readFileSync(repo.file(file), 'utf8'));
      const seen = new Set();
      for (const [path, pkg] of Object.entries(after.packages)) {
        if (!path.includes('node_modules/') || pkg.link || JSON.stringify(pkg) === JSON.stringify(before.packages[path])) continue;
        const name = pkg.name ?? path.split('node_modules/').at(-1);
        const identity = `${name}@${pkg.version}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const output = redactOutput(await repo.execute('npm', ['view', identity, 'dist', 'time', '--json', '--registry=https://registry.npmjs.org'], { cwd }));
        if (output.code !== 0) throw new Error(`registry metadata unavailable: ${identity}`);
        const metadata = JSON.parse(output.stdout);
        const age = now.getTime() - Date.parse(metadata.time?.[pkg.version]);
        if (!Number.isFinite(age) || age < 7 * 86_400_000) throw new Error(`release maturation below 7 days or unknown: ${identity}`);
        if (!pkg.integrity || metadata.dist?.integrity !== pkg.integrity || !metadata.dist?.signatures?.length ||
          !metadata.dist?.attestations?.provenance) throw new Error(`integrity/signature/provenance absent or inconsistent: ${identity}`);
        results.checks.push({ package: identity, ageDays: Math.floor(age / 86_400_000), integrity: pkg.integrity,
          signaturePresent: true, provenancePresent: true });
      }
    } catch (error) { if (error.quarantine) throw error; results.errors.push(redactSecretsText(`${file}: ${error.message}`)); }
  }
  results.ok = results.errors.length === 0;
  return results;
}
