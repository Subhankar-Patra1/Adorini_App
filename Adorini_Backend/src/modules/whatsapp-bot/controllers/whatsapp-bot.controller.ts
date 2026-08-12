import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import * as crypto from 'crypto';

import { Public } from '../../../common/decorators/public.decorator';
import type { Env } from '../../../config/env.validation';
import { pickInboundMessage, whatsappInboundSchema } from '../dto/whatsapp-inbound.dto';
import { WhatsappBotService, type InboundReplyOutcome } from '../services/whatsapp-bot.service';

const TOKEN_HEADER = 'x-adorini-webhook-token';

/**
 * Inbound WhatsApp messages from buyers, delivered by MSG91.
 *
 * Follows the same conventions as the provider webhooks in `webhooks/`, for the
 * same reasons: `@Public()` because MSG91 has no Adorini session to present,
 * `@SkipThrottle()` because dropping a genuine buyer reply is worse than the
 * burst it protects against, excluded from Swagger because it is not part of the
 * Flutter contract, and authenticated by the shared secret we registered with
 * MSG91 rather than left open (ADR-029).
 *
 * Answers 2xx for every authenticated request — including replies we could not
 * interpret — because a non-2xx tells MSG91 to redeliver, and redelivering a
 * message we already understood perfectly well will not make it more
 * actionable (ADR-030).
 */
@Public()
@ApiExcludeController()
@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsappBotController {
  private readonly logger = new Logger(WhatsappBotController.name);
  private readonly expectedToken: string;

  constructor(
    private readonly bot: WhatsappBotService,
    config: ConfigService<Env, true>,
  ) {
    // Shares MSG91's existing webhook secret: it is the same provider and the
    // same trust boundary, so a second secret would be two things to rotate
    // for no additional protection.
    this.expectedToken = config.get('MSG91_WEBHOOK_TOKEN', { infer: true });
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async inbound(
    @Body() body: unknown,
    @Headers(TOKEN_HEADER) token: string | undefined,
  ): Promise<{ outcome: InboundReplyOutcome }> {
    this.assertSharedSecret(token);

    const payload = whatsappInboundSchema.parse(body);
    const message = pickInboundMessage(payload);

    if (!message) {
      // Missing a sender or a body — permanently unusable, so 400 rather than
      // a 2xx that hides it or a 5xx that invites redelivery.
      throw new BadRequestException(
        'Inbound WhatsApp payload is missing a message id, sender, or body',
      );
    }

    return { outcome: await this.bot.handleInbound(message) };
  }

  /** Constant-time, for the reason spelled out in the provider webhook controller. */
  private assertSharedSecret(provided: string | undefined): void {
    const providedBuffer = Buffer.from(provided ?? '', 'utf8');
    const expectedBuffer = Buffer.from(this.expectedToken, 'utf8');

    const matches =
      providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer);

    if (!matches) {
      this.logger.warn('Rejected an inbound WhatsApp callback with an invalid shared secret');
      throw new UnauthorizedException('Invalid webhook token');
    }
  }
}
