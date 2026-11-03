// Bounded retry for transfer-acceptance control-plane requests.
//
// Measured (M21 under 2-CPU contention, neighboring instance booting): the
// offer GET costs 654-1817ms against ~5ms idle, and transient `socket hang up`
// failures occur at 36-44ms. The blanket 2000ms request budget therefore
// aborts a live acceptance attempt with no headroom left, and the 1s
// supervision cadence against the 5s test acceptance window fits at most two
// attempts. Retrying inside the attempt — with a wider budget on later
// attempts — keeps a starved-but-alive central from losing the acceptance,
// while a refusing central still fails fast (ECONNREFUSED returns in ms).
export const OFFER_ATTEMPT_BUDGETS_MS = [2000, 5000, 5000];
export const RETRY_BACKOFF_MS = 250;

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_SOCKET']);

export function transientFetchError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  if (TRANSIENT_CODES.has(error.code)) return true;
  const message = String(error.message ?? error.cause?.message ?? '');
  return message.includes('socket hang up') || message.includes('fetch failed') ||
    message.includes('terminated') || message.includes('aborted');
}

// perform(budgetMs) issues one attempt with that attempt's timeout budget.
// Non-transient errors propagate immediately; a signalled stop aborts the
// loop instead of retrying a shutdown bridge.
export async function requestWithRetry(perform, { budgets = OFFER_ATTEMPT_BUDGETS_MS, backoffMs = RETRY_BACKOFF_MS, stopSignal } = {}) {
  let error;
  for (let attempt = 0; attempt < budgets.length; attempt++) {
    if (attempt > 0) {
      if (stopSignal?.aborted) throw error;
      if (backoffMs > 0) await new Promise(resolve => setTimeout(resolve, backoffMs));
      if (stopSignal?.aborted) throw error;
    }
    try {
      return await perform(budgets[attempt]);
    } catch (e) {
      error = e;
      if (!transientFetchError(e)) throw e;
    }
  }
  throw error;
}
