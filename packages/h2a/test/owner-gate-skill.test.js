import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Owner gates have one full procedure: the h2a skill section below. The
// harness entry points only link to it. These checks pin its safety clauses,
// the links, and the removal of wording that sent reminders into a dialog.
const read = path => fs.readFileSync(new URL(`../skills/${path}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
const skills = ['h2a/SKILL.md', 'harness/SKILL.md', 'harness/using-harness/SKILL.md', 'harness/track-report/SKILL.md'];

function ownerGateSection() {
  const text = fs.readFileSync(new URL('../skills/h2a/SKILL.md', import.meta.url), 'utf8');
  const start = text.indexOf('## Owner gates across sessions');
  assert.ok(start >= 0, 'the h2a skill keeps the owner-gate section');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end).replace(/\s+/g, ' ');
}

test('the h2a owner-gate section is the single full procedure', () => {
  const section = ownerGateSection();
  for (const clause of [
    /blocks this session's work now/,
    /A decision that blocks nothing now is not a gate\. Record it for async review/,
    /status row .{0,40}is not a question/,
    /track decision new --kind commitment --title "OWNER GATE <id> — <action>"/,
    /track decision ls --outcome pending --format json/,
    /sends nothing to the target while the gate question is open or its state is unknown/,
    /A reminder is an owner alert, never input typed into the target/,
    /OWNER GATE ALERT <id>/,
    /`question-planned`/,
    /only after the target or the owner reports that the question failed, closed or is not displayed/,
    /`recipient_not_live`/,
    /`h2a_blockage_raise`/,
    /`reminders-unavailable`/,
    /`maxRelaunches`/,
    /`overdue`/,
    /`AskUserQuestion` blocks the conductor/,
    /`request_user_input_async`/,
    /`missing`, `unavailable`, `peer-reported` and `trace-verified`/,
    /never records a GO/
  ]) assert.match(section, clause);
});

test('owner-gate entry points link to the single procedure', () => {
  for (const path of skills.slice(1)) {
    assert.match(read(path), /\*\*Owner gates across sessions\*\* in the h2a skill/, `${path} links the h2a procedure`);
  }
  assert.match(read('harness/using-harness/SKILL.md'), /A decision that blocks nothing now is not a gate/);
  const harness = read('harness/SKILL.md');
  assert.match(harness, /Use h2a only for the initial cross-session request/);
  assert.match(harness, /Reminders go to the owner in the conductor's session/);
});

test('no owner-gate text sends reminders or follow-up traffic into a dialog', () => {
  for (const path of skills) {
    const text = read(path);
    for (const banned of [/remind about an (?:already )?open question/i, /cross-session reminders/i, /known-safe/i,
      /attention question/i, /ticking loop/i, /full-journal discovery/i, /native-unqualified/i,
      /unexpected terminal state/i, /only for a safe destination/i]) {
      assert.doesNotMatch(text, banned, `${path}: ${banned}`);
    }
  }
});

test('the track report never offers a session-bound gate as a D-number reply', () => {
  const text = read('harness/track-report/SKILL.md');
  assert.match(text, /`answer in <session> · question <evidence level>`/);
  assert.match(text, /Give it no `D` number and keep it out of the reply line/);
  assert.match(text, /`vas y` and `D1 A` never answer a session-bound gate/);
});
