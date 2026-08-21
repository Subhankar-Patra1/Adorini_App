import { Test, type TestingModule } from '@nestjs/testing';

import { WhatsappBotService } from './whatsapp-bot.service';
import { WebhookProvider } from '../../../common/enums/domain.enums';
import { DeliveryFailureService } from '../../orders/services/delivery-failure.service';
import { WebhookIdempotencyService } from '../../webhooks/services/webhook-idempotency.service';

describe('WhatsappBotService', () => {
  let service: WhatsappBotService;
  let deliveryFailures: { requestReattemptByPhone: jest.Mock };
  let idempotency: { ingest: jest.Mock };

  const message = (text: string, fromPhone = '919876543210', messageId = 'msg-1') => ({
    messageId,
    fromPhone,
    text,
  });

  beforeEach(async () => {
    deliveryFailures = {
      requestReattemptByPhone: jest
        .fn()
        .mockResolvedValue({ requested: true, orderNumber: 'ADR-1', attemptsUsed: 1 }),
    };
    idempotency = {
      ingest: jest.fn().mockResolvedValue({ status: 'processed', result: 'accepted' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappBotService,
        { provide: DeliveryFailureService, useValue: deliveryFailures },
        { provide: WebhookIdempotencyService, useValue: idempotency },
      ],
    }).compile();

    service = module.get(WhatsappBotService);
  });

  describe('de-duplication', () => {
    it('records the inbound message through the shared idempotency layer', async () => {
      await service.handleInbound(message('yes'));

      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: WebhookProvider.WHATSAPP,
          eventId: 'inbound:msg-1',
          eventType: 'WHATSAPP_INBOUND',
        }),
        expect.any(Function),
      );
    });

    it('takes no action on a replayed message', async () => {
      // Meta redelivers on non-2xx; a replayed "yes" must not book a second
      // courier reattempt.
      idempotency.ingest.mockResolvedValue({ status: 'duplicate' });

      const outcome = await service.handleInbound(message('yes'));

      expect(outcome).toBe('duplicate');
      expect(deliveryFailures.requestReattemptByPhone).not.toHaveBeenCalled();
    });
  });

  describe('affirmative replies', () => {
    it.each([
      '1',
      'y',
      'yes',
      'Yes',
      'YES',
      'yes please',
      'yeah',
      'ok',
      'sure',
      'retry',
      'try again',
      'haan',
      'Yes.',
      '  yes  ',
    ])('treats %j as "still want it"', async (text) => {
      const outcome = await service.handleInbound(message(text));

      expect(outcome).toBe('reattempt_requested');
      expect(deliveryFailures.requestReattemptByPhone).toHaveBeenCalledWith('919876543210');
    });

    it('normalises the sender number before matching the account', async () => {
      // `users.phone` is stored E.164-without-plus; Meta may report otherwise.
      await service.handleInbound(message('yes', '+91 98765 43210'));

      expect(deliveryFailures.requestReattemptByPhone).toHaveBeenCalledWith('919876543210');
    });

    it('reports an unparseable sender rather than guessing', async () => {
      const outcome = await service.handleInbound(message('yes', 'not-a-number'));

      expect(outcome).toBe('no_matching_order');
      expect(deliveryFailures.requestReattemptByPhone).not.toHaveBeenCalled();
    });

    it.each([
      ['WINDOW_EXPIRED', 'window_expired'],
      ['ATTEMPTS_EXHAUSTED', 'attempts_exhausted'],
      ['NO_FAILED_ORDER', 'no_matching_order'],
    ])('surfaces a %s refusal as %s', async (reason, expected) => {
      deliveryFailures.requestReattemptByPhone.mockResolvedValue({ requested: false, reason });

      expect(await service.handleInbound(message('yes'))).toBe(expected);
    });
  });

  describe('negative replies', () => {
    it.each(['2', 'n', 'no', 'No', 'cancel', 'nahi', 'no thanks'])(
      'treats %j as a decline and leaves the sweep to close the order',
      async (text) => {
        const outcome = await service.handleInbound(message(text));

        expect(outcome).toBe('declined');
        // Deliberately no cancellation here — one code path owns cancelling.
        expect(deliveryFailures.requestReattemptByPhone).not.toHaveBeenCalled();
      },
    );
  });

  describe('anything else', () => {
    it.each(['what', 'where is my order??', 'maybe tomorrow', 'yes but later please'])(
      'takes no action on %j',
      async (text) => {
        // Acting on an ambiguous message risks booking a courier the buyer
        // never asked for.
        const outcome = await service.handleInbound(message(text));

        expect(outcome).toBe('unrecognised');
        expect(deliveryFailures.requestReattemptByPhone).not.toHaveBeenCalled();
      },
    );
  });
});
