import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { OAuthProviderError } from '../../providers/oauth/oauth.service';
import { RedisProviderError } from '../../providers/redis/redis.service';
import { WhatsAppProviderError } from '../../providers/whatsapp/whatsapp.service';
import { StorageProviderError } from '../../providers/storage/storage.service';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'POST', url: '/api/auth/otp/request' }),
      }),
    } as unknown as ArgumentsHost;

    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  function bodyFor(exception: unknown): Record<string, unknown> {
    filter.catch(exception, host);
    const [payload] = json.mock.calls[0] as [Record<string, unknown>];
    return payload;
  }

  describe('provider errors get the right blame', () => {
    it('maps a WhatsApp outage to 503, not the caller’s fault', () => {
      const body = bodyFor(new WhatsAppProviderError('Meta timed out'));

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.code).toBe('WHATSAPP_PROVIDER_UNAVAILABLE');
    });

    it('maps a Google-rejected token to 401', () => {
      // statusCode present = Google answered and said no.
      const body = bodyFor(new OAuthProviderError('Invalid Google ID token', 400));

      expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(body.code).toBe('GOOGLE_TOKEN_INVALID');
    });

    it('maps an unreachable Google to 503', () => {
      // No statusCode = we never got an answer. Blaming the caller here would
      // tell a user their valid login is invalid during our outage.
      const body = bodyFor(new OAuthProviderError('Google OAuth service timed out'));

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.code).toBe('GOOGLE_UNAVAILABLE');
    });

    it('maps a Redis failure to 503', () => {
      const body = bodyFor(new RedisProviderError('Redis get failed', 'get'));

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.code).toBe('CACHE_UNAVAILABLE');
    });

    it('maps an R2 upload failure to 503, not 500', () => {
      // Found via manual verification: an unreachable R2 endpoint was
      // surfacing as a generic 500 because this filter had no branch for it,
      // unlike its SMS/OAuth/Redis siblings — indistinguishable from a real
      // bug in the response a client sees.
      const body = bodyFor(new StorageProviderError('Failed to upload file to R2: EPROTO'));

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.code).toBe('STORAGE_UNAVAILABLE');
    });
  });

  describe('hand-parsed schemas', () => {
    it('maps a raw ZodError to 400, not 500', () => {
      // The webhook controllers parse by hand — they must authenticate the
      // caller before trusting the body — so ZodValidationPipe never sees it.
      // A 500 here would tell the provider to redeliver a payload that can
      // never parse, forever.
      const error = z.object({ orderId: z.string() }).safeParse({}).error!;

      const body = bodyFor(error);

      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(body.code).toBe('VALIDATION_FAILED');
    });

    it('names the offending field', () => {
      const error = z.object({ orderId: z.string() }).safeParse({}).error!;

      expect(bodyFor(error).message).toContain('orderId');
    });
  });

  describe('database errors', () => {
    it('maps a unique violation to 409 without naming the constraint', () => {
      const error = new QueryFailedError('INSERT ...', [], new Error('duplicate key'));
      (error as QueryFailedError & { code?: string }).code = '23505';

      const body = bodyFor(error);

      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      // Echoing "uq_referral_referee_phone" would hand out our schema.
      expect(JSON.stringify(body)).not.toMatch(/uq_|constraint|duplicate key/i);
    });

    it('maps any other database error to a generic 500', () => {
      const error = new QueryFailedError('SELECT ...', [], new Error('syntax error'));
      (error as QueryFailedError & { code?: string }).code = '42601';

      const body = bodyFor(error);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.message).toBe('An unexpected error occurred.');
    });
  });

  describe('application exceptions pass through', () => {
    it.each([
      [new BadRequestException('bad'), HttpStatus.BAD_REQUEST, 'BAD_REQUEST'],
      [new NotFoundException('gone'), HttpStatus.NOT_FOUND, 'NOT_FOUND'],
      [new ConflictException('dupe'), HttpStatus.CONFLICT, 'CONFLICT'],
    ])('keeps the status we chose', (exception, expectedStatus, expectedCode) => {
      const body = bodyFor(exception);

      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(body.code).toBe(expectedCode);
    });

    it('keeps a machine-readable code supplied by the thrower', () => {
      // Services raise codes like ADDRESS_LOCKED and INSUFFICIENT_STOCK so the
      // client can branch on them. A generic "CONFLICT" cannot tell a screen
      // whether to offer a retry, a different size, or a countdown.
      const body = bodyFor(
        new ConflictException({ code: 'ADDRESS_LOCKED', message: 'Already dispatched' }),
      );

      expect(body.code).toBe('ADDRESS_LOCKED');
      expect(body.message).toBe('Already dispatched');
    });

    it('falls back to the status name when no code is given', () => {
      expect(bodyFor(new ConflictException('plain')).code).toBe('CONFLICT');
    });

    it('flattens an array of validation messages', () => {
      const body = bodyFor(
        new BadRequestException({ message: ['phone is invalid', 'otp is required'] }),
      );

      expect(body.message).toBe('phone is invalid; otp is required');
    });
  });

  describe('unknown errors leak nothing', () => {
    it('returns a fixed message and never the original text', () => {
      const body = bodyFor(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.message).toBe('An unexpected error occurred.');
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    });

    it('handles a thrown non-Error without crashing the filter', () => {
      const body = bodyFor('just a string');

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.code).toBe('INTERNAL_ERROR');
    });
  });

  it('always includes the path and a timestamp', () => {
    const body = bodyFor(new NotFoundException());

    expect(body.path).toBe('/api/auth/otp/request');
    expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
  });
});
