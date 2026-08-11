import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { RegistrationService } from './registration.service';
import { RedisService } from '../../../providers/redis/redis.service';
import type { GoogleUserPayload } from '../../../providers/oauth/oauth.service';

describe('RegistrationService', () => {
  let service: RegistrationService;
  let get: jest.Mock;
  let setex: jest.Mock;
  let del: jest.Mock;

  const google: GoogleUserPayload = {
    googleId: 'google-sub-123',
    email: 'buyer@example.com',
    name: 'Test Buyer',
    picture: 'https://example.com/p.jpg',
    emailVerified: true,
  };

  beforeEach(async () => {
    get = jest.fn().mockResolvedValue(null);
    setex = jest.fn().mockResolvedValue(undefined);
    del = jest.fn().mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: RedisService, useValue: { get, setex, del } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(600) },
        },
      ],
    }).compile();

    service = module.get(RegistrationService);
  });

  describe('issue', () => {
    it('returns an opaque token and reports its lifetime', async () => {
      const { registrationToken, expiresInSeconds } = await service.issue(google);

      expect(expiresInSeconds).toBe(600);
      expect(registrationToken.length).toBeGreaterThan(32);
      // base64url — no padding, no characters needing URL escaping.
      expect(registrationToken).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('is not a JWT', async () => {
      // Deliberate: a JWT is signed but readable, so Google's email and name
      // would travel in the clear — and a JWT could be replayed as a bearer
      // token if any verifier forgot to check its type.
      const { registrationToken } = await service.issue(google);

      expect(registrationToken.split('.')).toHaveLength(1);
    });

    it('issues a distinct token each time', async () => {
      const first = await service.issue(google);
      const second = await service.issue(google);

      expect(first.registrationToken).not.toBe(second.registrationToken);
    });

    it('keys storage by hash, not by the token itself', async () => {
      // So a Redis dump does not hand out usable registration tokens.
      const { registrationToken } = await service.issue(google);

      const [key, ttl, value] = setex.mock.calls[0] as [string, number, string];

      expect(key).toMatch(/^reg:google:[0-9a-f]{64}$/);
      expect(key).not.toContain(registrationToken);
      expect(ttl).toBe(600);
      expect(JSON.parse(value)).toEqual(google);
    });
  });

  describe('consume', () => {
    it('returns the parked identity', async () => {
      get.mockResolvedValue(JSON.stringify(google));

      await expect(service.consume('some-token')).resolves.toEqual(google);
    });

    it('deletes the key so a token cannot be redeemed twice', async () => {
      // Otherwise one Google identity could be attached to several phone
      // numbers by replaying the same token.
      get.mockResolvedValue(JSON.stringify(google));

      await service.consume('some-token');

      expect(del).toHaveBeenCalledTimes(1);
      const [deletedKey] = del.mock.calls[0] as [string];
      const [readKey] = get.mock.calls[0] as [string];
      expect(deletedKey).toBe(readKey);
    });

    it('returns null for an unknown or expired token', async () => {
      get.mockResolvedValue(null);

      await expect(service.consume('gone')).resolves.toBeNull();
      expect(del).not.toHaveBeenCalled();
    });

    it('returns null rather than throwing on a corrupt payload', async () => {
      get.mockResolvedValue('not json at all');

      await expect(service.consume('some-token')).resolves.toBeNull();
    });
  });

  it('round-trips an issued token', async () => {
    const { registrationToken } = await service.issue(google);
    const [, , stored] = setex.mock.calls[0] as [string, number, string];
    get.mockResolvedValue(stored);

    await expect(service.consume(registrationToken)).resolves.toEqual(google);

    // The consume lookup must hash to the same key the issue wrote.
    const [writtenKey] = setex.mock.calls[0] as [string];
    const [readKey] = get.mock.calls[0] as [string];
    expect(readKey).toBe(writtenKey);
  });
});
