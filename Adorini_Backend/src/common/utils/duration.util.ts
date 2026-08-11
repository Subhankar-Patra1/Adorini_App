/**
 * Converts a `jsonwebtoken`-style duration (`15m`, `30d`, `900`) to seconds.
 *
 * The same config string has to configure the JWT signer *and* the `expires_at`
 * column on the refresh-token row. Resolving it to a number once, here, means
 * the two cannot disagree — otherwise a token could be live in the database and
 * already rejected by the verifier, or the reverse.
 *
 * Passing a number to `signAsync` also sidesteps the JWT typings, which only
 * accept a narrow template-literal string type rather than a plain `string`.
 */
export function durationToSeconds(duration: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(duration.trim());

  if (!match) {
    throw new Error(
      `Unsupported token duration: "${duration}". Use seconds, or a value like 15m / 24h / 30d.`,
    );
  }

  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2] ?? 's'];
}
