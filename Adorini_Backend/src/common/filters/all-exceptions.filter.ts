import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ZodError } from 'zod';

import { OAuthProviderError } from '../../providers/oauth/oauth.service';
import { RedisProviderError } from '../../providers/redis/redis.service';
import { SmsProviderError } from '../../providers/sms/sms.service';
import { StorageProviderError } from '../../providers/storage/storage.service';

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  timestamp: string;
  path: string;
}

/**
 * Translates every thrown error into a consistent HTTP response.
 *
 * The point is attribution. Without this, a Phase 3 provider error becomes a
 * generic 500 and the client — and our own dashboards — cannot tell "MSG91 is
 * down" (our problem, retry later) from "you sent a bad token" (the caller's
 * problem, do not retry). Both look identical, so both get handled wrongly.
 *
 * Internal details never reach the client: unrecognised errors are logged in
 * full and answered with a fixed message, so a stack trace or a SQL fragment
 * can't leak through an unhandled edge case.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, message, logAsError } = this.classify(exception);

    if (logAsError) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} (${code})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
    logAsError: boolean;
  } {
    // Anything the application threw deliberately — including Zod validation
    // rejections surfaced by ZodValidationPipe — already carries the right status.
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const payload =
        typeof response === 'string'
          ? { message: response }
          : (response as { message?: string | string[]; code?: string });

      const message = payload.message ?? exception.message;

      return {
        status: exception.getStatus(),
        /**
         * A `code` the thrower supplied wins over the generic status name.
         *
         * Services raise things like `ADDRESS_LOCKED`, `INSUFFICIENT_STOCK` and
         * `OTP_COOLDOWN` precisely so the client can branch on them — a generic
         * `CONFLICT` tells a Flutter screen nothing about whether to offer a
         * retry, a different size, or a countdown. Overwriting it here silently
         * discarded every one of those codes before they reached anyone.
         */
        code: payload.code ?? httpExceptionCode(exception.getStatus()),
        message: Array.isArray(message) ? message.join('; ') : message,
        // 5xx we raised ourselves is still worth a stack trace; 4xx is routine.
        logAsError: exception.getStatus() >= 500,
      };
    }

    /**
     * A schema parsed by hand rather than through a DTO — the webhook
     * controllers do this, because they must authenticate the caller before
     * trusting the body enough to validate it.
     *
     * `ZodValidationPipe` only covers `@Body()` DTOs, so without this branch a
     * malformed payload escapes as a 500. That matters most for webhooks: a
     * non-2xx tells the provider to redeliver, so a 500 would make Delhivery
     * retry a payload that can never parse, indefinitely. A 400 says "this is
     * permanently bad, stop sending it".
     */
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: exception.issues
          .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
          .join('; '),
        logAsError: false,
      };
    }

    if (exception instanceof SmsProviderError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'SMS_PROVIDER_UNAVAILABLE',
        message: 'Unable to send SMS right now. Please try again shortly.',
        logAsError: true,
      };
    }

    if (exception instanceof OAuthProviderError) {
      // A statusCode means Google answered and rejected the token — the
      // caller's problem. Its absence means we never got a usable answer
      // (timeout, DNS, connection refused), which is ours.
      const googleRejected = exception.statusCode !== undefined;

      return googleRejected
        ? {
            status: HttpStatus.UNAUTHORIZED,
            code: 'GOOGLE_TOKEN_INVALID',
            message: 'Google sign-in failed. Please try again.',
            logAsError: false,
          }
        : {
            status: HttpStatus.SERVICE_UNAVAILABLE,
            code: 'GOOGLE_UNAVAILABLE',
            message: 'Google sign-in is unavailable right now. Please try again shortly.',
            logAsError: true,
          };
    }

    if (exception instanceof RedisProviderError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'CACHE_UNAVAILABLE',
        message: 'A temporary storage error occurred. Please try again shortly.',
        logAsError: true,
      };
    }

    if (exception instanceof StorageProviderError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'STORAGE_UNAVAILABLE',
        message: 'Unable to upload the file right now. Please try again shortly.',
        logAsError: true,
      };
    }

    if (exception instanceof QueryFailedError) {
      const driverCode = (exception as QueryFailedError & { code?: string }).code;

      if (driverCode === PG_UNIQUE_VIOLATION) {
        return {
          status: HttpStatus.CONFLICT,
          code: 'ALREADY_EXISTS',
          // Never echo the constraint name — it names our tables and columns.
          message: 'That value is already in use.',
          logAsError: false,
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      logAsError: true,
    };
  }
}

/**
 * Stable machine-readable codes for the statuses we raise deliberately.
 *
 * A lookup rather than a switch because `getStatus()` returns a plain `number`,
 * and matching it against `HttpStatus` members is an unsafe enum comparison.
 */
const HTTP_STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

function httpExceptionCode(status: number): string {
  return HTTP_STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}
