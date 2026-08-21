/**
 * Outbound HTTP with a mandatory deadline.
 *
 * Every Adorini provider calls a third party over the public internet — Meta,
 * Delhivery, Google, Cashfree. `fetch` has **no default timeout**: if an
 * upstream accepts the TCP connection and then never responds, the request
 * hangs until the socket dies, which can be minutes.
 *
 * That is the worst failure mode for this system. A checkout request that hangs
 * holds its Node handle, its database connection, and the customer's attention;
 * enough of them and the origin stops serving anyone. Failing fast turns an
 * upstream outage into a handled error the caller can retry or surface, which
 * is the "fail loudly" property the providers are specified to have.
 */

/** Default deadline for a single upstream call. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Deadline exceeded before the upstream responded.
 *
 * Distinct from a transport failure so callers can tell "they are slow" from
 * "they are unreachable" — the two justify different retry behaviour.
 */
export class UpstreamTimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamTimeoutError';
  }
}

/** True when an error came from an aborted/timed-out fetch. */
export function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * `fetch` with an enforced deadline.
 *
 * Rejects with `UpstreamTimeoutError` on expiry; every other failure propagates
 * unchanged so providers can wrap it in their own typed error.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new UpstreamTimeoutError(
        `Upstream did not respond within ${timeoutMs}ms`,
        timeoutMs,
        error,
      );
    }
    throw error;
  }
}
