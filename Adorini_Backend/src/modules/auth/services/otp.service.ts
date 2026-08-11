import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

import { redisKeys } from '../../../common/constants/auth.constants';
import { maskPhone } from '../../../common/utils/phone.util';
import { RedisService } from '../../../providers/redis/redis.service';
import type { Env } from '../../../config/env.validation';

/** Why an OTP request was refused. */
export type OtpRequestOutcome =
  | { allowed: true; otp: string; expiresInSeconds: number; resendAfterSeconds: number }
  | { allowed: false; reason: 'COOLDOWN' | 'HOURLY_LIMIT'; retryAfterSeconds: number };

/** Why a verification failed. `EXPIRED` also covers "no code was ever requested". */
export type OtpVerifyOutcome =
  { valid: true } | { valid: false; reason: 'EXPIRED' | 'MISMATCH' | 'TOO_MANY_ATTEMPTS' };

/**
 * Issues and verifies phone OTPs.
 *
 * We generate the code ourselves and use MSG91 purely for delivery. That keeps
 * expiry, attempt limits and lockout under our control, and means verification
 * is a local Redis read rather than a 7-second round trip to MSG91 on the
 * login critical path.
 *
 * The stored value is an HMAC keyed with `JWT_SECRET`, not a bare hash. A
 * 6-digit code has only a million possibilities, so a plain SHA-256 of it is
 * reversible by anyone who can read Redis. The HMAC key means a Redis dump
 * alone is not enough. The real brute-force defence, though, is the attempt
 * counter below — no hash choice makes a million-space secret safe on its own.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;
  private readonly maxRequestsPerHour: number;
  private readonly hmacKey: string;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('OTP_TTL_SECONDS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
    this.resendCooldownSeconds = config.get('OTP_RESEND_COOLDOWN_SECONDS', {
      infer: true,
    });
    this.maxRequestsPerHour = config.get('OTP_MAX_REQUESTS_PER_HOUR', { infer: true });
    this.hmacKey = config.get('JWT_SECRET', { infer: true });
  }

  /**
   * Reserves an OTP send for a phone and returns the code to deliver.
   *
   * Both limits exist for money, not just security: every SMS is a real charge,
   * so an unthrottled endpoint is a way to spend our balance as much as it is a
   * way to harass someone's phone.
   */
  async requestOtp(phone: string): Promise<OtpRequestOutcome> {
    const cooldownKey = redisKeys.otpResendCooldown(phone);

    if ((await this.redis.exists(cooldownKey)) > 0) {
      return {
        allowed: false,
        reason: 'COOLDOWN',
        retryAfterSeconds: await this.ttlOf(cooldownKey, this.resendCooldownSeconds),
      };
    }

    const hourlyCount = await this.incrementWithExpiry(redisKeys.otpHourlyCount(phone), 3600);

    if (hourlyCount > this.maxRequestsPerHour) {
      this.logger.warn(`OTP hourly cap reached for ${maskPhone(phone)}`);
      return {
        allowed: false,
        reason: 'HOURLY_LIMIT',
        retryAfterSeconds: await this.ttlOf(redisKeys.otpHourlyCount(phone), 3600),
      };
    }

    const otp = generateNumericOtp();

    // Storing the code resets the attempt counter — a freshly sent code must
    // not inherit the failed attempts of the one it replaced, or a user who
    // mistyped five times could never recover by requesting a new code.
    await this.redis.setex(redisKeys.otpCode(phone), this.ttlSeconds, this.hash(otp));
    await this.redis.del(redisKeys.otpAttempts(phone));
    await this.redis.setex(cooldownKey, this.resendCooldownSeconds, '1');

    return {
      allowed: true,
      otp,
      expiresInSeconds: this.ttlSeconds,
      resendAfterSeconds: this.resendCooldownSeconds,
    };
  }

  /**
   * Checks a submitted code. On success every key for the phone is cleared, so
   * a code cannot be redeemed twice.
   */
  async verifyOtp(phone: string, submitted: string): Promise<OtpVerifyOutcome> {
    const stored = await this.redis.get(redisKeys.otpCode(phone));

    if (!stored) {
      return { valid: false, reason: 'EXPIRED' };
    }

    const attempts = await this.incrementWithExpiry(redisKeys.otpAttempts(phone), this.ttlSeconds);

    if (attempts > this.maxAttempts) {
      // Destroy the code rather than merely refusing this attempt. The attacker
      // now needs a fresh SMS to keep guessing, which the hourly cap limits —
      // that pairing is what makes a 6-digit secret defensible.
      await this.clear(phone);
      this.logger.warn(`OTP attempt cap reached for ${maskPhone(phone)}; code destroyed`);
      return { valid: false, reason: 'TOO_MANY_ATTEMPTS' };
    }

    if (!timingSafeEquals(this.hash(submitted), stored)) {
      return { valid: false, reason: 'MISMATCH' };
    }

    await this.clear(phone);
    return { valid: true };
  }

  /** Removes every OTP key for a phone. */
  async clear(phone: string): Promise<void> {
    await this.redis.del(redisKeys.otpCode(phone), redisKeys.otpAttempts(phone));
  }

  private hash(otp: string): string {
    return crypto.createHmac('sha256', this.hmacKey).update(otp).digest('hex');
  }

  /**
   * `INCR` then `EXPIRE` in one round trip.
   *
   * `RedisService` exposes no counter primitives, so this drops to the raw
   * client. `EXPIRE` is re-issued on every increment, which makes the hourly
   * window sliding rather than fixed — stricter than a fixed window, and it
   * removes the failure mode where an `INCR` succeeds but the `EXPIRE` is lost
   * and the key never expires at all.
   */
  private async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const results = await this.redis.getClient().multi().incr(key).expire(key, ttlSeconds).exec();

    const incrResult = results?.[0];
    const value = incrResult?.[1];

    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  private async ttlOf(key: string, fallbackSeconds: number): Promise<number> {
    const ttl = await this.redis.getClient().ttl(key);
    return ttl > 0 ? ttl : fallbackSeconds;
  }
}

/**
 * A uniformly-distributed 6-digit code.
 *
 * `crypto.randomInt` rather than `Math.random`: the latter is a seeded PRNG
 * whose output can be predicted from earlier values, which for a login secret
 * is the whole ballgame.
 */
function generateNumericOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Constant-time comparison of two hex digests of equal length. */
function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
