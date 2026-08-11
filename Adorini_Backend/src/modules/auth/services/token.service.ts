import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { IsNull, LessThan, Repository } from 'typeorm';

import { RefreshToken } from '../../../database/entities';
import { durationToSeconds } from '../../../common/utils/duration.util';
import type { AccessTokenPayload } from '../../../common/types/auth-user';
import type { Env } from '../../../config/env.validation';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, so the client knows when to refresh. */
  expiresIn: number;
}

/** Where a refresh token was issued from, for a future "active sessions" screen. */
export interface SessionContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  private readonly secret: string;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_EXPIRES_IN', { infer: true });
    this.refreshTtl = config.get('JWT_REFRESH_EXPIRES_IN', { infer: true });
    this.secret = config.get('JWT_SECRET', { infer: true });
  }

  /** Mints a fresh access + refresh pair for a user. */
  async issueTokens(userId: string, context: SessionContext = {}): Promise<IssuedTokens> {
    const accessToken = await this.signAccessToken(userId);
    const refreshToken = await this.createRefreshToken(userId, context);

    return {
      accessToken,
      refreshToken,
      expiresIn: durationToSeconds(this.accessTtl),
    };
  }

  /**
   * Exchanges a refresh token for a new pair, rotating the old one out.
   *
   * Rotation means a refresh token is single-use. That turns a stolen token
   * into a detectable event: whoever refreshes second presents an
   * already-rotated value, and we find out a copy exists.
   */
  async rotate(rawToken: string, context: SessionContext = {}): Promise<IssuedTokens> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Reuse detected. A revoked token being presented means the raw value
      // leaked and is being replayed — we cannot tell whether the legitimate
      // user or the thief is in front of us, so we end every session for this
      // user and make them sign in again. Refusing only this one request would
      // leave the thief's freshly-rotated token working.
      this.logger.error(
        `Refresh token reuse detected for user ${stored.userId}; revoking all sessions`,
      );
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token has already been used');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const accessToken = await this.signAccessToken(stored.userId);
    const nextRefresh = await this.createRefreshToken(stored.userId, context);

    stored.revokedAt = new Date();
    stored.replacedByHash = hashToken(nextRefresh);
    await this.refreshTokens.save(stored);

    return {
      accessToken,
      refreshToken: nextRefresh,
      expiresIn: durationToSeconds(this.accessTtl),
    };
  }

  /**
   * Revokes a single token (logout).
   *
   * Silent when the token is unknown or already revoked: logout is idempotent,
   * and reporting "that token doesn't exist" would let an unauthenticated
   * caller probe which tokens are live.
   */
  async revoke(rawToken: string): Promise<void> {
    await this.refreshTokens.update(
      { tokenHash: hashToken(rawToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Revokes every live token for a user (logout-all, or a reuse response). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /**
   * Deletes refresh tokens that expired before `before`.
   *
   * Not scheduled here — the `jobs` module owns scheduling. Exposed now so the
   * table has a defined cleanup path rather than growing forever unnoticed.
   */
  async purgeExpiredBefore(before: Date): Promise<number> {
    const result = await this.refreshTokens.delete({ expiresAt: LessThan(before) });
    return result.affected ?? 0;
  }

  /**
   * Access tokens carry only `sub`.
   *
   * A JWT is signed, not encrypted — every claim is readable by anyone holding
   * the token. Phone and email are personal data with no business being in a
   * value that gets logged by proxies and stored by clients, and `isAdmin`
   * would freeze a privilege decision for the token's whole lifetime.
   */
  private async signAccessToken(userId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId };

    return this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: durationToSeconds(this.accessTtl),
    });
  }

  private async createRefreshToken(userId: string, context: SessionContext): Promise<string> {
    // 256 bits of entropy — a refresh token is a bearer credential with a
    // 30-day life and no structure to validate, so its only defence is being
    // unguessable.
    const rawToken = crypto.randomBytes(32).toString('base64url');

    await this.refreshTokens.insert({
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + durationToSeconds(this.refreshTtl) * 1000),
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ipAddress: context.ipAddress?.slice(0, 45) ?? null,
    });

    return rawToken;
  }
}

/** Only the hash is ever persisted, so a database dump yields nothing usable. */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
