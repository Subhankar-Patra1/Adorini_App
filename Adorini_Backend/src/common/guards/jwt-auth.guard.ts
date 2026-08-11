import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { IS_PUBLIC_KEY } from '../constants/auth.constants';
import type { AccessTokenPayload, AuthenticatedRequest } from '../types/auth-user';
import type { Env } from '../../config/env.validation';

/**
 * Authenticates every request from a Bearer access token.
 *
 * Registered globally via `APP_GUARD`, so routes are protected by default and
 * `@Public()` marks the exceptions (see `public.decorator.ts` for why that
 * direction was chosen).
 *
 * Implemented directly on `JwtService` rather than through Passport: Passport
 * would add three dependencies and a strategy indirection to do exactly this —
 * read a header, verify a signature, attach a user.
 *
 * No database read happens here. The token carries only `sub`, and trusting it
 * for the 15 minutes it is valid is the deliberate trade documented in the
 * token service.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_SECRET', { infer: true }),
      });
    } catch {
      // Deliberately opaque: distinguishing "expired" from "bad signature" from
      // "malformed" tells an attacker which part of a forged token to fix.
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Access token is missing a subject');
    }

    request.user = { id: payload.sub };
    return true;
  }
}

/**
 * Pulls the credential out of an `Authorization` header, requiring the `Bearer`
 * scheme. A raw token with no scheme is rejected rather than tolerated — being
 * lenient here means the API accepts a shape it never documented, which then
 * has to be supported forever.
 */
function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, value, ...rest] = header.split(' ');

  if (rest.length > 0 || scheme?.toLowerCase() !== 'bearer' || !value) {
    return null;
  }

  return value;
}
