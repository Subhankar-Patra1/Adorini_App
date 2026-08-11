import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import * as crypto from 'crypto';

import { PaymentsService, PaymentsProviderError } from './payments.service';

jest.mock('cashfree-pg', () => {
  const mockPGCreateOrder = jest.fn();
  const mockPGFetchOrder = jest.fn();
  const mockCashfree = jest.fn().mockImplementation(() => ({
    PGCreateOrder: mockPGCreateOrder,
    PGFetchOrder: mockPGFetchOrder,
  }));
  return {
    Cashfree: mockCashfree,
    CFEnvironment: { SANDBOX: 'SANDBOX', PRODUCTION: 'PRODUCTION' },
  };
});

interface MockCashfreeInstance {
  PGCreateOrder: jest.Mock;
  PGFetchOrder: jest.Mock;
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let cashfree: MockCashfreeInstance;
  const webhookSecret = 'test_webhook_secret';

  const customer = {
    id: 'user_1',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '9999999999',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              switch (key) {
                case 'CASHFREE_APP_ID':
                  return 'test_app_id';
                case 'CASHFREE_SECRET_KEY':
                  return 'test_secret_key';
                case 'CASHFREE_ENV':
                  return 'SANDBOX';
                case 'CASHFREE_WEBHOOK_SECRET':
                  return webhookSecret;
                default:
                  return '';
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    cashfree = (Cashfree as unknown as jest.Mock).mock.results[0].value as MockCashfreeInstance;
  });

  it('should be defined and instantiate Cashfree', () => {
    expect(service).toBeDefined();
    expect(Cashfree).toHaveBeenCalledWith(CFEnvironment.SANDBOX, 'test_app_id', 'test_secret_key');
  });

  describe('createPaymentSession', () => {
    it('returns the session id and echoes the order id', async () => {
      cashfree.PGCreateOrder.mockResolvedValueOnce({
        data: { payment_session_id: 'session_123', order_id: 'order_123' },
      });

      const res = await service.createPaymentSession('order_123', 300000, customer);

      expect(res).toEqual({ paymentSessionId: 'session_123', orderId: 'order_123' });
      expect(cashfree.PGCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ order_amount: 3000, order_id: 'order_123' }),
      );
    });

    describe('paise to rupee conversion', () => {
      // Adorini stores integer paise; Cashfree wants rupees to two decimals.
      // Naive division produces values like 1299.5000000000001, which Cashfree
      // rejects or settles a paisa off — a mismatch someone reconciles by hand.
      it.each([
        [89900, 899],
        [129950, 1299.5],
        [32900, 329],
        [149999, 1499.99],
        [1, 0.01],
      ])('converts %i paise to %s rupees exactly', async (paise, rupees) => {
        cashfree.PGCreateOrder.mockResolvedValueOnce({
          data: { payment_session_id: 's', order_id: 'o' },
        });

        await service.createPaymentSession('o', paise, customer);

        const [request] = cashfree.PGCreateOrder.mock.calls[0] as [{ order_amount: number }];
        expect(request.order_amount).toBe(rupees);
        // Guards against float dust surviving the conversion.
        expect(request.order_amount.toString()).not.toMatch(/\d{6,}/);
      });
    });

    it('refuses a fractional paise amount', async () => {
      await expect(service.createPaymentSession('order_1', 100.5, customer)).rejects.toThrow(
        PaymentsProviderError,
      );
      expect(cashfree.PGCreateOrder).not.toHaveBeenCalled();
    });

    it('refuses a zero or negative amount', async () => {
      await expect(service.createPaymentSession('o', 0, customer)).rejects.toThrow(
        PaymentsProviderError,
      );
      await expect(service.createPaymentSession('o', -500, customer)).rejects.toThrow(
        PaymentsProviderError,
      );
      expect(cashfree.PGCreateOrder).not.toHaveBeenCalled();
    });

    it('throws PaymentsProviderError when the SDK fails', async () => {
      cashfree.PGCreateOrder.mockRejectedValueOnce(new Error('SDK Error'));

      await expect(service.createPaymentSession('order_123', 10000, customer)).rejects.toThrow(
        PaymentsProviderError,
      );
    });

    it('reports a missing session id once, not double-wrapped', async () => {
      // Cashfree accepting the order but returning no session id is a contract
      // violation, not a transport failure. An earlier version threw this
      // inside its own try block, so the catch restated it as
      // "Failed to create ...: Cashfree did not return ..." — a message that
      // describes itself twice and hides which failure actually occurred.
      cashfree.PGCreateOrder.mockResolvedValueOnce({ data: { order_id: 'order_123' } });

      const error = (await service
        .createPaymentSession('order_123', 10000, customer)
        .catch((e: unknown) => e)) as PaymentsProviderError;

      expect(error).toBeInstanceOf(PaymentsProviderError);
      expect(error.message).toContain('no payment_session_id');
      expect(error.message).not.toContain('Failed to create Cashfree payment session');
    });
  });

  describe('reconcilePayment', () => {
    it('returns a typed snapshot of Cashfree order state', async () => {
      cashfree.PGFetchOrder.mockResolvedValueOnce({
        data: {
          order_id: 'order_123',
          order_status: 'PAID',
          order_amount: 899,
          payment_session_id: 'session_123',
        },
      });

      await expect(service.reconcilePayment('order_123')).resolves.toMatchObject({
        orderId: 'order_123',
        orderStatus: 'PAID',
        orderAmount: 899,
      });
    });

    it('throws PaymentsProviderError when the fetch fails', async () => {
      cashfree.PGFetchOrder.mockRejectedValueOnce(new Error('network down'));

      await expect(service.reconcilePayment('order_123')).rejects.toThrow(PaymentsProviderError);
    });
  });

  describe('verifyWebhookSignature', () => {
    const timestamp = '1690000000000';
    const rawBody = '{"event":"PAYMENT_SUCCESS"}';

    function sign(body: string, secret = webhookSecret, ts = timestamp): string {
      return crypto
        .createHmac('sha256', secret)
        .update(ts + body)
        .digest('base64');
    }

    it('accepts a correctly signed payload', () => {
      expect(service.verifyWebhookSignature(sign(rawBody), timestamp, rawBody)).toBe(true);
    });

    it('rejects a signature made with the wrong secret', () => {
      const forged = sign(rawBody, 'attacker_secret');

      expect(service.verifyWebhookSignature(forged, timestamp, rawBody)).toBe(false);
    });

    it('rejects a tampered body', () => {
      // The attack this blocks: replaying a genuine signature against an
      // altered payload — e.g. changing the order amount or status to PAID.
      const signature = sign(rawBody);
      const tampered = '{"event":"PAYMENT_SUCCESS","order_amount":1}';

      expect(service.verifyWebhookSignature(signature, timestamp, tampered)).toBe(false);
    });

    it('rejects a replayed signature under a different timestamp', () => {
      expect(service.verifyWebhookSignature(sign(rawBody), '1690000009999', rawBody)).toBe(false);
    });

    it('rejects a garbage signature without throwing on length mismatch', () => {
      // timingSafeEqual throws when buffer lengths differ; the length check has
      // to come first or an attacker learns the digest length from a 500.
      expect(service.verifyWebhookSignature('short', timestamp, rawBody)).toBe(false);
      expect(service.verifyWebhookSignature('x'.repeat(500), timestamp, rawBody)).toBe(false);
    });

    it('rejects empty inputs', () => {
      expect(service.verifyWebhookSignature('', timestamp, rawBody)).toBe(false);
      expect(service.verifyWebhookSignature(sign(rawBody), '', rawBody)).toBe(false);
      expect(service.verifyWebhookSignature(sign(rawBody), timestamp, '')).toBe(false);
    });
  });
});
