import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import * as crypto from 'crypto';

import type { Env } from '../../config/env.validation';

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

    const cfEnv =
      env === 'PRODUCTION' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;

    this.cashfree = new Cashfree(cfEnv, appId, secretKey);
  }

  /**
   * Creates a Cashfree payment session for an order.
   * `amountPaise` is converted to rupees for Cashfree order creation.
   */
  async createPaymentSession(
    orderId: string,
    amountPaise: number,
    customer: CreateOrderCustomerDetails,
    currency = 'INR',
  ): Promise<{ paymentSessionId: string; orderId: string }> {
    try {
      const amountRupees = amountPaise / 100;
      const request = {
        order_amount: amountRupees,
        order_currency: currency,
        order_id: orderId,
        customer_details: {
          customer_id: customer.id,
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone,
        },
      };

      const response = await this.cashfree.PGCreateOrder(request);

      if (!response.data || !response.data.payment_session_id) {
        throw new PaymentsProviderError('Cashfree did not return a valid payment_session_id');
      }

      return {
        paymentSessionId: response.data.payment_session_id,
        orderId: response.data.order_id ?? orderId,
      };
    } catch (error) {
      this.logger.error(`Cashfree PGCreateOrder failed for order ${orderId}`, error);
      throw new PaymentsProviderError(
        `Failed to create Cashfree payment session: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Reconciles order state from Cashfree.
   */
  async reconcilePayment(orderId: string): Promise<any> {
    try {
      const response = await this.cashfree.PGFetchOrder(orderId);

      return response.data;
    } catch (error) {
      this.logger.error(`Cashfree PGFetchOrder failed for order ${orderId}`, error);
      throw new PaymentsProviderError(
        `Failed to reconcile payment for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Cryptographically verifies Cashfree webhook signature header against the raw body & timestamp.
   */
  verifyWebhookSignature(signature: string, timestamp: string, rawBody: string): boolean {
    if (!signature || !timestamp || !rawBody) {
      return false;
    }

    try {
      const data = timestamp + rawBody;
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(data)
        .digest('base64');

      return expectedSignature === signature;
    } catch (err) {
      this.logger.error('Error verifying Cashfree webhook signature', err);
      return false;
    }
  }
}
