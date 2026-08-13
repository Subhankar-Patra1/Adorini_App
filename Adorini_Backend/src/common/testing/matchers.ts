/**
 * Typed wrappers around Jest's asymmetric matchers.
 *
 * `expect.any()` is declared as `any`, so dropping it into an object literal
 * passed to `toEqual` spreads that `any` across the whole literal and trips the
 * project's no-`any` rules. These helpers keep the matcher's behaviour while
 * presenting the type of the field they stand in for, in the same spirit as
 * `body<T>()` in `http-body.ts`: one deliberate cast, in one place, instead of
 * an `any` leaking through every spec.
 *
 * The `unknown` hop is load-bearing. Casting `expect.any(...)` straight to the
 * target type is an assertion on an `any`, which `--fix` strips as redundant —
 * putting the `any` right back. Laundering through `unknown` first makes the
 * assertion a real narrowing that survives the autofixer.
 */

const asymmetricMatcher = (constructor: unknown): unknown => {
  const matcher: unknown = expect.any(constructor);
  return matcher;
};

/** Matches any string — for message fields whose exact wording is not the point. */
export const anyString = (): string => asymmetricMatcher(String) as string;

/** Matches any `Date` — for timestamps the code stamps as "now". */
export const anyDate = (): Date => asymmetricMatcher(Date) as Date;
