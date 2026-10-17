import { it, expect } from "vitest";
import { ContentQueueBudget, SessionContentExport } from "./session-content-export.js";
it("should bound source and aggregate queues and invalidate reservations without legacy backfill", () => {
  const budget = new ContentQueueBudget();
  const queues = Array.from({length:5},()=>new SessionContentExport(budget));
  for (const q of queues) q.reset(1);
  for (const q of queues.slice(0,4)) expect(q.admit(1,'x'.repeat(1048576))).toBe(true);
  expect(budget.bytes).toBe(4194304);
  expect(queues[4]!.admit(1,'overflow')).toBe(false);
  const q=queues[0]!, reservation=q.reserve()!;
  expect(reservation.bytes.length).toBe(262144);
  expect(q.reserve()).toBeNull();
  q.reset(2);
  expect(q.current(reservation)).toBe(false);
  expect(q.reserve()).toBeNull();
  for(const queue of queues) queue.clear();
  expect(budget.bytes).toBe(0);
});
it("should count in-flight bytes until an exact reservation commits and pause on source overflow", () => {
  const budget=new ContentQueueBudget(), q=new SessionContentExport(budget); q.reset(1);
  q.admit(1,'post-consent'); const r=q.reserve()!;
  expect(budget.bytes).toBe(12); expect(q.current(r)).toBe(true);
  q.commit({...r}); expect(budget.bytes).toBe(12);
  q.commit(r); expect(budget.bytes).toBe(0);
  expect(q.admit(2,'x'.repeat(1048577))).toBe(false);
  expect(q.reserve()).toBeNull();
});
it("should account the complete backing buffer until the last fragment commits",()=>{
  const budget=new ContentQueueBudget(),q=new SessionContentExport(budget);q.reset(1);q.admit(1,'x'.repeat(524288));
  q.commit(q.reserve()!);expect(budget.bytes).toBe(524288);q.commit(q.reserve()!);expect(budget.bytes).toBe(0);
});
