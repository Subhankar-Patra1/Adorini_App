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
