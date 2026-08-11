import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';
import { UpstreamTimeoutError, fetchWithTimeout } from '../../common/http/fetch-with-timeout';

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const OAUTH_TIMEOUT_MS = 7_000;

/** The only issuers Google mints ID tokens under. */
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Google rejected the token, was unreachable, or returned an unusable body. */
export class OAuthProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'OAuthProviderError';
  }
}

export interface GoogleUserPayload {
  email: string;
  googleId: string;
  name?: string;
  picture?: string;
  emailVerified: boolean;
}

interface GoogleTokenInfo {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: string | boolean;
  aud?: string;
  iss?: string;
  exp?: string | number;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly allowedClientIds: string[];

  constructor(config: ConfigService<Env, true>) {
    const webClientId = config.get('GOOGLE_OAUTH_CLIENT_ID', { infer: true });
    const mobileClientIds = config.get('GOOGLE_OAUTH_MOBILE_CLIENT_IDS', { infer: true }) ?? [];

    this.allowedClientIds = [webClientId, ...mobileClientIds].filter(Boolean);
  }

  /**
   * Verifies a Google ID token and returns the identity it asserts.
   *
   * Google's tokeninfo endpoint validates the signature and expiry for us, but
   * it does **not** decide whether the token was minted for *this* application.
   * That is `aud`, and checking it is what stops the classic confused-deputy
   * attack: an attacker gets a perfectly valid Google token issued to their own
   * app, presents it here, and — without an audience check — logs in as the
   * Google account it belongs to.
   *
   * So `aud`, `iss` and `exp` are all asserted explicitly below, and a token
   * missing any of them is rejected. An earlier version guarded the audience
   * check with `if (payload.aud && ...)`, which meant a token with no `aud`
   * claim skipped the check entirely and was accepted.
   */
  async verifyGoogleIdToken(idToken: string): Promise<GoogleUserPayload> {
    if (!idToken) {
      throw new OAuthProviderError('No Google ID token supplied');
    }

    if (this.allowedClientIds.length === 0) {
      // Fail closed. With no configured audience every token would have to be
      // either rejected or blindly trusted; silently trusting is not an option.
      throw new OAuthProviderError(
        'No Google OAuth client IDs are configured — cannot verify token audience',
      );
    }

    const url = `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, { method: 'GET' }, OAUTH_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof UpstreamTimeoutError) {
        this.logger.error(`Google tokeninfo timed out after ${error.timeoutMs}ms`);
        throw new OAuthProviderError('Google OAuth service timed out');
      }
      this.logger.error('Failed to reach Google tokeninfo endpoint', error);
      throw new OAuthProviderError('Failed to connect to Google OAuth service');
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '<unreadable body>');
      this.logger.error(`Google token verification failed [${response.status}]: ${errBody}`);
      throw new OAuthProviderError('Invalid Google ID token', response.status);
    }

    let payload: GoogleTokenInfo;
    try {
      payload = (await response.json()) as GoogleTokenInfo;
    } catch {
      throw new OAuthProviderError('Google returned a non-JSON token payload');
    }

    if (!payload.sub || !payload.email) {
      throw new OAuthProviderError('Google ID token payload is missing sub or email');
    }

    if (!payload.iss || !GOOGLE_ISSUERS.includes(payload.iss)) {
      this.logger.error(`Google token has unexpected issuer: ${payload.iss ?? '<missing>'}`);
      throw new OAuthProviderError('Google ID token issuer (iss) is not Google');
    }

    if (!payload.aud || !this.allowedClientIds.includes(payload.aud)) {
      this.logger.error(
        `Google token aud [${payload.aud ?? '<missing>'}] is not an allowed client ID`,
      );
      throw new OAuthProviderError('Google ID token audience (aud) mismatch');
    }

    // Defence in depth: tokeninfo already refuses expired tokens, but this
    // provider must not depend on a remote service's diligence for a check it
    // can make itself. `exp` is unix seconds and arrives as a string.
    if (!this.isUnexpired(payload.exp)) {
      throw new OAuthProviderError('Google ID token has expired');
    }

    return {
      email: payload.email,
      googleId: payload.sub,
      name: payload.name,
      picture: payload.picture,
      // tokeninfo returns this as the string "true"/"false", not a boolean.
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    };
  }

  private isUnexpired(exp: string | number | undefined): boolean {
    if (exp === undefined) {
      return false;
    }

    const expSeconds = typeof exp === 'number' ? exp : Number.parseInt(exp, 10);
    if (!Number.isFinite(expSeconds)) {
      return false;
    }

    return expSeconds * 1000 > Date.now();
  }
}
