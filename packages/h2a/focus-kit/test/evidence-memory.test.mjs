import { test } from 'node:test';
import assert from 'node:assert/strict';
import { residentBytes } from './evidence-metrics.mjs';

test('should count the resident pages of a live owned process without a fallback', () => {
  assert.equal(residentBytes('State:\tR (running)\nVmRSS:\t42 kB\n', () => { throw new Error('unnecessary fallback'); }), 42 * 1024);
});
test('should count a reaped-memory child as zero before the kernel marks it zombie', () => {
  assert.equal(residentBytes('State:\tR (running)\n', () => '0 0 0 0 0 0 0\n'), 0);
});
test('should count a zombie as zero resident pages', () => {
  assert.equal(residentBytes('State:\tZ (zombie)\n', () => { throw new Error('already exited'); }), 0);
});
test('should fail missing RSS instrumentation when the same process still has resident pages', () => {
  assert.throws(() => residentBytes('State:\tR (running)\n', () => '100 20 0 0 0 0 0\n'), /RSS instrumentation absent/);
});
test('should fail malformed fallback instrumentation', () => {
  assert.throws(() => residentBytes('State:\tR (running)\n', () => 'unavailable'), /RSS instrumentation absent/);
});
test('should propagate unavailable fallback instrumentation rather than inventing zero', () => {
  assert.throws(() => residentBytes('State:\tR (running)\n', () => { throw new Error('statm unavailable'); }), /statm unavailable/);
});
