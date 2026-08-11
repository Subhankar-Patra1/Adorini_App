import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import { IS_PUBLIC_KEY } from '../constants/auth.constants';

/**
 * Opts an endpoint out of the globally-registered `JwtAuthGuard`.
 *
 * Authentication is fail-closed: the guard is registered via `APP_GUARD`, so
 * every route is protected unless it carries this decorator. Forgetting
 * `@Public()` produces a loud 401 during development; the inverse arrangement —
 * opting in per controller — fails silently by exposing data, which is the
 * failure you never notice.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
