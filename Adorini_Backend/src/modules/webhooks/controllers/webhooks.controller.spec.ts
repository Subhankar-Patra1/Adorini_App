import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { WebhooksController } from './webhooks.controller';
import type { Env } from '../../../config/env.validation';
import { PaymentsService } from '../../../providers/payments/payments.service';
import { WebhooksService } from '../services/webhooks.service';

const DELHIVERY_TOKEN = 'd'.repeat(24);

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let webhooks: { handleCashfree: jest.Mock; handleDelhivery: jest.Mock };
  let payments: { verifyWebhookSignature: jest.Mock };

  const rawRequest = (body: unknown) =>
    ({ rawBody: Buffer.from(JSON.stringify(body), 'utf8') }) as never;

  const cashfreeBody = {
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: { order: { order_id: 'cf-1' }, payment: { cf_payment_id: 1 } },
  };

  beforeEach(async () => {
    webhooks = {
      handleCashfree: jest.fn().mockResolvedValue('processed'),
      handleDelhivery: jest.fn().mockResolvedValue('processed'),
    };
    payments = { verifyWebhookSignature: jest.fn().mockReturnValue(true) };

    const config: Partial<ConfigService<Env, true>> = {
      get: jest.fn((key: string) =>
        key === 'DELHIVERY_WEBHOOK_TOKEN' ? DELHIVERY_TOKEN : '',
      ) as never,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhooksService, useValue: webhooks },
        { provide: PaymentsService, useValue: payments },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    controller = module.get(WebhooksController);
  });

  describe('cashfree', () => {
    it('verifies the signature against the exact raw bytes received', async () => {
      const request = rawRequest(cashfreeBody);

      await controller.cashfree(request, 'sig', '12345');

      expect(payments.verifyWebhookSignature).toHaveBeenCalledWith(
        'sig',
        '12345',
        (request as unknown as { rawBody: Buffer }).rawBody.toString('utf8'),
      );
    });

    it('processes a correctly signed payload', async () => {
      const result = await controller.cashfree(rawRequest(cashfreeBody), 'sig', '1');

      expect(result).toEqual({ outcome: 'processed' });
      expect(webhooks.handleCashfree).toHaveBeenCalled();
    });

    it('rejects an invalid signature before parsing or handling the payload', async () => {
      payments.verifyWebhookSignature.mockReturnValue(false);

      await expect(controller.cashfree(rawRequest(cashfreeBody), 'bad', '1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(webhooks.handleCashfree).not.toHaveBeenCalled();
    });

    it.each([undefined, ''])('rejects a missing signature header (%s)', async (signature) => {
      payments.verifyWebhookSignature.mockReturnValue(false);

      await expect(controller.cashfree(rawRequest(cashfreeBody), signature, '1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a request with no body', async () => {
      await expect(controller.cashfree({} as never, 'sig', '1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a signed payload that does not match the expected shape', async () => {
      await expect(controller.cashfree(rawRequest({ type: 'X' }), 'sig', '1')).rejects.toThrow();
      expect(webhooks.handleCashfree).not.toHaveBeenCalled();
    });
  });

  describe('delhivery', () => {
    const body = {
      Shipment: { AWB: 'AWB1', Status: { StatusType: 'DL', StatusDateTime: '2026-08-12' } },
    };

    it('accepts a request carrying the configured token', async () => {
      const result = await controller.delhivery(body, DELHIVERY_TOKEN);

      expect(result).toEqual({ outcome: 'processed' });
      expect(webhooks.handleDelhivery).toHaveBeenCalled();
    });

    it.each([undefined, '', 'wrong-token', 'd'.repeat(23)])('rejects token %s', async (token) => {
      await expect(controller.delhivery(body, token)).rejects.toThrow(UnauthorizedException);
      expect(webhooks.handleDelhivery).not.toHaveBeenCalled();
    });

    it('rejects a malformed payload even with a valid token', async () => {
      await expect(controller.delhivery({ nope: true }, DELHIVERY_TOKEN)).rejects.toThrow();
      expect(webhooks.handleDelhivery).not.toHaveBeenCalled();
    });
  });
});
