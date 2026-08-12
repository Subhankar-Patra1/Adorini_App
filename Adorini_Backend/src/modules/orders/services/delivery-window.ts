import { OrderStatus } from '../../../common/enums/domain.enums';

export interface DeliveryWindowRules {
  /** Total courier hand-over attempts allowed before the parcel returns to origin. */
  maxAttempts: number;
  /** How long the buyer has to answer the retry prompt, measured from the failed attempt. */
  responseWindowHours: number;
}

export interface RetryOfferInput extends DeliveryWindowRules {
  status: OrderStatus;
  deliveryAttempts: number;
  lastDeliveryFailedAt: Date | null;
}

export interface RetryOffer {
  /** Whether a reattempt can still be booked right now. */
  canRequestReattempt: boolean;
  /** Deadline for answering; drives the app's countdown. */
  respondByIso: string | null;
  attemptsRemaining: number;
}

/**
 * A pure function rather than a method, because two callers need the identical
 * answer from different starting points: `DeliveryFailureService` guards the
 * write path with it, and the buyer-facing order detail renders from it. If the
 * screen said "you have 6 hours left" while the write path disagreed, the buyer
 * would tap a button that then refused them — so this arithmetic has exactly
 * one home.
 */
export function describeRetryOffer(input: RetryOfferInput): RetryOffer {
  const attemptsRemaining = Math.max(0, input.maxAttempts - input.deliveryAttempts);
  const respondBy = deliveryResponseDeadline(input.lastDeliveryFailedAt, input.responseWindowHours);

  return {
    canRequestReattempt:
      input.status === OrderStatus.DELIVERY_FAILED &&
      attemptsRemaining > 0 &&
      !isResponseWindowExpired(input.lastDeliveryFailedAt, input.responseWindowHours),
    respondByIso: respondBy?.toISOString() ?? null,
    attemptsRemaining,
  };
}

export function deliveryResponseDeadline(
  lastDeliveryFailedAt: Date | null,
  responseWindowHours: number,
): Date | null {
  if (!lastDeliveryFailedAt) {
    return null;
  }

  return new Date(lastDeliveryFailedAt.getTime() + responseWindowHours * 60 * 60 * 1000);
}

/**
 * Measured from the failed attempt, not from when the prompt was sent: a
 * WhatsApp message delayed by a provider outage must not eat into the buyer's
 * window.
 *
 * A missing failure timestamp counts as expired — we cannot prove the window is
 * open, and refusing is the safer default for a decision that moves stock.
 */
export function isResponseWindowExpired(
  lastDeliveryFailedAt: Date | null,
  responseWindowHours: number,
): boolean {
  const deadline = deliveryResponseDeadline(lastDeliveryFailedAt, responseWindowHours);

  if (!deadline) {
    return true;
  }

  return Date.now() > deadline.getTime();
}
