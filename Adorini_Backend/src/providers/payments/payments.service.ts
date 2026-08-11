import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import * as crypto from 'crypto';

import type { Env } from '../../config/env.validation';

/** Cashfree rejected the request, was unreachable, or returned an unusable body. */
export class PaymentsProviderError extends Error {
  constructor(
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'PaymentsProviderError';
  }
}

export interface CreateOrderCustomerDetails {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface PaymentSession {
  paymentSessionId: string;
  orderId: string;
}

/** The subset of Cashfree's order payload the rest of Adorini relies on. */
export interface CashfreeOrderSnapshot {
  orderId: string;
  orderStatus?: string;
  orderAmount?: number;
  paymentSessionId?: string;
  raw: unknown;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly cashfree: Cashfree;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<Env, true>) {
    const appId = config.get('CASHFREE_APP_ID', { infer: true });
    const secretKey = config.get('CASHFREE_SECRET_KEY', { infer: true });
    const env = config.get('CASHFREE_ENV', { infer: true });
    this.webhookSecret = config.get('CASHFREE_WEBHOOK_SECRET', { infer: true });

    const cfEnv = env === 'PRODUCTION' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;

    this.cashfree = new Cashfree(cfEnv, appId, secretKey);
  }

  /**
   * Opens a Cashfree payment session for an order.
   *
   * Adorini holds money as integer paise everywhere (see the `*_paise` columns);
   * Cashfree's API takes rupees with two decimals. `toFixed(2)` before
   * `Number()` is not decoration — plain `amountPaise / 100` can land on values
   * like `1299.5000000000001`, and sending that as an order amount is a
   * rejected payment or a one-paisa reconciliation mismatch that someone has to
   * chase later.
   */
  async createPaymentSession(
    orderId: string,
    amountPaise: number,
    customer: CreateOrderCustomerDetails,
    currency = 'INR',
  ): Promise<PaymentSession> {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new PaymentsProviderError(
        `Refusing to open a payment session for a non-positive or fractional amount: ${amountPaise} paise`,
      );
    }

    const orderAmountRupees = Number((amountPaise / 100).toFixed(2));

    let response: Awaited<ReturnType<Cashfree['PGCreateOrder']>>;
    try {
      response = await this.cashfree.PGCreateOrder({
        order_amount: orderAmountRupees,
        order_currency: currency,
        order_id: orderId,
        customer_details: {
          customer_id: customer.id,
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone,
        },
      });
    } catch (error) {
      this.logger.error(`Cashfree PGCreateOrder failed for order ${orderId}`, error);
      throw new PaymentsProviderError(
        `Failed to create Cashfree payment session: ${describeError(error)}`,
        error,
      );
    }

    // Deliberately outside the try: a missing session id is a contract
    // violation by Cashfree, not a transport failure, and wrapping it in the
    // catch above would have restated it as "Failed to create ... : Cashfree
    // did not return ..." — a message that describes itself twice and hides
    // which of the two things actually went wrong.
    const paymentSessionId = response?.data?.payment_session_id;
    if (!paymentSessionId) {
      this.logger.error(`Cashfree returned no payment_session_id for order ${orderId}`);
      throw new PaymentsProviderError(
        `Cashfree accepted order ${orderId} but returned no payment_session_id`,
        response?.data,
      );
    }

    return {
      paymentSessionId,
      orderId: response.data?.order_id ?? orderId,
    };
  }

  /**
   * Fetches Cashfree's view of an order.
   *
   * Cashfree is the authority on whether money moved — this is what the
   * webhook handler and any reconciliation job compare local state against.
   */
  async reconcilePayment(orderId: string): Promise<CashfreeOrderSnapshot> {
    try {
      const response = await this.cashfree.PGFetchOrder(orderId);
      const data = response?.data;

      return {
        orderId: data?.order_id ?? orderId,
        orderStatus: data?.order_status,
        orderAmount: data?.order_amount,
        paymentSessionId: data?.payment_session_id,
        raw: data,
      };
    } catch (error) {
      this.logger.error(`Cashfree PGFetchOrder failed for order ${orderId}`, error);
      throw new PaymentsProviderError(
        `Failed to reconcile payment for order ${orderId}: ${describeError(error)}`,
        error,
      );
    }
  }

  /**
   * Verifies a Cashfree webhook's HMAC signature over `timestamp + rawBody`.
   *
   * The comparison is `crypto.timingSafeEqual`, not `===`. String equality
   * short-circuits on the first differing byte, so response time leaks how much
   * of a guessed signature was correct — enough, over many attempts, to forge
   * one byte at a time. This endpoint decides whether a payment is treated as
   * settled and whether a referral pays out, so a forged signature is a
   * direct route to free money.
   *
   * `rawBody` must be the exact bytes received. Re-serialising the parsed JSON
   * changes key order and whitespace and will never match.
   */
  verifyWebhookSignature(signature: string, timestamp: string, rawBody: string): boolean {
    if (!signature || !timestamp || !rawBody) {
      return false;
    }

    try {
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(timestamp + rawBody)
        .digest('base64');

      const expectedBuf = Buffer.from(expected, 'utf8');
      const providedBuf = Buffer.from(signature, 'utf8');

      // timingSafeEqual throws on length mismatch, which would itself leak
      // length via an exception path — check it first and bail uniformly.
      if (expectedBuf.length !== providedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, providedBuf);
    } catch (error) {
      this.logger.error('Error verifying Cashfree webhook signature', error);
      return false;
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
