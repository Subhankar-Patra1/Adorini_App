import { durationToSeconds } from './duration.util';

describe('durationToSeconds', () => {
  it.each([
    ['15m', 900],
    ['30d', 2_592_000],
    ['24h', 86_400],
    ['45s', 45],
    ['900', 900],
    [' 15m ', 900],
  ])('converts %s to %i seconds', (input, expected) => {
    expect(durationToSeconds(input)).toBe(expected);
  });

  it('matches the JWT library for the values actually configured', () => {
    // These are the defaults in env.validation.ts. If this drifts, a refresh
    // row's expires_at would disagree with the token the verifier accepts.
    expect(durationToSeconds('15m')).toBe(15 * 60);
    expect(durationToSeconds('30d')).toBe(30 * 24 * 60 * 60);
  });

  it.each(['', 'forever', '15 minutes', '-5m', '15y', 'm15'])(
    'throws on unsupported duration %s',
    (input) => {
      // Failing loudly at startup beats silently issuing a token with the wrong
      // lifetime, which would only show up as unexplained logouts.
      expect(() => durationToSeconds(input)).toThrow(/Unsupported token duration/);
    },
  );
});
