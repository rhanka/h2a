// One error type for the artifact review backend, so every failure leaves the server as
// `{ error: { code, message, ...details } }` with a deliberate HTTP status (API contract v0).
// A failure is never turned into an empty success: callers either get the comment they asked for,
// read back from the store, or an error that names what failed and, when known, what to do next.

export class ReviewError extends Error {
  /**
   * @param {string} code      Stable machine code (snake_case).
   * @param {number} status    HTTP status to answer with.
   * @param {string} message   Human-readable explanation, safe to show in the UI.
   * @param {Record<string, unknown>} [details] Extra fields merged into the error object.
   */
  constructor(code, status, message, details = {}) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
    this.status = status;
    /** @type {Record<string, unknown>} */
    this.details = details;
  }
}

/**
 * Coerce any thrown value into a ReviewError. Unknown errors become `internal_error` with their message:
 * the message is kept because hiding it would leave the operator with nothing to act on.
 * @param {unknown} error
 * @returns {ReviewError}
 */
export function asReviewError(error) {
  if (error instanceof ReviewError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ReviewError('internal_error', 500, message || 'Unexpected artifact review failure.');
}

/**
 * The JSON body of an error response.
 * @param {unknown} error
 * @returns {{ error: { code: string, message: string } & Record<string, unknown> }}
 */
export function errorBody(error) {
  const failure = asReviewError(error);
  return { error: { code: failure.code, message: failure.message, ...failure.details } };
}
