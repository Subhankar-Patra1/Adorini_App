/**
 * Why a referral was or was not recorded at signup.
 *
 * Returned alongside the boolean `referralApplied` so the client can say
 * something true instead of one generic failure. The distinction is not
 * cosmetic: "this number was already referred" and "that code doesn't exist"
 * need opposite advice — one means *stop retyping it*, the other means *check
 * the spelling*. Collapsing them sends a buyer holding a perfectly valid code
 * into a retry loop and then into a support conversation.
 *
 * Named `ReferralOutcome`, not `ReferralStatus`, because `ReferralStatus`
 * already exists in `domain.enums.ts` as the referral's persisted lifecycle
 * (PENDING → CREDITED / VOID). This one is not stored anywhere; it describes
 * what happened during a single signup attempt.
 */
export enum ReferralOutcome {
  /** Recorded as PENDING. Pays out when the referee's first order is delivered. */
  APPLIED = 'APPLIED',

  /** No code was supplied. The overwhelmingly common case. */
  NOT_PROVIDED = 'NOT_PROVIDED',

  /** No account owns that code — almost always a typo or a stale screenshot. */
  CODE_NOT_FOUND = 'CODE_NOT_FOUND',

  /**
   * The code belongs to the person signing up.
   *
   * Unreachable through the current flow — a brand-new account has no referral
   * code of its own to enter — but the check exists in the service and the
   * database enforces it too (`chk_referral_no_self_referral`), so it gets its
   * own value rather than being silently folded into CODE_NOT_FOUND.
   */
  SELF_REFERRAL = 'SELF_REFERRAL',

  /**
   * This phone number has been referred before.
   *
   * Deliberately survives account deletion (ADR-008): the uniqueness is on the
   * phone, not the account, so deleting and re-registering cannot mint a second
   * reward. A buyer hitting this is not doing anything wrong — the number was
   * simply used once already, possibly long ago — so the message should say the
   * offer is used up, never "invalid code".
   */
  ALREADY_REFERRED = 'ALREADY_REFERRED',

  /**
   * A code arrived, but this was a sign-in rather than a signup.
   *
   * Referrals attach only at account creation. Worth its own value because the
   * honest message is "referral codes only apply to new accounts", which is
   * quite different from the code being wrong.
   */
  EXISTING_USER = 'EXISTING_USER',

  /**
   * Something failed while recording it — a database blip, most likely.
   *
   * The signup itself still succeeded; referral bookkeeping is never allowed to
   * fail account creation. Surfaced separately so this reads in support as our
   * problem rather than the buyer's.
   */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** The single outcome that actually creates a referral row. */
export function isReferralApplied(outcome: ReferralOutcome): boolean {
  return outcome === ReferralOutcome.APPLIED;
}
