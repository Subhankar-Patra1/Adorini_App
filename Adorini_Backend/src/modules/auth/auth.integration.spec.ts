import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Server } from 'http';
import request from 'supertest';
import { DataSource, IsNull } from 'typeorm';

import { AuthModule } from './auth.module';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ENTITIES, Referral, RefreshToken, User, Wallet } from '../../database/entities';
import { SnakeNamingStrategy } from '../../database/naming.strategy';
import { normalisePhone } from '../../common/utils/phone.util';
import {
  body as jsonBody,
  type ErrorBody,
  type GoogleSignInBody,
  type LoginBody,
} from '../../common/testing/http-body';
import { validateEnv } from '../../config/env.validation';
import { OAuthProviderError, OAuthService } from '../../providers/oauth/oauth.service';
import { RedisModule } from '../../providers/redis/redis.module';
import { RedisService } from '../../providers/redis/redis.service';
import { SmsService } from '../../providers/sms/sms.service';
import { UsersModule } from '../users/users.module';

/**
 * End-to-end auth over real HTTP, against live PostgreSQL and Redis.
 *
 * Only the two outbound integrations are stubbed — MSG91 (we would be paying
 * for SMS and could not read the code) and Google (we cannot mint a real ID
 * token). Everything else is the actual stack: the global guard, the Zod pipe,
 * the exception filter, TypeORM, and the OTP store. The unit specs prove each
 * piece; this proves they are wired together.
 */
describe('auth (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;

  /** Captures the code MSG91 would have delivered. */
  const sentCodes = new Map<string, string>();
  const verifyGoogleIdToken = jest.fn();

  const PHONE = '9876500001';
  const NORMALISED = '919876500001';

  function testDatabaseUrl(): string {
    const base = process.env.DATABASE_URL;
    if (!base) throw new Error('DATABASE_URL is required for integration tests');
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
    return url.toString();
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: testDatabaseUrl(),
          entities: ENTITIES,
          migrations: [`${__dirname}/../../database/migrations/*{.ts,.js}`],
          namingStrategy: new SnakeNamingStrategy(),
          uuidExtension: 'pgcrypto',
          synchronize: false,
          migrationsRun: true,
          logging: false,
        }),
        RedisModule,
        AuthModule,
        UsersModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      .overrideProvider(SmsService)
      .useValue({
        sendOtp: jest.fn((phone: string, code?: string) => {
          if (code) sentCodes.set(phone, code);
          return Promise.resolve();
        }),
        whatsappNotify: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(OAuthService)
      .useValue({ verifyGoogleIdToken })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();

    ds = moduleRef.get(DataSource);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    sentCodes.clear();
    verifyGoogleIdToken.mockReset();
    await ds.query('TRUNCATE "refresh_tokens", "referrals", "wallets", "users" CASCADE');
    await clearOtpState();
  });

  /**
   * OTP state lives in Redis, not Postgres, so truncating tables does not reset
   * it. Without this the resend cooldown from one test rejects the next.
   */
  async function clearOtpState(): Promise<void> {
    const redis = app.get(RedisService);
    const phones = ['919876500001', '919876500002', '919876500050', '919876500099'];

    await redis.del(
      ...phones.flatMap((phone) => [
        `otp:code:${phone}`,
        `otp:attempts:${phone}`,
        `otp:resend:${phone}`,
        `otp:reqcount:${phone}`,
      ]),
    );
  }

  /** Alias kept short because it appears in almost every assertion. */
  const clearRateLimits = clearOtpState;

  const api = () => request(app.getHttpServer() as Server);

  /** Runs the full OTP flow and returns the login payload. */
  async function login(phone = PHONE, body: Record<string, unknown> = {}): Promise<LoginBody> {
    await api().post('/api/auth/otp/request').send({ phone }).expect(202);

    // The code is captured under the *normalised* number, since that is what
    // the service passes to MSG91 — so the helper has to normalise too rather
    // than assume the caller passed a bare 10-digit number.
    const normalised = normalisePhone(phone);
    const code = normalised ? sentCodes.get(normalised) : undefined;
    if (!code) throw new Error(`No OTP captured for ${phone}`);

    const res = await api()
      .post('/api/auth/otp/verify')
      .send({ phone, otp: code, ...body })
      .expect(200);

    return jsonBody<LoginBody>(res);
  }

  describe('OTP login', () => {
    it('creates the account, its wallet, and returns tokens', async () => {
      const body = await login();

      expect(body).toMatchObject({ isNewUser: true, referralApplied: false });
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('refreshToken');

      // A user without a wallet is an account that breaks at checkout.
      const user = await ds.getRepository(User).findOneByOrFail({ phone: NORMALISED });
      await expect(ds.getRepository(Wallet).countBy({ userId: user.id })).resolves.toBe(1);
      expect(user.isPhoneVerified).toBe(true);
    });

    it('logs the same user back in without creating a second account', async () => {
      await login();
      await clearRateLimits();

      const second = await login();

      expect(second.isNewUser).toBe(false);
      await expect(ds.getRepository(User).count()).resolves.toBe(1);
    });

    it('normalises the phone so different formats are one account', async () => {
      await login('9876500001');
      await clearRateLimits();
      await login('+919876500001');

      await expect(ds.getRepository(User).count()).resolves.toBe(1);
    });

    it('rejects a wrong code', async () => {
      await api().post('/api/auth/otp/request').send({ phone: PHONE }).expect(202);

      await api().post('/api/auth/otp/verify').send({ phone: PHONE, otp: '000000' }).expect(401);
    });

    it('rejects a malformed phone before doing any work', async () => {
      await api().post('/api/auth/otp/request').send({ phone: '12345' }).expect(400);
    });

    it('enforces the resend cooldown', async () => {
      await api().post('/api/auth/otp/request').send({ phone: PHONE }).expect(202);

      const res = await api().post('/api/auth/otp/request').send({ phone: PHONE });

      expect(res.status).toBe(400);
      expect(jsonBody<ErrorBody>(res).message).toMatch(/wait/i);
    });

    it('answers identically for a registered and unregistered number', async () => {
      // Otherwise this endpoint reveals who is already a customer.
      await login();
      await clearRateLimits();

      const known = await api().post('/api/auth/otp/request').send({ phone: PHONE });
      const unknown = await api().post('/api/auth/otp/request').send({ phone: '9876500099' });

      expect(known.status).toBe(unknown.status);
      expect(jsonBody<unknown>(known)).toEqual(jsonBody<unknown>(unknown));
    });
  });

  describe('the access token actually works', () => {
    it('is accepted by a protected endpoint', async () => {
      const { accessToken } = await login();

      const res = await api()
        .get('/api/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(jsonBody<{ phone: string }>(res).phone).toBe(NORMALISED);
    });

    it('is required — no token means 401', async () => {
      await api().get('/api/users/me').expect(401);
    });

    it('rejects a garbage token', async () => {
      await api().get('/api/users/me').set('Authorization', 'Bearer not-a-real-token').expect(401);
    });
  });

  describe('refresh rotation', () => {
    it('issues a new pair and invalidates the old refresh token', async () => {
      const { refreshToken } = await login();

      const rotated = await api().post('/api/auth/refresh').send({ refreshToken }).expect(200);

      expect(jsonBody<LoginBody>(rotated).refreshToken).not.toBe(refreshToken);

      // The old one is now spent.
      await api().post('/api/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('revokes every session when a used token is replayed', async () => {
      // Reuse means the raw token leaked. We cannot tell the thief from the
      // owner, so both are signed out.
      const { refreshToken } = await login();

      const rotated = await api().post('/api/auth/refresh').send({ refreshToken }).expect(200);

      // Replay the spent token — this is the detection trigger.
      await api().post('/api/auth/refresh').send({ refreshToken }).expect(401);

      // The thief's freshly-rotated token must be dead too.
      await api()
        .post('/api/auth/refresh')
        .send({ refreshToken: jsonBody<LoginBody>(rotated).refreshToken })
        .expect(401);

      const live = await ds.getRepository(RefreshToken).countBy({ revokedAt: IsNull() });
      expect(live).toBe(0);
    });

    it('rejects an unknown refresh token', async () => {
      await api().post('/api/auth/refresh').send({ refreshToken: 'never-issued' }).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the presented token', async () => {
      const { refreshToken } = await login();

      await api().post('/api/auth/logout').send({ refreshToken }).expect(204);
      await api().post('/api/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('is idempotent for an unknown token', async () => {
      await api().post('/api/auth/logout').send({ refreshToken: 'nope' }).expect(204);
    });

    it('logout-all ends every session', async () => {
      const first = await login();
      await clearRateLimits();
      const second = await login();

      await api()
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${second.accessToken}`)
        .expect(204);

      await api().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
      await api().post('/api/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
    });

    it('logout-all requires authentication', async () => {
      await api().post('/api/auth/logout-all').expect(401);
    });
  });

  describe('Google sign-in', () => {
    const googlePayload = {
      googleId: 'google-sub-abc',
      email: 'buyer@example.com',
      name: 'Google Buyer',
      emailVerified: true,
    };

    it('asks for a phone when no account exists', async () => {
      // users.phone is NOT NULL, so Google alone cannot complete a signup.
      verifyGoogleIdToken.mockResolvedValue(googlePayload);

      const res = await api()
        .post('/api/auth/google')
        .send({ idToken: 'google-id-token' })
        .expect(200);

      expect(jsonBody<GoogleSignInBody>(res).status).toBe('PHONE_REQUIRED');
      expect(jsonBody<GoogleSignInBody>(res).registrationToken).toBeTruthy();
      await expect(ds.getRepository(User).count()).resolves.toBe(0);
    });

    it('completes registration once the phone is verified', async () => {
      verifyGoogleIdToken.mockResolvedValue(googlePayload);

      const started = await api()
        .post('/api/auth/google')
        .send({ idToken: 'google-id-token' })
        .expect(200);

      const body = await login(PHONE, {
        registrationToken: jsonBody<GoogleSignInBody>(started).registrationToken,
      });

      expect(body.isNewUser).toBe(true);

      const user = await ds.getRepository(User).findOneByOrFail({ phone: NORMALISED });
      expect(user.googleId).toBe('google-sub-abc');
      expect(user.email).toBe('buyer@example.com');
    });

    it('logs straight in on a second Google sign-in', async () => {
      verifyGoogleIdToken.mockResolvedValue(googlePayload);

      const started = await api()
        .post('/api/auth/google')
        .send({ idToken: 'google-id-token' })
        .expect(200);
      await login(PHONE, {
        registrationToken: jsonBody<GoogleSignInBody>(started).registrationToken,
      });

      const again = await api()
        .post('/api/auth/google')
        .send({ idToken: 'google-id-token' })
        .expect(200);

      expect(jsonBody<GoogleSignInBody>(again).status).toBe('AUTHENTICATED');
      expect(jsonBody<GoogleSignInBody>(again).accessToken).toBeTruthy();
    });

    it('will not redeem a registration token twice', async () => {
      verifyGoogleIdToken.mockResolvedValue(googlePayload);

      const started = await api()
        .post('/api/auth/google')
        .send({ idToken: 'google-id-token' })
        .expect(200);
      await login(PHONE, {
        registrationToken: jsonBody<GoogleSignInBody>(started).registrationToken,
      });
      await clearRateLimits();

      // Replaying it must not attach the same Google identity to another phone.
      await api().post('/api/auth/otp/request').send({ phone: '9876500002' }).expect(202);
      const code = sentCodes.get('919876500002')!;

      await api()
        .post('/api/auth/otp/verify')
        .send({
          phone: '9876500002',
          otp: code,
          registrationToken: jsonBody<GoogleSignInBody>(started).registrationToken,
        })
        .expect(400);
    });

    it('surfaces a rejected Google token as 401', async () => {
      verifyGoogleIdToken.mockRejectedValue(new OAuthProviderError('Invalid Google ID token', 400));

      await api().post('/api/auth/google').send({ idToken: 'bad' }).expect(401);
    });

    it('surfaces an unreachable Google as 503, not 401', async () => {
      // Telling a user their valid login is invalid during our outage sends
      // them off to reset credentials that were never wrong.
      verifyGoogleIdToken.mockRejectedValue(
        new OAuthProviderError('Google OAuth service timed out'),
      );

      await api().post('/api/auth/google').send({ idToken: 'whatever' }).expect(503);
    });
  });

  describe('referral capture', () => {
    async function createReferrerWithCode(): Promise<string> {
      const { accessToken } = await login('9876500050');
      const res = await api()
        .get('/api/users/me/referral-code')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      await clearRateLimits();
      return jsonBody<{ referralCode: string }>(res).referralCode;
    }

    it('records a PENDING referral for a new signup', async () => {
      const code = await createReferrerWithCode();

      const body = await login(PHONE, { referralCode: code });

      expect(body.referralApplied).toBe(true);

      const referral = await ds.getRepository(Referral).findOneByOrFail({
        refereePhone: NORMALISED,
      });
      expect(referral.status).toBe('PENDING');
      // Nothing is credited at signup — payout happens on DELIVERED.
      expect(referral.creditPaise).toBe(10000);
    });

    it('signs the user up anyway when the code is unknown', async () => {
      const body = await login(PHONE, { referralCode: 'NOTAREAL' });

      expect(body.isNewUser).toBe(true);
      expect(body.referralApplied).toBe(false);
      expect(body.referralStatus).toBe('CODE_NOT_FOUND');
    });

    it('refuses a second referral for a phone that was already referred', async () => {
      // uq_referral_referee_phone survives account deletion (ADR-008), so this
      // closes the delete-and-re-signup route to a second ₹100.
      const code = await createReferrerWithCode();
      await login(PHONE, { referralCode: code });

      await ds.query('DELETE FROM users WHERE phone = $1', [NORMALISED]);
      await clearRateLimits();

      const again = await login(PHONE, { referralCode: code });

      expect(again.isNewUser).toBe(true);
      expect(again.referralApplied).toBe(false);
      // The buyer did nothing wrong — the app must say the offer is used up,
      // not that the code is invalid, or they will retype it and then call us.
      expect(again.referralStatus).toBe('ALREADY_REFERRED');
    });

    it('distinguishes a typo from an exhausted offer', async () => {
      const typo = await login(PHONE, { referralCode: 'NOTAREAL' });

      expect(typo.referralStatus).toBe('CODE_NOT_FOUND');
    });

    it('reports NOT_PROVIDED when the buyer skips the code', async () => {
      const plain = await login(PHONE);

      expect(plain.referralStatus).toBe('NOT_PROVIDED');
    });

    it('reports EXISTING_USER when a code arrives on a later sign-in', async () => {
      const code = await createReferrerWithCode();
      await login(PHONE);
      await clearRateLimits();

      const signIn = await login(PHONE, { referralCode: code });

      expect(signIn.isNewUser).toBe(false);
      expect(signIn.referralStatus).toBe('EXISTING_USER');
    });
  });
});
