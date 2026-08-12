import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';

import type { AuthUser, AuthenticatedRequest } from '../types/auth-user';

/**
 * Injects the authenticated caller into a controller method.
 *
 * Throws rather than returning `undefined` when no user is attached. That only
 * happens if the route is `@Public()` yet still asks for a user — a wiring
 * mistake. Returning `undefined` would let it slip through into a query as
 * `WHERE user_id = undefined`, which either errors far from the cause or, worse,
 * matches nothing and looks like empty data.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new InternalServerErrorException(
        'No authenticated user on the request — is this route marked @Public()?',
      );
    }

    return request.user;
  },
);

/**
 * The caller if they happen to be signed in, otherwise `undefined`.
 *
 * For `@Public()` routes that behave better with an identity but must still
 * work without one — a size enquiry from a known customer should be attributed
 * to them, while a first-time visitor must still be able to send one.
 *
 * Distinct from `@CurrentUser()` rather than a flag on it, so a handler that
 * genuinely requires a user cannot silently start accepting anonymous callers
 * because someone changed an argument.
 */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
