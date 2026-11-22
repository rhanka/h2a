/**
 * LH-09a terminal-reply allowlist and per-channel rate limiter (R11 §8.5).
 *
 * Allowed starting set:
 * - Primary Device Attributes (DA1): ESC [ ? <1..16 ints of 1..4 digits separated by ;> c
 * - Secondary Device Attributes (DA2): ESC [ > <3 ints of 1..6 digits separated by ;> c
 * - Cursor Position Report (CPR): ESC [ <1..4 digits> ; <1..4 digits> R
 * - Mode Report (DECRPM): ESC [ ? <1..5 digits> ; <0..4> $ y
 *
 * Rate limit per channel: token bucket capacity 20, refill 10 tokens/sec.
 */

export const TERMINAL_REPLY_BUCKET_BURST = 20 as const;
export const TERMINAL_REPLY_REFILL_PER_SEC = 10 as const;

const DA1_RE = /^\x1b\[\?\d{1,4}(?:;\d{1,4}){0,15}c$/;
const DA2_RE = /^\x1b\[>\d{1,6};\d{1,6};\d{1,6}c$/;
const CPR_RE = /^\x1b\[\d{1,4};\d{1,4}R$/;
const DECRPM_RE = /^\x1b\[\?\d{1,5};[0-4]\$y$/;

export interface TerminalReplyClock {
  now(): number;
}

export type TerminalReplyCheckResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "reply-not-allowed" | "reply-rate-limited" };

export interface TerminalReplyFilter {
  check(text: string, nowMs?: number): TerminalReplyCheckResult;
  rateLimitedCount(): number;
}

export function isAllowlistedTerminalReply(text: string): boolean {
  return DA1_RE.test(text) || DA2_RE.test(text) || CPR_RE.test(text) || DECRPM_RE.test(text);
}

export function createTerminalReplyFilter(clock: TerminalReplyClock = { now: () => Date.now() }): TerminalReplyFilter {
  let tokens: number = TERMINAL_REPLY_BUCKET_BURST;
  let lastRefillAt = clock.now();
  let limitedCount = 0;

  return {
    check(text: string, nowMs = clock.now()): TerminalReplyCheckResult {
      if (!isAllowlistedTerminalReply(text)) {
        return { allowed: false, reason: "reply-not-allowed" };
      }
      const elapsedMs = Math.max(0, nowMs - lastRefillAt);
      if (elapsedMs > 0) {
        tokens = Math.min(
          TERMINAL_REPLY_BUCKET_BURST,
          tokens + (elapsedMs * TERMINAL_REPLY_REFILL_PER_SEC) / 1000
        );
        lastRefillAt = nowMs;
      }
      if (tokens < 1) {
        limitedCount += 1;
        return { allowed: false, reason: "reply-rate-limited" };
      }
      tokens -= 1;
      return { allowed: true };
    },
    rateLimitedCount(): number {
      return limitedCount;
    }
  };
}
