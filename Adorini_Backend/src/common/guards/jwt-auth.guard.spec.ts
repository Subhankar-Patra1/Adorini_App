import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from '../types/auth-user';
import type { Env } from '../../config/env.validation';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let verifyAsync: jest.Mock;
  let getAllAndOverride: jest.Mock;
  let request: AuthenticatedRequest;

  function contextWith(authorization?: string): ExecutionContext {
    request = { headers: authorization ? { authorization } : {} } as AuthenticatedRequest;

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    verifyAsync = jest.fn();
    getAllAndOverride = jest.fn().mockReturnValue(false);

    guard = new JwtAuthGuard(
      { verifyAsync } as unknown as JwtService,
      { getAllAndOverride } as unknown as Reflector,
      {
        get: jest.fn().mockReturnValue('a-test-secret-at-least-32-chars-long'),
      } as unknown as ConfigService<Env, true>,
    );
  });

  describe('@Public() routes', () => {
    it('lets a public route through without a token', async () => {
      getAllAndOverride.mockReturnValue(true);

      await expect(guard.canActivate(contextWith())).resolves.toBe(true);
      expect(verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('protected routes', () => {
    it('attaches the user id from a valid token', async () => {
      verifyAsync.mockResolvedValue({ sub: 'user-123' });

      await expect(guard.canActivate(contextWith('Bearer good.token'))).resolves.toBe(true);
      expect(request.user).toEqual({ id: 'user-123' });
    });

    it('accepts a lowercase bearer scheme', async () => {
      verifyAsync.mockResolvedValue({ sub: 'user-123' });

      await expect(guard.canActivate(contextWith('bearer good.token'))).resolves.toBe(true);
    });

    it('rejects a missing Authorization header', async () => {
      await expect(guard.canActivate(contextWith())).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      ['good.token', 'no scheme'],
      ['Basic dXNlcjpwYXNz', 'wrong scheme'],
      ['Bearer', 'scheme with no token'],
      ['Bearer a b', 'extra segments'],
    ])('rejects a malformed header (%s — %s)', async (header) => {
      await expect(guard.canActivate(contextWith(header))).rejects.toThrow(UnauthorizedException);
      expect(verifyAsync).not.toHaveBeenCalled();
    });

    it('rejects an expired or badly signed token', async () => {
      verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(guard.canActivate(contextWith('Bearer stale.token'))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not reveal why verification failed', async () => {
      // Distinguishing "expired" from "bad signature" tells an attacker which
      // part of a forged token to work on next.
      verifyAsync.mockRejectedValue(new Error('invalid signature'));

      const error = (await guard
        .canActivate(contextWith('Bearer forged.token'))
        .catch((e: unknown) => e)) as UnauthorizedException;

      expect(error.message).toBe('Invalid or expired access token');
      expect(error.message).not.toMatch(/signature/i);
    });

    it('rejects a token with no subject', async () => {
      // A registration token or any other opaque credential must never satisfy
      // the guard just because it happens to verify.
      verifyAsync.mockResolvedValue({ someOtherClaim: true });

      await expect(guard.canActivate(contextWith('Bearer no.sub'))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.user).toBeUndefined();
    });
  });
});
