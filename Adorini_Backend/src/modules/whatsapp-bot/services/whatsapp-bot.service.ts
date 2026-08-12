import { Injectable, Logger } from '@nestjs/common';

import { WebhookProvider } from '../../../common/enums/domain.enums';
import { normalisePhone } from '../../../common/utils/phone.util';
import { DeliveryFailureService } from '../../orders/services/delivery-failure.service';
import { WebhookIdempotencyService } from '../../webhooks/services/webhook-idempotency.service';
import type { InboundMessage } from '../dto/whatsapp-inbound.dto';

/**
 * Replies a buyer can send to the failed-delivery prompt that mean "yes".
 *
 * Kept deliberately generous, and matched on the whole trimmed message rather
 * than a substring: someone answering a "do you still want it?" question types
 * whatever feels natural, and rejecting `"Yes please"` because it is not
 * exactly `"yes"` would waste the one interaction we get. `1` is included
 * because the outbound template offers a numbered choice, and `haan`/`ha`
 * because the buyer base is Indian and may answer in transliterated Hindi.
 */
const AFFIRMATIVE_REPLIES = new Set([
  '1',
  'y',
  'yes',
  'yes please',
  'yeah',
  'ya',
  'yep',
  'ok',
  'okay',
  'sure',
  'retry',
  'reattempt',
  'redeliver',
  'try again',
  'yes try again',
  'haan',
  'ha',
  'haan ji',
]);

/** Replies that clearly mean "no" — acknowledged, but no action is needed. */
const NEGATIVE_REPLIES = new Set(['2', 'n', 'no', 'nope', 'cancel', 'nahi', 'na', 'no thanks']);

export type InboundReplyOutcome =
  | 'reattempt_requested'
  | 'declined'
  | 'no_matching_order'
  | 'window_expired'
  | 'attempts_exhausted'
  | 'unrecognised'
  | 'duplicate';

/**
 * Handles inbound WhatsApp messages from buyers.
 *
 * Scope is deliberately narrow: this is not a general-purpose conversational
 * bot. Its one job is letting a buyer answer the failed-delivery prompt without
 * opening the app — because the buyer we are trying to reach is, by definition,
 * someone who just had a delivery go wrong, and asking them to log in to fix it
 * adds friction exactly where we can least afford it (ADR-035).
 */
@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  constructor(
    private readonly deliveryFailures: DeliveryFailureService,
    private readonly idempotency: WebhookIdempotencyService,
  ) {}

  async handleInbound(message: InboundMessage): Promise<InboundReplyOutcome> {
    /**
     * De-duplicated through the same machinery as every provider webhook
     * (@GUARD Risk #1's mechanism): MSG91 redelivers inbound messages on
     * non-2xx, and a replayed "yes" must not book a second courier reattempt.
     */
    const ingest = await this.idempotency.ingest(
      {
        provider: WebhookProvider.MSG91,
        eventId: `inbound:${message.messageId}`,
        eventType: 'WHATSAPP_INBOUND',
        payload: { from: message.fromPhone, text: message.text },
      },
      async () => Promise.resolve({ relatedEntityId: null, result: 'accepted' as const }),
    );

    if (ingest.status === 'duplicate') {
      return 'duplicate';
    }

    return this.interpret(message);
  }

  private async interpret(message: InboundMessage): Promise<InboundReplyOutcome> {
    const normalised = message.text.trim().toLowerCase().replace(/[.!]+$/, '');

    if (NEGATIVE_REPLIES.has(normalised)) {
      /**
       * No action taken on a "no". The response-window sweep cancels the order
       * anyway, and letting it do so keeps one code path responsible for
       * cancellation rather than two that could disagree. The buyer gets the
       * outcome they asked for either way; they simply get it at the deadline
       * rather than instantly.
       */
      this.logger.log(`Buyer declined redelivery; leaving the sweep to close the order`);
      return 'declined';
    }

    if (!AFFIRMATIVE_REPLIES.has(normalised)) {
      // Not a yes and not a no. Logged rather than guessed at — acting on an
      // ambiguous message would risk booking a courier the buyer never asked for.
      this.logger.log(`Unrecognised WhatsApp reply, taking no action: "${message.text}"`);
      return 'unrecognised';
    }

    // Normalised to the exact form `users.phone` holds; MSG91 may report the
    // sender with a `+` or other punctuation.
    const phone = normalisePhone(message.fromPhone);

    if (!phone) {
      this.logger.warn('Inbound WhatsApp reply carried an unparseable sender number');
      return 'no_matching_order';
    }

    const outcome = await this.deliveryFailures.requestReattemptByPhone(phone);

    if (outcome.requested) {
      this.logger.log(
        `Redelivery booked for ${outcome.orderNumber} from a WhatsApp reply (attempt ${outcome.attemptsUsed})`,
      );
      return 'reattempt_requested';
    }

    switch (outcome.reason) {
      case 'WINDOW_EXPIRED':
        return 'window_expired';
      case 'ATTEMPTS_EXHAUSTED':
        return 'attempts_exhausted';
      default:
        return 'no_matching_order';
    }
  }
}
