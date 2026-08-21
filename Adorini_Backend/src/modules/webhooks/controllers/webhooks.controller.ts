import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';

import { Public } from '../../../common/decorators/public.decorator';
import { WebhooksService, type WebhookOutcome } from '../services/webhooks.service';
import type { Env } from '../../../config/env.validation';
import { PaymentsService } from '../../../providers/payments/payments.service';
import { cashfreeWebhookSchema, delhiveryWebhookSchema } from '../dto/webhook-payloads.dto';

const TOKEN_HEADER = 'x-adorini-webhook-token';

/**
 * Inbound provider callbacks.
 *
 * `@Public()` is what lets providers reach these routes at all — authentication
 * is global and fail-closed (ADR-013), and Cashfree and Delhivery obviously
 * cannot present an Adorini bearer token. These endpoints are emphatically
 * *not* unauthenticated, though: each authenticates the caller itself, per
 * provider, using the mechanism that provider actually supports — an HMAC
 * signature over the raw body for Cashfree, a shared secret header for
 * Delhivery, which does not sign its callbacks. (Meta's WhatsApp webhook lives
 * on its own controller — `whatsapp-bot.controller.ts` — since it is also
 * HMAC-signed but under a different scheme.)
 *
 * Excluded from Swagger deliberately: these are not part of the Flutter client's
 * contract, and publishing their shapes in a doc the app fetches would only
 * advertise the endpoints to everyone else.
 *
 * Throttling is skipped for the same reason it exists elsewhere — a burst of
 * genuine payment callbacks must never be dropped. These routes are gated by
 * signature or shared secret instead, which is stronger than a rate limit.
 *
 * Every authenticated request answers 2xx, including duplicates and events we
 * take no action on. A non-2xx tells the provider to redeliver, so returning an
 * error for "already handled" would guarantee an endless retry loop.
 */
@Public()
@ApiExcludeController()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('cashfree')
  @HttpCode(HttpStatus.OK)
  async cashfree(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-timestamp') timestamp: string | undefined,
  ): Promise<{ outcome: WebhookOutcome }> {
    const rawBody = request.rawBody?.toString('utf8');

    if (!rawBody) {
      throw new BadRequestException('Missing request body');
    }

    // Verified against the exact received bytes, before the payload is trusted
    // enough to parse — an unsigned caller gets no further than this line.
    if (!this.payments.verifyWebhookSignature(signature ?? '', timestamp ?? '', rawBody)) {
      this.logger.warn('Rejected Cashfree webhook with an invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = cashfreeWebhookSchema.parse(JSON.parse(rawBody));
    return { outcome: await this.webhooks.handleCashfree(payload) };
  }

  @Post('delhivery')
  @HttpCode(HttpStatus.OK)
  async delhivery(
    @Body() body: unknown,
    @Headers(TOKEN_HEADER) token: string | undefined,
  ): Promise<{ outcome: WebhookOutcome }> {
    this.assertSharedSecret(token, this.config.get('DELHIVERY_WEBHOOK_TOKEN', { infer: true }));

    const payload = delhiveryWebhookSchema.parse(body);
    return { outcome: await this.webhooks.handleDelhivery(payload) };
  }

  /**
   * Constant-time comparison. A plain `!==` leaks how much of the token was
   * correct through response timing, which is enough to recover a secret one
   * byte at a time given enough attempts — and these routes are unthrottled.
   */
  private assertSharedSecret(provided: string | undefined, expected: string): void {
    const providedBuffer = Buffer.from(provided ?? '', 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    const matches =
      providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer);

    if (!matches) {
      this.logger.warn('Rejected webhook with an invalid shared secret');
      throw new UnauthorizedException('Invalid webhook token');
    }
  }
}
