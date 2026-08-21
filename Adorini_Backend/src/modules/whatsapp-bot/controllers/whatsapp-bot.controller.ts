import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';

import { Public } from '../../../common/decorators/public.decorator';
import type { Env } from '../../../config/env.validation';
import { pickInboundMessage, whatsappInboundSchema } from '../dto/whatsapp-inbound.dto';
import { WhatsappBotService, type InboundReplyOutcome } from '../services/whatsapp-bot.service';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

/**
 * Inbound WhatsApp traffic from Meta, delivered by the Cloud API webhook.
 *
 * `@Public()` because Meta has no Adorini session to present, `@SkipThrottle()`
 * because dropping a genuine buyer reply is worse than the burst it protects
 * against, and excluded from Swagger because it is not part of the Flutter
 * contract.
 *
 * Two endpoints, both required by Meta's webhook contract:
 *
 * - `GET`: the one-time verification handshake Meta performs when the webhook
 *   URL is registered or re-verified in the dashboard. Not part of ongoing
 *   message traffic.
 * - `POST`: the actual message/status delivery, authenticated by Meta's
 *   `X-Hub-Signature-256` — an HMAC-SHA256 over the raw request body, keyed by
 *   the app secret — verified the same way `PaymentsService` verifies
 *   Cashfree's signature: against the exact received bytes, before the
 *   payload is trusted enough to parse.
 *
 * Answers 2xx for every authenticated request — including delivery-status
 * receipts and replies we could not interpret — because a non-2xx tells Meta
 * to redeliver, and redelivering a message we already understood perfectly
 * well (or correctly ignored) will not make it more actionable.
 */
@Public()
@ApiExcludeController()
@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsappBotController {
  private readonly logger = new Logger(WhatsappBotController.name);
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(
    private readonly bot: WhatsappBotService,
    config: ConfigService<Env, true>,
  ) {
    this.verifyToken = config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN', { infer: true });
    this.appSecret = config.get('WHATSAPP_APP_SECRET', { infer: true });
  }

  /**
   * Meta's webhook verification handshake. Must echo `hub.challenge` back as
   * *plain text* — not JSON — when the mode and token match, or Meta treats
   * verification as failed.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    if (mode === 'subscribe' && this.tokenMatches(token)) {
      res.status(HttpStatus.OK).send(challenge ?? '');
      return;
    }

    this.logger.warn('Rejected a WhatsApp webhook verification handshake');
    res.status(HttpStatus.FORBIDDEN).send();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async inbound(
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ outcome: InboundReplyOutcome | 'ignored' }> {
    const rawBody = request.rawBody?.toString('utf8');
    const signature = request.headers[SIGNATURE_HEADER];

    if (
      !rawBody ||
      !this.verifySignature(typeof signature === 'string' ? signature : undefined, rawBody)
    ) {
      this.logger.warn('Rejected an inbound WhatsApp callback with an invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = whatsappInboundSchema.parse(JSON.parse(rawBody));
    const message = pickInboundMessage(payload);

    // Delivery-status receipts (sent/delivered/read/failed) arrive on this
    // same URL and vastly outnumber actual inbound messages — a normal,
    // expected shape, not an error, so this is a quiet 2xx no-op rather than
    // a 400.
    if (!message) {
      return { outcome: 'ignored' };
    }

    return { outcome: await this.bot.handleInbound(message) };
  }

  /** Constant-time, for the reason spelled out below. */
  private tokenMatches(provided: string | undefined): boolean {
    const providedBuffer = Buffer.from(provided ?? '', 'utf8');
    const expectedBuffer = Buffer.from(this.verifyToken, 'utf8');

    return (
      providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }

  /**
   * Verifies Meta's `X-Hub-Signature-256`: `'sha256=' + hex(HMAC-SHA256(app
   * secret, raw body))`.
   *
   * The comparison is `crypto.timingSafeEqual`, not `===`. String equality
   * short-circuits on the first differing byte, so response time leaks how
   * much of a guessed signature was correct — enough, over many attempts, to
   * forge one byte at a time. This endpoint feeds courier-reattempt booking,
   * so a forged signature is a route to bogus redelivery bookings.
   */
  private verifySignature(signature: string | undefined, rawBody: string): boolean {
    if (!signature?.startsWith(SIGNATURE_PREFIX)) {
      return false;
    }

    const provided = signature.slice(SIGNATURE_PREFIX.length);
    const expected = crypto.createHmac('sha256', this.appSecret).update(rawBody).digest('hex');

    const providedBuffer = Buffer.from(provided, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    // timingSafeEqual throws on length mismatch, which would itself leak
    // length via an exception path — check it first and bail uniformly.
    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
