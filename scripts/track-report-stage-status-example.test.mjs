import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { auditNextActions, auditStatusProposals } from '../packages/track/dist/index.js';

const example = new URL('../docs/specs/examples/', import.meta.url);
test('the served multilingual example has no owed focus action and no missing red proposal', () => {
  const evidence = JSON.parse(readFileSync(new URL('track-report-stage-status-evidence.json', example), 'utf8'));
  assert.equal(evidence.audits.actionFr.uninstructed, 0);
  assert.equal(evidence.journalMutations, 0);
  assert.equal(evidence.cases.length, 6);
  for (const language of ['fr', 'es', 'ja', 'pt']) {
    const served = evidence.languages[language];
    assert.equal(served.lang, language);
    assert.deepEqual(auditNextActions(served.actions), { uninstructed: 0, repeated: [], gateClauses: [], ok: true });
    assert.deepEqual(auditStatusProposals(served.proposals, served.decisionRefs), { missingProposals: [], orphanBlue: [], ok: true });
    assert.equal(served.machineDigest, createHash('sha256').update(JSON.stringify(evidence.machine)).digest('hex'));
    assert.equal(served.replyLines.length, 1);
    assert.equal(served.replyLines[0].includes('D1 A'), true);
    const markdown = readFileSync(new URL(served.artifact, example), 'utf8');
    assert.equal(markdown.includes(served.proposals[0].proposal), true);
    assert.equal(served.sections.every(section => markdown.includes(`## ${section}`)), true);
  }
  assert.equal(evidence.translatedPlaceholder.uninstructed, 1);
  assert.equal(evidence.rawActionAudit.uninstructed > 0, true);
});

test('the UAT record is complete and does not claim human or independent cold-agent acceptance', () => {
  const record = readFileSync(new URL('track-report-stage-status-uat.md', example), 'utf8');
  assert.equal(record.includes('...[truncated'), false);
  assert.equal(record.includes('Human semantic acceptance: pending'), true);
  assert.equal(record.includes('Independent cold-agent acceptance: not run'), true);
});
