import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DiscountType } from '../../../common/enums/domain.enums';
import type { Env } from '../../../config/env.validation';

export interface PriceableLine {
  /** Live unit price in paise, read from the variant/product at read time. */
  unitPricePaise: number;
  quantity: number;
}

/** Just enough of a `Coupon` row for the arithmetic — never the whole entity. */
export interface CouponDiscountInput {
  discountType: DiscountType;
  discountValue: number;
  maxDiscountPaise: number | null;
}

export type DiscountSource = 'FIRST_ORDER' | 'COUPON' | 'NONE';

export interface OrderTotals {
  subtotalPaise: number;
  discountPaise: number;
  /**
   * Which promotion actually produced `discountPaise`. First-order and coupon
   * discounts do not stack — see `calculate` — so at most one of them is ever
   * the source, and the client needs to know which to label correctly ("first
   * order" vs the coupon code) rather than being handed one opaque number.
   */
  discountSource: DiscountSource;
  deliveryFeePaise: number;
  walletCreditPaise: number;
  totalPaise: number;
  /** Paise still needed to unlock free delivery; 0 once qualified. */
  freeDeliveryShortfallPaise: number;
  qualifiesForFreeDelivery: boolean;
}

export interface TotalsInput {
  lines: PriceableLine[];
  /** First-order discount applies only to a buyer's first *placed* order. */
  isFirstOrder: boolean;
  /** How much wallet credit the buyer asked to spend, before clamping. */
  requestedWalletCreditPaise?: number;
  /** The buyer's actual wallet balance — the hard ceiling on credit applied. */
  availableWalletCreditPaise?: number;
  /**
   * A coupon already validated by `CouponsService` — eligibility (active,
   * date range, minimum order, redemption limits) is that service's job, not
   * this one's. This function only ever turns a *valid* coupon into paise.
   */
  couponDiscount?: CouponDiscountInput | null;
}

/**
 * The single place order money is calculated.
 *
 * @GUARD Risk #3 (HIGH): the client never supplies a price, a discount, a
 * delivery fee or a total — it supplies quantities and a wallet-credit
 * *request*, and everything else is derived here from the catalogue and the
 * configured business rules. A tampered payload can therefore change what is
 * bought, never what it costs.
 *
 * Cart preview and checkout placement both call this, so the number the buyer
 * is shown and the number they are charged come from the same code. Two
 * separate implementations would drift, and the drift would surface as a
 * customer being charged something other than what they agreed to.
 *
 * Everything is integer paise. There is no floating-point arithmetic anywhere
 * in this file, and no rounding step that could lose or invent a paisa.
 */
@Injectable()
export class PricingService {
  private readonly freeDeliveryThresholdPaise: number;
  private readonly deliveryFeePaise: number;
  private readonly firstOrderDiscountPercent: number;

  constructor(config: ConfigService<Env, true>) {
    this.freeDeliveryThresholdPaise = config.get('FREE_DELIVERY_THRESHOLD_PAISE', {
      infer: true,
    });
    this.deliveryFeePaise = config.get('DELIVERY_FEE_PAISE', { infer: true });
    this.firstOrderDiscountPercent = config.get('FIRST_ORDER_DISCOUNT_PERCENT', {
      infer: true,
    });
  }

  calculate(input: TotalsInput): OrderTotals {
    const subtotalPaise = input.lines.reduce(
      (sum, line) => sum + line.unitPricePaise * line.quantity,
      0,
    );

    const firstOrderDiscountPaise = input.isFirstOrder
      ? Math.floor((subtotalPaise * this.firstOrderDiscountPercent) / 100)
      : 0;

    const couponDiscountPaise = input.couponDiscount
      ? this.computeCouponDiscount(subtotalPaise, input.couponDiscount)
      : 0;

    /**
     * Mutually exclusive, not additive: the larger benefit wins. A buyer who
     * qualifies for both a first-order discount and a coupon gets whichever
     * saves them more, never both added together — stacking two independent
     * promotions was never a decision anyone made on purpose, and undoing an
     * accidental stack after coupons ship is a margin conversation nobody
     * wants to have. See ADR-032.
     */
    const discountPaise = Math.max(firstOrderDiscountPaise, couponDiscountPaise);
    const discountSource: DiscountSource =
      discountPaise === 0
        ? 'NONE'
        : couponDiscountPaise > firstOrderDiscountPaise
          ? 'COUPON'
          : 'FIRST_ORDER';

    // Threshold is measured on the subtotal, before discount. Measuring it
    // after would let a discount push a qualifying order back under the bar and
    // add a delivery fee the buyer was already promised they had escaped.
    const qualifiesForFreeDelivery = subtotalPaise >= this.freeDeliveryThresholdPaise;
    const deliveryFeePaise = qualifiesForFreeDelivery ? 0 : this.deliveryFeePaise;

    const payableBeforeCredit = subtotalPaise - discountPaise + deliveryFeePaise;

    /**
     * Wallet credit is clamped three ways: to what was asked for, to what the
     * buyer actually has, and to what is still owed. The last one matters —
     * without it a large balance on a small order would produce a negative
     * total, which the `chk_order_amounts_non_negative` constraint would reject
     * at the very end of checkout, after stock had already been taken.
     */
    const walletCreditPaise = Math.max(
      0,
      Math.min(
        input.requestedWalletCreditPaise ?? 0,
        input.availableWalletCreditPaise ?? 0,
        payableBeforeCredit,
      ),
    );

    return {
      subtotalPaise,
      discountPaise,
      discountSource,
      deliveryFeePaise,
      walletCreditPaise,
      totalPaise: payableBeforeCredit - walletCreditPaise,
      qualifiesForFreeDelivery,
      freeDeliveryShortfallPaise: qualifiesForFreeDelivery
        ? 0
        : this.freeDeliveryThresholdPaise - subtotalPaise,
    };
  }

  private computeCouponDiscount(subtotalPaise: number, coupon: CouponDiscountInput): number {
    const raw =
      coupon.discountType === DiscountType.PERCENT
        ? Math.floor((subtotalPaise * coupon.discountValue) / 100)
        : coupon.discountValue;

    const capped = coupon.maxDiscountPaise !== null ? Math.min(raw, coupon.maxDiscountPaise) : raw;

    // Never discount more than the order is actually worth.
    return Math.min(capped, subtotalPaise);
  }
}
