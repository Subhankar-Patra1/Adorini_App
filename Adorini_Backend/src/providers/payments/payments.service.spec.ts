import { Test, TestingModule } from '@nestjs/testing';
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

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockCashfreeInstance: any;
  const webhookSecret = 'test_webhook_secret';

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
    mockCashfreeInstance = (Cashfree as unknown as jest.Mock).mock.results[0].value;
  });

  it('should be defined and instantiate Cashfree', () => {
    expect(service).toBeDefined();
    expect(Cashfree).toHaveBeenCalledWith(CFEnvironment.SANDBOX, 'test_app_id', 'test_secret_key');
  });

  describe('createPaymentSession', () => {
    it('should call PGCreateOrder and return session ID', async () => {
      mockCashfreeInstance.PGCreateOrder.mockResolvedValueOnce({
        data: { payment_session_id: 'session_123', order_id: 'order_123' },
      });

      const res = await service.createPaymentSession('order_123', 300000, {
        id: 'user_1',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '9999999999',
      });

      expect(res).toEqual({ paymentSessionId: 'session_123', orderId: 'order_123' });
      expect(mockCashfreeInstance.PGCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ order_amount: 3000, order_id: 'order_123' }),
      );
    });

    it('should throw PaymentsProviderError if Cashfree fails', async () => {
      mockCashfreeInstance.PGCreateOrder.mockRejectedValueOnce(new Error('SDK Error'));

      await expect(
        service.createPaymentSession('order_123', 10000, {
          id: 'u1',
          name: 'N',
          email: 'e@e.com',
          phone: '1',
        }),
      ).rejects.toThrow(PaymentsProviderError);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should return true for a valid signature', () => {
      const timestamp = '1690000000000';
      const rawBody = '{"event":"PAYMENT_SUCCESS"}';
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(timestamp + rawBody)
        .digest('base64');

      const isValid = service.verifyWebhookSignature(signature, timestamp, rawBody);
      expect(isValid).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const isValid = service.verifyWebhookSignature('invalid_sig', '1690000000000', '{}');
      expect(isValid).toBe(false);
    });
  });
});
