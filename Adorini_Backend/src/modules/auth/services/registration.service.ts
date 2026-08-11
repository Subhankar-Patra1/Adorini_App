import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

import { redisKeys } from '../../../common/constants/auth.constants';
import { RedisService } from '../../../providers/redis/redis.service';
import type { GoogleUserPayload } from '../../../providers/oauth/oauth.service';
import type { Env } from '../../../config/env.validation';

/**
 * Holds a verified Google identity while the user completes phone verification.
 *
 * `users.phone` is NOT NULL, so Google alone cannot create an account — it can
 * only start one. This service parks the Google payload for a few minutes and
 * hands back a token the client presents at `/auth/otp/verify` to finish.
 *
 * The token is opaque and Redis-backed rather than a JWT, for two reasons:
 * a JWT is signed but readable, so Google's email and name would travel in the
 * clear through client storage and logs; and an opaque random string is
 * structurally incapable of being replayed as an access token, whereas a JWT
 * only avoids that if every verification path remembers to check a `typ` claim.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('REGISTRATION_TOKEN_TTL_SECONDS', { infer: true });
  }

  /** Parks a Google identity and returns the token that redeems it. */
  async issue(
    payload: GoogleUserPayload,
  ): Promise<{ registrationToken: string; expiresInSeconds: number }> {
    const registrationToken = crypto.randomBytes(32).toString('base64url');

    await this.redis.setex(
      redisKeys.googleRegistration(hashToken(registrationToken)),
      this.ttlSeconds,
      JSON.stringify(payload),
    );

    return { registrationToken, expiresInSeconds: this.ttlSeconds };
  }

  /**
   * Redeems a token, returning the parked identity — **once**.
   *
   * The key is deleted before the value is returned, so a replayed token cannot
   * attach the same Google account to a second phone number.
   */
  async consume(registrationToken: string): Promise<GoogleUserPayload | null> {
    const key = redisKeys.googleRegistration(hashToken(registrationToken));

    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }

    await this.redis.del(key);

    try {
      return JSON.parse(raw) as GoogleUserPayload;
    } catch {
      // Only reachable if something else wrote to our namespace.
      this.logger.error('Stored Google registration payload was not valid JSON');
      return null;
    }
  }
}

/**
 * Keys are stored by hash so that a Redis dump does not yield usable tokens —
 * the same reasoning as refresh tokens in Postgres.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
