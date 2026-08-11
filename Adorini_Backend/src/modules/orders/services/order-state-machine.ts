import { ConflictException } from '@nestjs/common';

import { OrderStatus, PaymentMethod } from '../../../common/enums/domain.enums';

/**
 * The legal order lifecycle, as a data structure rather than scattered `if`s.
 *
 * SPEC requires illegal transitions be *rejected*, not silently ignored: a
 * Delhivery scan claiming a cancelled order was delivered is a data-integrity
 * problem someone needs to see, and swallowing it would let a refunded order
 * quietly trigger a referral payout.
 *
 * `DELIVERED` and `CANCELLED` are terminal — nothing legal follows them. Returns
 * (Phase 4 `returns`) are modelled as their own records against a delivered
 * order, deliberately not as a further order status, so that "was this ever
 * delivered?" stays answerable from the order alone.
 */
const LEGAL_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.ORDERED]: [
    // COD orders divert through intent verification; prepaid orders confirm
    // directly off a successful payment webhook.
    OrderStatus.PENDING_VERIFICATION,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PENDING_VERIFICATION]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  // Cancellable after dispatch because an RTO comes back as a cancellation.
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

export class IllegalOrderTransitionError extends ConflictException {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
    orderId: string,
  ) {
    super(`Order ${orderId} cannot move from ${from} to ${to}`);
  }
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return LEGAL_TRANSITIONS[status].length === 0;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Throws unless the move is legal. Re-entering the current status is *not* an
 * error and is handled by the caller as a no-op: couriers emit several scans
 * with the same status, so treating a repeat as illegal would turn routine
 * tracking noise into failed webhooks and endless provider retries.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus, orderId: string): void {
  if (!canTransition(from, to)) {
    throw new IllegalOrderTransitionError(from, to, orderId);
  }
}

/**
 * Where a successful payment should land an order.
 *
 * COD cannot confirm on payment — there is no payment until the parcel arrives —
 * so it goes to intent verification instead, which is what the MSG91 OTP step
 * exists to clear.
 */
export function statusAfterSuccessfulPayment(paymentMethod: PaymentMethod): OrderStatus {
  return paymentMethod === PaymentMethod.COD
    ? OrderStatus.PENDING_VERIFICATION
    : OrderStatus.CONFIRMED;
}
