import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';

import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { RegistrationService } from './registration.service';
import { TokenService } from './token.service';
import { Referral, User, Wallet } from '../../../database/entities';
import { ReferralOutcome } from '../referral-status';
import { ReferralStatus } from '../../../common/enums/domain.enums';
import { OAuthService, type GoogleUserPayload } from '../../../providers/oauth/oauth.service';
import { WhatsAppService } from '../../../providers/whatsapp/whatsapp.service';

function uniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  (error as QueryFailedError & { code?: string }).code = '23505';
  return error;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    phone: '919876543210',
    email: null,
    fullName: null,
    gender: null,
    profilePhotoKey: null,
    googleId: null,
    isPhoneVerified: true,
    isAdmin: false,
    referralCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

describe('AuthService', () => {
  let service: AuthService;

  let usersFindOne: jest.Mock;
  let usersSave: jest.Mock;
  let referralsInsert: jest.Mock;
  let transaction: jest.Mock;
  let managerSave: jest.Mock;
  let managerInsert: jest.Mock;

  let otpRequest: jest.Mock;
  let otpVerify: jest.Mock;
  let issueTokens: jest.Mock;
  let regIssue: jest.Mock;
  let regConsume: jest.Mock;
  let sendOtp: jest.Mock;
  let verifyGoogleIdToken: jest.Mock;

  const google: GoogleUserPayload = {
    googleId: 'google-sub-123',
    email: 'buyer@example.com',
    name: 'Test Buyer',
    emailVerified: true,
  };

  beforeEach(async () => {
    usersFindOne = jest.fn().mockResolvedValue(null);
    usersSave = jest.fn().mockImplementation((u: User) => Promise.resolve(u));
    referralsInsert = jest.fn().mockResolvedValue(undefined);

    managerSave = jest.fn().mockImplementation((_entity, row: User) => Promise.resolve(row));
    managerInsert = jest.fn().mockResolvedValue(undefined);
    transaction = jest.fn().mockImplementation(async (cb: (m: unknown) => Promise<unknown>) =>
      cb({
        create: (_entity: unknown, data: Partial<User>) => ({ id: 'new-user', ...data }),
        save: managerSave,
        insert: managerInsert,
      }),
    );

    otpRequest = jest.fn().mockResolvedValue({
      allowed: true,
      otp: '123456',
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    });
    otpVerify = jest.fn().mockResolvedValue({ valid: true });
    issueTokens = jest.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
    });
    regIssue = jest
      .fn()
      .mockResolvedValue({ registrationToken: 'reg-token', expiresInSeconds: 600 });
    regConsume = jest.fn().mockResolvedValue(null);
    sendOtp = jest.fn().mockResolvedValue(undefined);
    verifyGoogleIdToken = jest.fn().mockResolvedValue(google);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: { findOne: usersFindOne, save: usersSave } },
        { provide: getRepositoryToken(Referral), useValue: { insert: referralsInsert } },
        { provide: DataSource, useValue: { transaction } },
        { provide: OtpService, useValue: { requestOtp: otpRequest, verifyOtp: otpVerify } },
        { provide: TokenService, useValue: { issueTokens } },
        { provide: RegistrationService, useValue: { issue: regIssue, consume: regConsume } },
        { provide: WhatsAppService, useValue: { sendOtp } },
        { provide: OAuthService, useValue: { verifyGoogleIdToken } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(10000) } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('requestOtp', () => {
    it('sends the generated code and reports the timings', async () => {
      await expect(service.requestOtp('919876543210')).resolves.toEqual({
        expiresInSeconds: 300,
        resendAfterSeconds: 60,
      });

      expect(sendOtp).toHaveBeenCalledWith('919876543210', '123456');
    });

    it('answers identically for known and unknown numbers', async () => {
      // Any difference here turns the endpoint into a "is this number a
      // customer?" oracle.
      usersFindOne.mockResolvedValue(makeUser());
      const known = await service.requestOtp('919876543210');

      usersFindOne.mockResolvedValue(null);
      const unknown = await service.requestOtp('919876543211');

      expect(known).toEqual(unknown);
      // It must not even look the user up.
      expect(usersFindOne).not.toHaveBeenCalled();
    });

    it('rejects while cooling down', async () => {
      otpRequest.mockResolvedValue({
        allowed: false,
        reason: 'COOLDOWN',
        retryAfterSeconds: 30,
      });

      await expect(service.requestOtp('919876543210')).rejects.toThrow(BadRequestException);
      expect(sendOtp).not.toHaveBeenCalled();
    });

    it('rejects past the hourly cap', async () => {
      otpRequest.mockResolvedValue({
        allowed: false,
        reason: 'HOURLY_LIMIT',
        retryAfterSeconds: 900,
      });

      await expect(service.requestOtp('919876543210')).rejects.toThrow(BadRequestException);
      expect(sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('rejects a bad code', async () => {
      otpVerify.mockResolvedValue({ valid: false, reason: 'MISMATCH' });

      await expect(service.verifyOtp({ phone: '919876543210', otp: '000000' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('logs in an existing user without creating anything', async () => {
      usersFindOne.mockResolvedValue(makeUser());

      const result = await service.verifyOtp({ phone: '919876543210', otp: '123456' });

      expect(result.isNewUser).toBe(false);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('creates the user and their wallet in one transaction', async () => {
      // wallets.user_id is unique and every user must have exactly one — a user
      // without a wallet is an account that breaks at checkout.
      const result = await service.verifyOtp({ phone: '919876543210', otp: '123456' });

      expect(result.isNewUser).toBe(true);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(managerInsert).toHaveBeenCalledWith(
        Wallet,
        expect.objectContaining({ balancePaise: 0 }),
      );
    });

    it('recovers from a concurrent signup on the same phone', async () => {
      // Two verifications racing — a double-tapped button is enough. The second
      // hits users.phone unique; that is the constraint working, so it becomes
      // a login rather than a 500.
      const existing = makeUser();
      transaction.mockRejectedValueOnce(uniqueViolation());
      usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

      const result = await service.verifyOtp({ phone: '919876543210', otp: '123456' });

      expect(result.isNewUser).toBe(false);
      expect(result.user.id).toBe(existing.id);
    });

    describe('registration token', () => {
      it('is only redeemed after the OTP is proven', async () => {
        // Otherwise anyone holding a registration token could burn it by
        // guessing at codes.
        otpVerify.mockResolvedValue({ valid: false, reason: 'MISMATCH' });

        await service
          .verifyOtp({ phone: '919876543210', otp: '000000', registrationToken: 'reg' })
          .catch(() => undefined);

        expect(regConsume).not.toHaveBeenCalled();
      });

      it('creates the account with the Google identity attached', async () => {
        regConsume.mockResolvedValue(google);

        await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          registrationToken: 'reg',
        });

        const [, created] = managerSave.mock.calls[0] as [unknown, Partial<User>];
        expect(created.googleId).toBe('google-sub-123');
        expect(created.email).toBe('buyer@example.com');
      });

      it('rejects an expired registration token', async () => {
        regConsume.mockResolvedValue(null);

        await expect(
          service.verifyOtp({
            phone: '919876543210',
            otp: '123456',
            registrationToken: 'stale',
          }),
        ).rejects.toThrow(/registration session has expired/i);
      });
    });

    describe('referral capture', () => {
      /**
       * Every outcome is distinguishable, because the right advice differs.
       * "Already referred" means stop retyping; "code not found" means check
       * the spelling. One shared failure message sends a buyer holding a valid
       * code into a retry loop and then to support.
       */
      it('records a PENDING referral for a new user', async () => {
        const referrer = makeUser({ id: 'referrer-1', referralCode: 'ABCD2345' });
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(referrer);

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'abcd2345',
        });

        expect(result.referralStatus).toBe(ReferralOutcome.APPLIED);
        expect(result.referralApplied).toBe(true);
        expect(referralsInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            referrerId: 'referrer-1',
            status: ReferralStatus.PENDING,
            creditPaise: 10000,
          }),
        );
      });

      it('reports NOT_PROVIDED when no code was entered', async () => {
        const result = await service.verifyOtp({ phone: '919876543210', otp: '123456' });

        expect(result.referralStatus).toBe(ReferralOutcome.NOT_PROVIDED);
        expect(result.referralApplied).toBe(false);
      });

      it('reports CODE_NOT_FOUND for a typo', async () => {
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'WR0NGC0D',
        });

        expect(result.referralStatus).toBe(ReferralOutcome.CODE_NOT_FOUND);
      });

      it('reports SELF_REFERRAL when the code belongs to the signer-up', async () => {
        const self = makeUser({ id: 'new-user', referralCode: 'ABCD2345' });
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(self);

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.referralStatus).toBe(ReferralOutcome.SELF_REFERRAL);
        expect(referralsInsert).not.toHaveBeenCalled();
      });

      it('reports ALREADY_REFERRED when the phone was referred before', async () => {
        // Survives account deletion by design (ADR-008), so this is a normal
        // outcome years later — the message must not say "invalid code".
        const referrer = makeUser({ id: 'referrer-1', referralCode: 'ABCD2345' });
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(referrer);
        referralsInsert.mockRejectedValue(uniqueViolation());

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.referralStatus).toBe(ReferralOutcome.ALREADY_REFERRED);
      });

      it('reports EXISTING_USER when a code arrives on a sign-in', async () => {
        // Not a wrong code — just too late. Referrals attach at account creation.
        usersFindOne.mockResolvedValue(makeUser());

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.referralStatus).toBe(ReferralOutcome.EXISTING_USER);
        expect(result.isNewUser).toBe(false);
      });

      it('reports UNAVAILABLE when recording it fails unexpectedly', async () => {
        // Our fault, not the buyer's — and the signup still succeeded.
        const referrer = makeUser({ id: 'referrer-1', referralCode: 'ABCD2345' });
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(referrer);
        referralsInsert.mockRejectedValue(new Error('connection terminated unexpectedly'));

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.referralStatus).toBe(ReferralOutcome.UNAVAILABLE);
        expect(result.isNewUser).toBe(true);
        expect(result.accessToken).toBeTruthy();
      });

      it('never lets the flag and the reason disagree', async () => {
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'NOPE',
        });

        expect(result.referralApplied).toBe(result.referralStatus === ReferralOutcome.APPLIED);
      });

      it('normalises the code to uppercase before lookup', async () => {
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

        await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: '  abcd2345 ',
        });

        expect(usersFindOne).toHaveBeenLastCalledWith({
          where: { referralCode: 'ABCD2345' },
        });
      });

      it('still signs the user up when the code is unknown', async () => {
        // A mistyped code must not fail a signup — the account already exists
        // by this point and the buyer is mid-flow.
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'NOPE',
        });

        expect(result.isNewUser).toBe(true);
        expect(result.referralStatus).toBe(ReferralOutcome.CODE_NOT_FOUND);
        expect(referralsInsert).not.toHaveBeenCalled();
      });

      it('still signs the user up when the phone was already referred', async () => {
        // uq_referral_referee_phone is global and outlives deleted accounts
        // (ADR-008). Hitting it is the anti-abuse rule working, not an error.
        const referrer = makeUser({ id: 'referrer-1', referralCode: 'ABCD2345' });
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(referrer);
        referralsInsert.mockRejectedValue(uniqueViolation());

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.isNewUser).toBe(true);
        expect(result.referralApplied).toBe(false);
      });

      it('survives an unexpected database error during capture', async () => {
        // The account is already committed by this point. An error escaping
        // referral capture would return 5xx for a signup that actually
        // succeeded — the buyer sees "signup failed", retries, and is told the
        // number is already registered.
        const referrer = makeUser({ id: 'referrer-1', referralCode: 'ABCD2345' });
        usersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(referrer);
        referralsInsert.mockRejectedValue(new Error('connection terminated unexpectedly'));

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.isNewUser).toBe(true);
        expect(result.referralApplied).toBe(false);
        expect(result.accessToken).toBeTruthy();
      });

      it('survives the referrer lookup itself failing', async () => {
        // The lookup is a database call too — a connection blip there is no
        // more entitled to fail a completed signup than a duplicate key is.
        usersFindOne
          .mockResolvedValueOnce(null)
          .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.isNewUser).toBe(true);
        expect(result.referralApplied).toBe(false);
      });

      it('is skipped entirely for an existing user', async () => {
        usersFindOne.mockResolvedValue(makeUser());

        const result = await service.verifyOtp({
          phone: '919876543210',
          otp: '123456',
          referralCode: 'ABCD2345',
        });

        expect(result.referralApplied).toBe(false);
        expect(referralsInsert).not.toHaveBeenCalled();
      });
    });
  });

  describe('signInWithGoogle', () => {
    it('logs in when the googleId is already known', async () => {
      usersFindOne.mockResolvedValue(makeUser({ googleId: 'google-sub-123' }));

      const result = await service.signInWithGoogle('id-token');

      expect(result.status).toBe('AUTHENTICATED');
    });

    it('links by verified email and logs in', async () => {
      usersFindOne
        .mockResolvedValueOnce(null) // by googleId
        .mockResolvedValueOnce(makeUser({ email: 'buyer@example.com' })) // by email
        .mockResolvedValueOnce(null); // googleId not claimed elsewhere

      const result = await service.signInWithGoogle('id-token');

      expect(result.status).toBe('AUTHENTICATED');
      expect(usersSave).toHaveBeenCalled();
    });

    it('will not match on an unverified email', async () => {
      // An unverified email is an unproven claim — honouring it would let
      // anyone who can set their Google profile email seize the matching account.
      verifyGoogleIdToken.mockResolvedValue({ ...google, emailVerified: false });
      usersFindOne.mockResolvedValue(null);

      const result = await service.signInWithGoogle('id-token');

      expect(result.status).toBe('PHONE_REQUIRED');
      // Only the googleId lookup should have happened.
      expect(usersFindOne).toHaveBeenCalledTimes(1);
    });

    it('asks for a phone when no account exists', async () => {
      // users.phone is NOT NULL, so Google alone cannot finish a registration.
      usersFindOne.mockResolvedValue(null);

      const result = await service.signInWithGoogle('id-token');

      expect(result).toEqual({
        status: 'PHONE_REQUIRED',
        registrationToken: 'reg-token',
        expiresInSeconds: 600,
      });
    });
  });

  describe('linkGoogle', () => {
    it('attaches Google to the signed-in account', async () => {
      usersFindOne
        .mockResolvedValueOnce(makeUser()) // the caller
        .mockResolvedValueOnce(null); // googleId unclaimed

      await service.linkGoogle('user-1', 'id-token');

      expect(usersSave).toHaveBeenCalledWith(
        expect.objectContaining({ googleId: 'google-sub-123' }),
      );
    });

    it('refuses when the account already has a different Google account', async () => {
      usersFindOne.mockResolvedValue(makeUser({ googleId: 'some-other-google-id' }));

      await expect(service.linkGoogle('user-1', 'id-token')).rejects.toThrow(ConflictException);
    });

    it('refuses when that Google account belongs to someone else', async () => {
      usersFindOne
        .mockResolvedValueOnce(makeUser())
        .mockResolvedValueOnce(makeUser({ id: 'other-user', googleId: 'google-sub-123' }));

      await expect(service.linkGoogle('user-1', 'id-token')).rejects.toThrow(ConflictException);
    });

    it('never overwrites an email the buyer set themselves', async () => {
      // Silently changing it would move where their order updates go.
      const user = makeUser({ email: 'chosen@example.com' });
      usersFindOne.mockResolvedValueOnce(user).mockResolvedValueOnce(null);

      await service.linkGoogle('user-1', 'id-token');

      expect(user.email).toBe('chosen@example.com');
    });
  });
});
