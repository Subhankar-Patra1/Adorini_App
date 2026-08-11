import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

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
  emailVerified?: boolean;
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
   * Verifies a Google OAuth ID Token via Google's tokeninfo endpoint.
   * Ensures token expiration and checks `aud` against the array of allowed client IDs.
   */
  async verifyGoogleIdToken(idToken: string): Promise<GoogleUserPayload> {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET' });
    } catch (err) {
      this.logger.error('Failed to reach Google tokeninfo endpoint', err);
      throw new OAuthProviderError('Failed to connect to Google OAuth service');
    }

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.error(`Google token verification failed [${response.status}]: ${errBody}`);
      throw new OAuthProviderError('Invalid Google ID token', response.status);
    }

    const payload = (await response.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
      email_verified?: string | boolean;
      aud?: string;
      exp?: string | number;
    };

    if (!payload.sub || !payload.email) {
      throw new OAuthProviderError('Google ID token payload is missing sub or email');
    }

    if (payload.aud && !this.allowedClientIds.includes(payload.aud)) {
      this.logger.error(`Google token aud [${payload.aud}] not in allowed client IDs`);
      throw new OAuthProviderError('Google ID token audience (aud) mismatch');
    }

    const emailVerified =
      payload.email_verified === true || payload.email_verified === 'true';

    return {
      email: payload.email,
      googleId: payload.sub,
      name: payload.name,
      picture: payload.picture,
      emailVerified,
    };
  }
}
