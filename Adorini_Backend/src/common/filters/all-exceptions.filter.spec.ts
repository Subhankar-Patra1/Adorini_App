import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { OAuthProviderError } from '../../providers/oauth/oauth.service';
import { RedisProviderError } from '../../providers/redis/redis.service';
import { SmsProviderError } from '../../providers/sms/sms.service';

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
    it('maps an SMS outage to 503, not the caller’s fault', () => {
      const body = bodyFor(new SmsProviderError('MSG91 timed out'));

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.code).toBe('SMS_PROVIDER_UNAVAILABLE');
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
