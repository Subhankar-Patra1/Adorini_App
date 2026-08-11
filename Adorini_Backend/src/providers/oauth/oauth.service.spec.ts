import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OAuthService, OAuthProviderError } from './oauth.service';

describe('OAuthService', () => {
  let service: OAuthService;
  const globalFetchBackup = global.fetch;

  beforeEach(async () => {
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              switch (key) {
                case 'GOOGLE_OAUTH_CLIENT_ID':
                  return 'web_client_123';
                case 'GOOGLE_OAUTH_MOBILE_CLIENT_IDS':
                  return ['android_client_456', 'ios_client_789'];
                default:
                  return '';
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  afterAll(() => {
    global.fetch = globalFetchBackup;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifyGoogleIdToken', () => {
    it('should successfully verify token for primary web client ID', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google_user_1',
          email: 'user@example.com',
          name: 'Jane Doe',
          aud: 'web_client_123',
          email_verified: 'true',
        }),
      });

      const user = await service.verifyGoogleIdToken('valid_token');
      expect(user).toEqual({
        googleId: 'google_user_1',
        email: 'user@example.com',
        name: 'Jane Doe',
        picture: undefined,
        emailVerified: true,
      });
    });

    it('should successfully verify token for an allowed mobile client ID', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google_user_2',
          email: 'mobile@example.com',
          aud: 'android_client_456',
        }),
      });

      const user = await service.verifyGoogleIdToken('valid_android_token');
      expect(user.googleId).toBe('google_user_2');
    });

    it('should throw OAuthProviderError if aud does not match any allowed client ID', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google_user_3',
          email: 'attacker@example.com',
          aud: 'unauthorized_client_999',
        }),
      });

      await expect(service.verifyGoogleIdToken('fake_token')).rejects.toThrow(
        OAuthProviderError,
      );
    });

    it('should throw OAuthProviderError when Google returns non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid Value',
      });

      await expect(service.verifyGoogleIdToken('bad_token')).rejects.toThrow(
        OAuthProviderError,
      );
    });
  });
});
