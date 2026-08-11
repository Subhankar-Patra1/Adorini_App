import type { Request } from 'express';

/**
 * The authenticated caller, as reconstructed from the access token.
 *
 * Only the user id. The access token deliberately carries nothing else (see
 * `TokenService`), so anything richer — phone, email, admin status — must be
 * loaded from the database by whoever needs it, and is therefore always current
 * rather than as-of-token-issue.
 */
export interface AuthUser {
  id: string;
}

/** An Express request after `JwtAuthGuard` has run. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/** Claims carried by an Adorini access token. */
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  iat?: number;
  exp?: number;
}
