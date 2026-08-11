import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';

import { TokenService } from './token.service';
import { RefreshToken } from '../../../database/entities';

describe('TokenService', () => {
  let service: TokenService;
  let findOne: jest.Mock;
  let insert: jest.Mock;
  let save: jest.Mock;
  let update: jest.Mock;
  let del: jest.Mock;
  let signAsync: jest.Mock;

  const config: Record<string, string> = {
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '30d',
  };

  const hash = (raw: string): string => crypto.createHash('sha256').update(raw).digest('hex');

  function storedToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
    return {
      id: 'row-1',
      userId: 'user-1',
      tokenHash: 'unused',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      replacedByHash: null,
      userAgent: null,
      ipAddress: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: undefined as never,
      ...overrides,
    };
  }

  beforeEach(async () => {
    findOne = jest.fn();
    insert = jest.fn().mockResolvedValue(undefined);
    save = jest.fn().mockImplementation((row: unknown) => Promise.resolve(row));
    update = jest.fn().mockResolvedValue({ affected: 1 });
    del = jest.fn().mockResolvedValue({ affected: 3 });
    signAsync = jest.fn().mockResolvedValue('signed.access.token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: { findOne, insert, save, update, delete: del },
        },
        { provide: JwtService, useValue: { signAsync } },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => config[k]) } },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  describe('issueTokens', () => {
    it('returns an access token, refresh token and access lifetime', async () => {
      const result = await service.issueTokens('user-1');

      expect(result.accessToken).toBe('signed.access.token');
      expect(result.expiresIn).toBe(900);
      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('puts nothing but the user id in the access token', async () => {
      // A JWT is signed, not encrypted. Phone or email in here would be
      // readable by anything that logs an Authorization header.
      await service.issueTokens('user-1');

      const [payload] = signAsync.mock.calls[0] as [Record<string, unknown>];

      expect(payload).toEqual({ sub: 'user-1' });
    });

    it('stores only the hash of the refresh token', async () => {
      const { refreshToken } = await service.issueTokens('user-1');

      const [row] = insert.mock.calls[0] as [Partial<RefreshToken>];

      expect(row.tokenHash).toBe(hash(refreshToken));
      expect(row.tokenHash).not.toBe(refreshToken);
    });

    it('sets expiry from the configured refresh lifetime', async () => {
      const before = Date.now();
      await service.issueTokens('user-1');

      const [row] = insert.mock.calls[0] as [Partial<RefreshToken>];
      const expected = before + 30 * 86_400_000;

      expect(row.expiresAt!.getTime()).toBeGreaterThan(expected - 5_000);
      expect(row.expiresAt!.getTime()).toBeLessThan(expected + 5_000);
    });

    it('truncates over-long session context to the column widths', async () => {
      await service.issueTokens('user-1', {
        userAgent: 'x'.repeat(400),
        ipAddress: 'y'.repeat(80),
      });

      const [row] = insert.mock.calls[0] as [Partial<RefreshToken>];

      expect(row.userAgent).toHaveLength(255);
      expect(row.ipAddress).toHaveLength(45);
    });
  });

  describe('rotate', () => {
    it('issues a new pair and revokes the presented token', async () => {
      const stored = storedToken();
      findOne.mockResolvedValue(stored);

      const result = await service.rotate('old-raw-token');

      expect(result.refreshToken).not.toBe('old-raw-token');
      expect(stored.revokedAt).toBeInstanceOf(Date);
      expect(stored.replacedByHash).toBe(hash(result.refreshToken));
      expect(save).toHaveBeenCalledWith(stored);
    });

    it('looks the token up by hash, never by raw value', async () => {
      findOne.mockResolvedValue(storedToken());

      await service.rotate('old-raw-token');

      expect(findOne).toHaveBeenCalledWith({
        where: { tokenHash: hash('old-raw-token') },
      });
    });

    it('rejects an unknown token', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.rotate('nope')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      findOne.mockResolvedValue(storedToken({ expiresAt: new Date(Date.now() - 1_000) }));

      await expect(service.rotate('stale')).rejects.toThrow(/expired/i);
    });

    describe('reuse detection', () => {
      it('revokes every session when an already-rotated token is replayed', async () => {
        // A revoked token being presented means the raw value leaked. We cannot
        // tell the thief from the real user, so both are signed out — refusing
        // only this request would leave the thief's fresh token working.
        findOne.mockResolvedValue(storedToken({ revokedAt: new Date() }));

        await expect(service.rotate('leaked')).rejects.toThrow(/already been used/i);

        const [criteria, patch] = update.mock.calls[0] as [
          Record<string, unknown>,
          { revokedAt: Date },
        ];

        expect(criteria).toMatchObject({ userId: 'user-1' });
        expect(patch.revokedAt).toBeInstanceOf(Date);
      });

      it('does not hand out new tokens during a reuse response', async () => {
        findOne.mockResolvedValue(storedToken({ revokedAt: new Date() }));

        await service.rotate('leaked').catch(() => undefined);

        expect(insert).not.toHaveBeenCalled();
      });
    });
  });

  describe('revocation', () => {
    it('revokes a single token by hash', async () => {
      await service.revoke('raw-token');

      const [criteria] = update.mock.calls[0] as [Record<string, unknown>];
      expect(criteria).toMatchObject({ tokenHash: hash('raw-token') });
    });

    it('is silent for an unknown token', async () => {
      // Logout is idempotent, and reporting "no such token" would let an
      // unauthenticated caller probe which tokens are live.
      update.mockResolvedValue({ affected: 0 });

      await expect(service.revoke('never-existed')).resolves.toBeUndefined();
    });

    it('revokes every live token for a user', async () => {
      await service.revokeAllForUser('user-1');

      const [criteria] = update.mock.calls[0] as [Record<string, unknown>];
      expect(criteria).toMatchObject({ userId: 'user-1' });
    });
  });

  describe('purgeExpiredBefore', () => {
    it('reports how many rows it removed', async () => {
      await expect(service.purgeExpiredBefore(new Date())).resolves.toBe(3);
    });
  });
});
