import type { Response } from 'supertest';

/**
 * Typed access to a supertest response body.
 *
 * Supertest types `response.body` as `any`, which spreads through every
 * assertion and trips the project's "no `any`" rules. Funnelling it through one
 * explicit cast keeps the specs type-checked, and forces each test to state the
 * shape it expects — which is itself a check on the API contract.
 */
export function body<T>(response: Response): T {
  return response.body as T;
}

/** The login payload returned by `/auth/otp/verify` and Google sign-in. */
export interface LoginBody {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  isNewUser: boolean;
  referralApplied: boolean;
  user: PublicUserBody;
}

export interface PublicUserBody {
  id: string;
  phone: string;
  email: string | null;
  fullName: string | null;
  gender: string | null;
  profilePhotoKey: string | null;
  isPhoneVerified: boolean;
  hasGoogleLinked: boolean;
}

export interface GoogleSignInBody {
  status: 'AUTHENTICATED' | 'PHONE_REQUIRED';
  registrationToken?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface AddressBody {
  id: string;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  path: string;
}

export interface ReferralCodeBody {
  referralCode: string;
}
