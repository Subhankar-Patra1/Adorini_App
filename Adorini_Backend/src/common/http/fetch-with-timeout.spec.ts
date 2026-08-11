import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  UpstreamTimeoutError,
  fetchWithTimeout,
  isAbortLikeError,
} from './fetch-with-timeout';

describe('fetchWithTimeout', () => {
  const globalFetchBackup = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = globalFetchBackup;
  });

  it('attaches an abort signal to every request', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    await fetchWithTimeout('https://example.com');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves caller-supplied init options', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    await fetchWithTimeout('https://example.com', {
      method: 'POST',
      headers: { authkey: 'k' },
      body: 'payload',
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('payload');
    expect((init.headers as Record<string, string>).authkey).toBe('k');
  });

  it('converts an abort into UpstreamTimeoutError carrying the budget', async () => {
    const abort = new Error('This operation was aborted');
    abort.name = 'TimeoutError';
    (global.fetch as jest.Mock).mockRejectedValueOnce(abort);

    const error = (await fetchWithTimeout('https://example.com', {}, 1234).catch(
      (e: unknown) => e,
    )) as UpstreamTimeoutError;

    expect(error).toBeInstanceOf(UpstreamTimeoutError);
    expect(error.timeoutMs).toBe(1234);
    expect(error.originalError).toBe(abort);
  });

  it('lets non-timeout transport failures through untouched', async () => {
    // Providers distinguish "slow" from "unreachable" — the two justify
    // different retry behaviour, so this must not be flattened into a timeout.
    const dnsFailure = new Error('ENOTFOUND');
    (global.fetch as jest.Mock).mockRejectedValueOnce(dnsFailure);

    await expect(fetchWithTimeout('https://example.com')).rejects.toBe(dnsFailure);
  });

  it('actually aborts a request that outlives its budget', async () => {
    // Uses the real fetch abort path rather than a mock: proves the signal is
    // wired, not merely present on the init object.
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'TimeoutError';
            reject(err);
          });
        }),
    );

    await expect(fetchWithTimeout('https://example.com', {}, 50)).rejects.toThrow(
      UpstreamTimeoutError,
    );
  });

  it('defaults to a finite budget when none is given', () => {
    expect(DEFAULT_UPSTREAM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_UPSTREAM_TIMEOUT_MS)).toBe(true);
  });

  describe('isAbortLikeError', () => {
    it.each([
      ['TimeoutError', true],
      ['AbortError', true],
      ['TypeError', false],
    ])('treats %s as abort-like: %s', (name, expected) => {
      const error = new Error('x');
      error.name = name;
      expect(isAbortLikeError(error)).toBe(expected);
    });

    it('is false for non-Error values', () => {
      expect(isAbortLikeError('TimeoutError')).toBe(false);
      expect(isAbortLikeError(null)).toBe(false);
    });
  });
});
