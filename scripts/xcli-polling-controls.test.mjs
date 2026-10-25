import assert from 'node:assert/strict';
import test from 'node:test';
import { runWakeCell } from './xcli-simulation-fixture.mjs';

const periods = [1000, 5000, 15000, 45000, 90000];
const selected = process.env.XCLI_POLL_PERIOD_MS;
assert.ok(selected === undefined || periods.includes(Number(selected)), 'unknown polling shard');
for (const period of selected === undefined ? periods : [Number(selected)]) {
  test(`L3 polling period ${period}ms: all three phases fail stage 7`, () => {
    const rows = [];
    const replications = period >= 45000 ? 3 : 1;
    for (const div of [0, 1, 2]) {
      const phase = Math.round(period * div / 3);
      const { status, cells } = runWakeCell(['--pair', 'claude:codex',
        '--poll', `periodic:${period}:${phase}`, '--timeout-ms', '60000',
        '--wake-release-offsets-ms', replications === 3 ? '0,6000,1000' : '0']);
      assert.equal(status, 2, `period ${period} phase ${phase}: must fail the command`);
      assert.equal(cells.length, replications, 'every scheduled repetition must execute');
      for (const [replication, cell] of cells.entries()) {
      rows.push({ period, phase, replication, budgetMs: cell.budgetMs, status: cell.status,
        woke: cell.woke, wakeFailure: cell.wakeFailure });
      assert.equal(cell.status, 'simulated-KO', `period ${period} phase ${phase}: must not pass`);
      assert.equal(cell.woke, false, `period ${period} phase ${phase}: no wake credit`);
      const w = cell.wakeWindows;
      if (w.preBarrierReads + w.baselineReads + w.withheldReads > 0) {
        assert.equal(cell.wakeFailure, 'wake-polling-detected');
      } else {
        assert.ok(['wake-no-qualifying-read', 'wake-delay-exceeded',
          ...(replications === 3 ? ['wake-phase-separation-unproven'] : [])].includes(cell.wakeFailure));
      }
      }
    }
    assert.equal(rows.length, 3 * replications, 'all three polling phases and their repetitions must execute');
    console.log('L3 polling matrix (period ms, phase ms, budget ms, status, woke, mechanism):');
    for (const row of rows) console.log(`  ${row.period} ${row.phase} rep=${row.replication} budget=${row.budgetMs} ${row.status} woke=${row.woke} ${row.wakeFailure}`);
  });
}
