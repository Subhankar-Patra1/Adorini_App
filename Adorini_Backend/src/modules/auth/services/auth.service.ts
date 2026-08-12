import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { OtpService } from './otp.service';
import { RegistrationService } from './registration.service';
import { TokenService, type IssuedTokens, type SessionContext } from './token.service';
import { Referral, User, Wallet } from '../../../database/entities';
import { ReferralOutcome, isReferralApplied } from '../referral-status';
import { ReferralStatus } from '../../../common/enums/domain.enums';
import { maskPhone } from '../../../common/utils/phone.util';
import { OAuthService, type GoogleUserPayload } from '../../../providers/oauth/oauth.service';
import { SmsService } from '../../../providers/sms/sms.service';
import type { Env } from '../../../config/env.validation';

const PG_UNIQUE_VIOLATION = '23505';

export interface PublicUser {
  id: string;
  phone: string;
  email: string | null;
  fullName: string | null;
  gender: string | null;
  profilePhotoKey: string | null;
  isPhoneVerified: boolean;
  hasGoogleLinked: boolean;
}

export interface LoginResult extends IssuedTokens {
  isNewUser: boolean;
  /** Convenience flag; true only when `referralStatus` is `APPLIED`. */
  referralApplied: boolean;
  /** Why the referral was or was not recorded — see `ReferralOutcome`. */
  referralStatus: ReferralOutcome;
  user: PublicUser;
}

export type GoogleSignInResult =
  | ({ status: 'AUTHENTICATED' } & LoginResult)
  | { status: 'PHONE_REQUIRED'; registrationToken: string; expiresInSeconds: number };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly referralCreditPaise: number;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Referral) private readonly referrals: Repository<Referral>,
    private readonly dataSource: DataSource,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly registrations: RegistrationService,
    private readonly sms: SmsService,
    private readonly oauth: OAuthService,
    config: ConfigService<Env, true>,
  ) {
    this.referralCreditPaise = config.get('REFERRAL_CREDIT_PAISE', { infer: true });
  }

  /**
   * Sends a login code.
   *
   * The response is identical whether or not the phone belongs to an account.
   * Anything else — a different status, message, or latency — turns this into
   * an oracle for "is this number an Adorini customer?", which is exactly the
   * list a competitor or a spammer would want.
   */
  async requestOtp(
    phone: string,
  ): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
    const outcome = await this.otp.requestOtp(phone);

    if (!outcome.allowed) {
      throw new BadRequestException({
        code: outcome.reason === 'COOLDOWN' ? 'OTP_COOLDOWN' : 'OTP_RATE_LIMITED',
        message:
          outcome.reason === 'COOLDOWN'
            ? `Please wait ${outcome.retryAfterSeconds}s before requesting another code.`
            : 'Too many codes requested for this number. Please try again later.',
        retryAfterSeconds: outcome.retryAfterSeconds,
      });
    }

    await this.sms.sendOtp(phone, outcome.otp);

    return {
      expiresInSeconds: outcome.expiresInSeconds,
      resendAfterSeconds: outcome.resendAfterSeconds,
    };
  }

  /**
   * Verifies a code and logs the user in, creating the account if this is their
   * first time. This is the **only** path that creates a user.
   */
  async verifyOtp(params: {
    phone: string;
    otp: string;
    registrationToken?: string;
    referralCode?: string;
    context?: SessionContext;
  }): Promise<LoginResult> {
    const { phone, otp, registrationToken, referralCode, context = {} } = params;

    const result = await this.otp.verifyOtp(phone, otp);

    if (!result.valid) {
      throw new UnauthorizedException({
        code: `OTP_${result.reason}`,
        message:
          result.reason === 'TOO_MANY_ATTEMPTS'
            ? 'Too many incorrect attempts. Please request a new code.'
            : 'That code is incorrect or has expired.',
      });
    }

    // Only redeem the Google payload once the OTP is proven — otherwise anyone
    // holding a registration token could burn it by guessing at codes.
    const googleIdentity = registrationToken
      ? await this.consumeRegistration(registrationToken)
      : null;

    const existing = await this.users.findOne({ where: { phone } });

    if (existing) {
      if (googleIdentity) {
        await this.linkGoogleToUser(existing, googleIdentity);
      }

      const issued = await this.tokens.issueTokens(existing.id, context);
      return {
        ...issued,
        isNewUser: false,
        // A code sent on a sign-in is not wrong, it is simply too late — say so
        // rather than reporting it as an invalid code.
        ...this.referralResult(
          referralCode ? ReferralOutcome.EXISTING_USER : ReferralOutcome.NOT_PROVIDED,
        ),
        user: toPublicUser(existing),
      };
    }

    const { user, wasCreated } = await this.createUser(phone, googleIdentity);

    // Referral capture runs only for genuinely new accounts, and only after the
    // account exists — see captureReferral for why it is outside the signup
    // transaction.
    const outcome = await this.resolveReferralOutcome(user, wasCreated, referralCode);

    const issued = await this.tokens.issueTokens(user.id, context);
    return {
      ...issued,
      isNewUser: wasCreated,
      ...this.referralResult(outcome),
      user: toPublicUser(user),
    };
  }

  /** Keeps the boolean and the reason from ever disagreeing. */
  private referralResult(outcome: ReferralOutcome): {
    referralApplied: boolean;
    referralStatus: ReferralOutcome;
  } {
    return { referralApplied: isReferralApplied(outcome), referralStatus: outcome };
  }

  private async resolveReferralOutcome(
    user: User,
    wasCreated: boolean,
    referralCode?: string,
  ): Promise<ReferralOutcome> {
    if (!referralCode) {
      return ReferralOutcome.NOT_PROVIDED;
    }

    // A concurrent signup resolved to an existing account (the 23505 recovery
    // path), so this is a sign-in after all.
    if (!wasCreated) {
      return ReferralOutcome.EXISTING_USER;
    }

    return this.captureReferral(user, referralCode);
  }

  /**
   * Google sign-in.
   *
   * Google never yields a phone number, and `users.phone` is NOT NULL, so this
   * can log an existing user in but cannot finish a registration on its own.
   * When there is no account it returns a registration token instead of an
   * error — needing a phone is the next step of a flow, not a failure.
   */
  async signInWithGoogle(
    idToken: string,
    context: SessionContext = {},
  ): Promise<GoogleSignInResult> {
    const payload = await this.oauth.verifyGoogleIdToken(idToken);

    const byGoogleId = await this.users.findOne({ where: { googleId: payload.googleId } });
    if (byGoogleId) {
      return this.authenticated(byGoogleId, context);
    }

    // Matching on email links a buyer who signed up by phone and later uses
    // Google. Only a Google-verified email is trusted here: an unverified one
    // is an unproven claim, and honouring it would let anyone who can set their
    // Google profile email take over the matching Adorini account.
    if (payload.emailVerified) {
      const byEmail = await this.users.findOne({ where: { email: payload.email } });

      if (byEmail) {
        await this.linkGoogleToUser(byEmail, payload);
        return this.authenticated(byEmail, context);
      }
    }

    const { registrationToken, expiresInSeconds } = await this.registrations.issue(payload);
    return { status: 'PHONE_REQUIRED', registrationToken, expiresInSeconds };
  }

  /** Attaches a Google account to the signed-in user. */
  async linkGoogle(userId: string, idToken: string): Promise<PublicUser> {
    const payload = await this.oauth.verifyGoogleIdToken(idToken);
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    await this.linkGoogleToUser(user, payload);
    return toPublicUser(user);
  }

  async refresh(rawToken: string, context: SessionContext = {}): Promise<IssuedTokens> {
    return this.tokens.rotate(rawToken, context);
  }

  async logout(rawToken: string): Promise<void> {
    await this.tokens.revoke(rawToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }

  // ---- internals ----

  private async authenticated(user: User, context: SessionContext): Promise<GoogleSignInResult> {
    const issued = await this.tokens.issueTokens(user.id, context);

    return {
      status: 'AUTHENTICATED',
      ...issued,
      isNewUser: false,
      // Google sign-in never carries a code: a new Google user is routed
      // through PHONE_REQUIRED and finishes at /auth/otp/verify, which is where
      // a referral would be supplied.
      ...this.referralResult(ReferralOutcome.NOT_PROVIDED),
      user: toPublicUser(user),
    };
  }

  private async consumeRegistration(token: string): Promise<GoogleUserPayload> {
    const payload = await this.registrations.consume(token);

    if (!payload) {
      throw new BadRequestException({
        code: 'REGISTRATION_TOKEN_INVALID',
        message: 'That registration session has expired. Please sign in with Google again.',
      });
    }

    return payload;
  }

  /**
   * Creates a `User` and its `Wallet` in one transaction.
   *
   * `wallets.user_id` is unique and every user must have exactly one, so a user
   * without a wallet is a broken account that would fail at checkout. Both rows
   * land or neither does.
   *
   * Two concurrent verifications for the same phone are possible — a buyer
   * double-tapping "verify" is enough — and the second collides on the
   * `users.phone` unique index. That is the constraint doing its job, so it is
   * caught and turned into a login rather than a 500.
   */
  private async createUser(
    phone: string,
    google: GoogleUserPayload | null,
  ): Promise<{ user: User; wasCreated: boolean }> {
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const created = manager.create(User, {
          phone,
          isPhoneVerified: true,
          googleId: google?.googleId ?? null,
          email: google?.emailVerified ? google.email : null,
          fullName: google?.name ?? null,
          profilePhotoKey: null,
        });

        const saved = await manager.save(User, created);
        await manager.insert(Wallet, { userId: saved.id, balancePaise: 0 });

        return saved;
      });

      return { user, wasCreated: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.users.findOne({ where: { phone } });
      if (existing) {
        return { user: existing, wasCreated: false };
      }

      // The collision was on something other than the phone — most likely the
      // Google email or googleId was claimed between our check and this write.
      // Retry without the Google details; the phone is the identity that
      // matters and the account must not be blocked by decoration.
      this.logger.warn(
        `Signup for ${maskPhone(phone)} collided on a Google field; creating without it`,
      );

      const user = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(
          User,
          manager.create(User, { phone, isPhoneVerified: true }),
        );
        await manager.insert(Wallet, { userId: saved.id, balancePaise: 0 });
        return saved;
      });

      return { user, wasCreated: true };
    }
  }

  /**
   * Records a pending referral for a brand-new account.
   *
   * Deliberately runs **after** the signup transaction has committed, in its
   * own try/catch. In PostgreSQL a single failed statement aborts the entire
   * surrounding transaction, so a duplicate-referral insert inside the signup
   * transaction would take the account with it. A referral is a bonus; it must
   * never be able to prevent someone from registering.
   *
   * Nothing is credited here. The ₹100 is only awarded once the referee's order
   * reaches `DELIVERED`, which the wallet module handles.
   */
  private async captureReferral(referee: User, referralCode: string): Promise<ReferralOutcome> {
    /**
     * Nothing in here may throw.
     *
     * By the time this runs the account exists and is committed. Any error
     * escaping this method would return 5xx for a signup that actually
     * succeeded — the buyer sees "signup failed", retries, and is told the
     * number is already registered. Every failure mode therefore degrades to
     * `referralApplied: false`, which the client already handles.
     *
     * The whole body is wrapped, not just the insert: the referrer lookup is a
     * database call too, and a connection blip there is no more entitled to
     * fail a completed signup than a duplicate-key is.
     */
    try {
      const referrer = await this.users.findOne({
        where: { referralCode: referralCode.trim().toUpperCase() },
      });

      if (!referrer) {
        // A mistyped code must not fail the signup — the account is already
        // created and the buyer is mid-flow. Telling them the code was not
        // found is what lets them fix it rather than guess.
        return ReferralOutcome.CODE_NOT_FOUND;
      }

      if (referrer.id === referee.id) {
        return ReferralOutcome.SELF_REFERRAL;
      }

      await this.referrals.insert({
        referrerId: referrer.id,
        refereeId: referee.id,
        refereePhone: referee.phone,
        status: ReferralStatus.PENDING,
        creditPaise: this.referralCreditPaise,
      });

      return ReferralOutcome.APPLIED;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // `uq_referral_referee_phone` is global and outlives deleted accounts
        // (ADR-008), so this phone has been referred before. That is the
        // anti-abuse rule working, not an error — logged at info, not error.
        this.logger.log(`Referral skipped for ${maskPhone(referee.phone)}: already referred`);
        return ReferralOutcome.ALREADY_REFERRED;
      }

      // Anything else is a genuine fault worth investigating, but still not
      // worth failing the signup over. Loud in the logs, and reported as our
      // problem rather than as a bad code.
      this.logger.error(
        `Referral capture failed for ${maskPhone(referee.phone)}; signup unaffected`,
        error instanceof Error ? error.stack : String(error),
      );
      return ReferralOutcome.UNAVAILABLE;
    }
  }

  private async linkGoogleToUser(user: User, payload: GoogleUserPayload): Promise<void> {
    if (user.googleId && user.googleId !== payload.googleId) {
      throw new ConflictException({
        code: 'GOOGLE_ALREADY_LINKED',
        message: 'This account is already linked to a different Google account.',
      });
    }

    if (user.googleId === payload.googleId) {
      return;
    }

    const claimedByOther = await this.users.findOne({
      where: { googleId: payload.googleId },
    });

    if (claimedByOther && claimedByOther.id !== user.id) {
      throw new ConflictException({
        code: 'GOOGLE_ACCOUNT_IN_USE',
        message: 'That Google account is already linked to another Adorini account.',
      });
    }

    user.googleId = payload.googleId;
    user.fullName ??= payload.name ?? null;

    // Only fill an empty email, and only a verified one. Overwriting an email
    // the buyer set themselves would silently move where their order updates go.
    if (!user.email && payload.emailVerified) {
      user.email = payload.email;
    }

    try {
      await this.users.save(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'GOOGLE_ACCOUNT_IN_USE',
          message: 'That Google account or email is already in use.',
        });
      }
      throw error;
    }
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    fullName: user.fullName,
    gender: user.gender,
    profilePhotoKey: user.profilePhotoKey,
    isPhoneVerified: user.isPhoneVerified,
    hasGoogleLinked: Boolean(user.googleId),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
