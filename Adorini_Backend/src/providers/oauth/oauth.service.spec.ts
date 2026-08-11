import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { OAuthService, OAuthProviderError } from './oauth.service';

describe('OAuthService', () => {
  let service: OAuthService;
  const globalFetchBackup = global.fetch;

  const WEB_CLIENT_ID = 'web-client-id.apps.googleusercontent.com';
  const ANDROID_CLIENT_ID = 'android-client-id.apps.googleusercontent.com';

  /** An hour from now, in unix seconds, as Google returns it: a string. */
  const futureExp = String(Math.floor(Date.now() / 1000) + 3600);

  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      sub: '1234567890',
      email: 'buyer@example.com',
      name: 'Test Buyer',
      picture: 'https://example.com/pic.jpg',
      email_verified: 'true',
      aud: WEB_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: futureExp,
      ...overrides,
    };
  }

  function mockTokenInfo(payload: unknown, ok = true, status = 200): void {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok,
      status,
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)),
    });
  }

  async function buildService(clientIds: { web: string; mobile: string[] }): Promise<OAuthService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'GOOGLE_OAUTH_CLIENT_ID' ? clientIds.web : clientIds.mobile,
            ),
          },
        },
      ],
    }).compile();

    return module.get<OAuthService>(OAuthService);
  }

  beforeEach(async () => {
    global.fetch = jest.fn();
    service = await buildService({
      web: WEB_CLIENT_ID,
      mobile: [ANDROID_CLIENT_ID],
    });
  });

  afterAll(() => {
    global.fetch = globalFetchBackup;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('happy paths', () => {
    it('verifies a token issued to the web client', async () => {
      mockTokenInfo(validPayload());

      await expect(service.verifyGoogleIdToken('token')).resolves.toEqual({
        email: 'buyer@example.com',
        googleId: '1234567890',
        name: 'Test Buyer',
        picture: 'https://example.com/pic.jpg',
        emailVerified: true,
      });
    });

    it('verifies a token issued to an allowed mobile client', async () => {
      // The Flutter app authenticates against platform-specific client IDs, so
      // rejecting them would break login on every phone.
      mockTokenInfo(validPayload({ aud: ANDROID_CLIENT_ID }));

      await expect(service.verifyGoogleIdToken('token')).resolves.toMatchObject({
        googleId: '1234567890',
      });
    });

    it('accepts the bare accounts.google.com issuer form', async () => {
      mockTokenInfo(validPayload({ iss: 'accounts.google.com' }));

      await expect(service.verifyGoogleIdToken('token')).resolves.toMatchObject({
        email: 'buyer@example.com',
      });
    });

    it('reports an unverified email as false rather than dropping the field', async () => {
      mockTokenInfo(validPayload({ email_verified: 'false' }));

      await expect(service.verifyGoogleIdToken('token')).resolves.toMatchObject({
        emailVerified: false,
      });
    });
  });

  describe('audience enforcement', () => {
    it('rejects a token minted for another application', async () => {
      // The confused-deputy attack: a valid Google token for the attacker's own
      // app, replayed here to log in as its owner.
      mockTokenInfo(validPayload({ aud: 'attacker-app.apps.googleusercontent.com' }));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(
        /audience \(aud\) mismatch/,
      );
    });

    it('rejects a token with NO aud claim at all', async () => {
      // Regression guard. A previous version guarded this check with
      // `if (payload.aud && ...)`, so a token carrying no audience skipped
      // validation entirely and was accepted.
      mockTokenInfo(validPayload({ aud: undefined }));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(OAuthProviderError);
    });

    it('fails closed when no client IDs are configured', async () => {
      const unconfigured = await buildService({ web: '', mobile: [] });

      await expect(unconfigured.verifyGoogleIdToken('token')).rejects.toThrow(
        /cannot verify token audience/,
      );
      // It must not even ask Google — there is no audience to check against.
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('issuer and expiry enforcement', () => {
    it('rejects a token from a non-Google issuer', async () => {
      mockTokenInfo(validPayload({ iss: 'https://evil.example.com' }));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(
        /issuer \(iss\) is not Google/,
      );
    });

    it('rejects a token with no iss claim', async () => {
      mockTokenInfo(validPayload({ iss: undefined }));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(OAuthProviderError);
    });

    it('rejects an expired token even if Google returned 200', async () => {
      // Defence in depth — this provider must not rely on tokeninfo's diligence
      // for a check it can make itself.
      mockTokenInfo(validPayload({ exp: String(Math.floor(Date.now() / 1000) - 60) }));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(/expired/);
    });

    it('rejects a token with no exp claim', async () => {
      mockTokenInfo(validPayload({ exp: undefined }));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(/expired/);
    });
  });

  describe('upstream failures', () => {
    it('rejects when Google returns a non-ok status', async () => {
      mockTokenInfo({ error: 'Invalid Value' }, false, 400);

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(/Invalid Google ID token/);
    });

    it('rejects an empty token without calling Google', async () => {
      await expect(service.verifyGoogleIdToken('')).rejects.toThrow(OAuthProviderError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports a timeout distinctly from an invalid token', async () => {
      const timeoutError = new Error('aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      (global.fetch as jest.Mock).mockRejectedValueOnce(timeoutError);

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(/timed out/i);
    });

    it('reports a transport failure as a connection error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ENOTFOUND'));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(/Failed to connect/);
    });

    it('rejects a payload missing sub or email', async () => {
      mockTokenInfo(validPayload({ sub: undefined }));

      await expect(service.verifyGoogleIdToken('token')).rejects.toThrow(/missing sub or email/);
    });
  });
});
