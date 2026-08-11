import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Server } from 'http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { UsersModule } from './users.module';
import { AuthModule } from '../auth/auth.module';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ENTITIES } from '../../database/entities';
import { SnakeNamingStrategy } from '../../database/naming.strategy';
import { validateEnv } from '../../config/env.validation';
import {
  body as jsonBody,
  type AddressBody,
  type LoginBody,
  type PublicUserBody,
  type ReferralCodeBody,
} from '../../common/testing/http-body';
import { OAuthService } from '../../providers/oauth/oauth.service';
import { RedisModule } from '../../providers/redis/redis.module';
import { RedisService } from '../../providers/redis/redis.service';
import { SmsService } from '../../providers/sms/sms.service';

/**
 * Profile and address management over real HTTP.
 *
 * The authorization tests matter most here: address rows are the first
 * user-owned resource in the system, so this is where an ownership bug would
 * first become a data leak.
 */
describe('users (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;

  const sentCodes = new Map<string, string>();

  const ALICE = '9876500010';
  const BOB = '9876500011';

  const validAddress = {
    recipientName: 'Alice Buyer',
    recipientPhone: '9876500010',
    line1: '1 Park Street',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700016',
  };

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
      .useValue({ verifyGoogleIdToken: jest.fn() })
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
    await ds.query(
      'TRUNCATE "refresh_tokens", "referrals", "addresses", "wallets", "users" CASCADE',
    );

    const redis = app.get(RedisService);
    await redis.del(
      ...[`91${ALICE}`, `91${BOB}`].flatMap((phone) => [
        `otp:code:${phone}`,
        `otp:attempts:${phone}`,
        `otp:resend:${phone}`,
        `otp:reqcount:${phone}`,
      ]),
    );
  });

  const api = () => request(app.getHttpServer() as Server);

  async function signIn(phone: string): Promise<string> {
    await api().post('/api/auth/otp/request').send({ phone }).expect(202);
    const code = sentCodes.get(`91${phone}`);
    if (!code) throw new Error(`No OTP captured for ${phone}`);

    const res = await api().post('/api/auth/otp/verify').send({ phone, otp: code }).expect(200);

    return jsonBody<LoginBody>(res).accessToken;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('profile', () => {
    it('returns the signed-in user', async () => {
      const token = await signIn(ALICE);

      const res = await api().get('/api/users/me').set(auth(token)).expect(200);

      expect(jsonBody<PublicUserBody>(res).phone).toBe(`91${ALICE}`);
      // Internal flags must not reach a buyer-facing payload.
      expect(jsonBody<PublicUserBody>(res)).not.toHaveProperty('isAdmin');
    });

    it('updates editable fields', async () => {
      const token = await signIn(ALICE);

      const res = await api()
        .patch('/api/users/me')
        .set(auth(token))
        .send({ fullName: 'Alice Buyer', gender: 'female' })
        .expect(200);

      expect(jsonBody<PublicUserBody>(res).fullName).toBe('Alice Buyer');
    });

    it('will not let the phone be changed through the profile', async () => {
      // Phone identifies the account; changing it must go through OTP.
      const token = await signIn(ALICE);

      await api().patch('/api/users/me').set(auth(token)).send({ phone: '9999999999' }).expect(200);

      const res = await api().get('/api/users/me').set(auth(token)).expect(200);
      expect(jsonBody<PublicUserBody>(res).phone).toBe(`91${ALICE}`);
    });

    it('rejects an invalid email', async () => {
      const token = await signIn(ALICE);

      await api()
        .patch('/api/users/me')
        .set(auth(token))
        .send({ email: 'not-an-email' })
        .expect(400);
    });

    it('409s when an email is already taken', async () => {
      const aliceToken = await signIn(ALICE);
      await api()
        .patch('/api/users/me')
        .set(auth(aliceToken))
        .send({ email: 'shared@example.com' })
        .expect(200);

      const bobToken = await signIn(BOB);
      await api()
        .patch('/api/users/me')
        .set(auth(bobToken))
        .send({ email: 'shared@example.com' })
        .expect(409);
    });

    it('requires authentication', async () => {
      await api().get('/api/users/me').expect(401);
      await api().patch('/api/users/me').send({ fullName: 'x' }).expect(401);
    });
  });

  describe('referral code', () => {
    it('mints once and stays stable', async () => {
      const token = await signIn(ALICE);

      const first = await api().get('/api/users/me/referral-code').set(auth(token)).expect(200);
      const second = await api().get('/api/users/me/referral-code').set(auth(token)).expect(200);

      const firstCode = jsonBody<ReferralCodeBody>(first).referralCode;
      expect(firstCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      expect(jsonBody<ReferralCodeBody>(second).referralCode).toBe(firstCode);
    });

    it('gives different users different codes', async () => {
      const aliceCode = jsonBody<ReferralCodeBody>(
        await api()
          .get('/api/users/me/referral-code')
          .set(auth(await signIn(ALICE)))
          .expect(200),
      ).referralCode;

      const bobCode = jsonBody<ReferralCodeBody>(
        await api()
          .get('/api/users/me/referral-code')
          .set(auth(await signIn(BOB)))
          .expect(200),
      ).referralCode;

      expect(aliceCode).not.toBe(bobCode);
    });

    it('starts with an empty referral list', async () => {
      const token = await signIn(ALICE);

      const res = await api().get('/api/users/me/referrals').set(auth(token)).expect(200);

      expect(jsonBody<unknown[]>(res)).toEqual([]);
    });
  });

  describe('addresses', () => {
    it('makes the first address the default automatically', async () => {
      const token = await signIn(ALICE);

      const res = await api()
        .post('/api/users/me/addresses')
        .set(auth(token))
        .send(validAddress)
        .expect(201);

      expect(jsonBody<AddressBody>(res).isDefault).toBe(true);
    });

    it('keeps exactly one default when a second is promoted', async () => {
      const token = await signIn(ALICE);

      const first = await api()
        .post('/api/users/me/addresses')
        .set(auth(token))
        .send(validAddress)
        .expect(201);
      const second = await api()
        .post('/api/users/me/addresses')
        .set(auth(token))
        .send({ ...validAddress, line1: '2 Camac Street' })
        .expect(201);

      await api()
        .post(`/api/users/me/addresses/${jsonBody<AddressBody>(second).id}/default`)
        .set(auth(token))
        .expect(200);

      const list = jsonBody<AddressBody[]>(
        await api().get('/api/users/me/addresses').set(auth(token)).expect(200),
      );
      const defaults = list.filter((a) => a.isDefault);
      const secondId = jsonBody<AddressBody>(second).id;

      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(secondId);
      expect(list[0].id).toBe(secondId); // default sorts first
      expect(jsonBody<AddressBody>(first).id).not.toBe(secondId);
    });

    it('promotes a survivor when the default is deleted', async () => {
      // A buyer must never end up with no default and a blank checkout screen.
      const token = await signIn(ALICE);

      const first = await api()
        .post('/api/users/me/addresses')
        .set(auth(token))
        .send(validAddress)
        .expect(201);
      await api()
        .post('/api/users/me/addresses')
        .set(auth(token))
        .send({ ...validAddress, line1: '2 Camac Street' })
        .expect(201);

      await api()
        .delete(`/api/users/me/addresses/${jsonBody<AddressBody>(first).id}`)
        .set(auth(token))
        .expect(204);

      const list = jsonBody<AddressBody[]>(
        await api().get('/api/users/me/addresses').set(auth(token)).expect(200),
      );

      expect(list).toHaveLength(1);
      expect(list[0].isDefault).toBe(true);
    });

    it('rejects a malformed PIN code before it reaches the database', async () => {
      // The column also has a CHECK constraint; this proves the boundary
      // rejects it first, with a 400 rather than a 500.
      const token = await signIn(ALICE);

      await api()
        .post('/api/users/me/addresses')
        .set(auth(token))
        .send({ ...validAddress, pincode: '012345' })
        .expect(400);
    });

    it('normalises the recipient phone', async () => {
      const token = await signIn(ALICE);

      const res = await api()
        .post('/api/users/me/addresses')
        .set(auth(token))
        .send({ ...validAddress, recipientPhone: '+91 98765 00010' })
        .expect(201);

      expect(jsonBody<AddressBody>(res).recipientPhone).toBe('919876500010');
    });

    describe('ownership', () => {
      it('does not list another user’s addresses', async () => {
        const aliceToken = await signIn(ALICE);
        await api()
          .post('/api/users/me/addresses')
          .set(auth(aliceToken))
          .send(validAddress)
          .expect(201);

        const bobToken = await signIn(BOB);
        const res = await api().get('/api/users/me/addresses').set(auth(bobToken)).expect(200);

        expect(jsonBody<unknown[]>(res)).toEqual([]);
      });

      it('404s — not 403 — on another user’s address', async () => {
        // A 403 would confirm the id exists, which is enough to enumerate.
        const aliceToken = await signIn(ALICE);
        const alices = await api()
          .post('/api/users/me/addresses')
          .set(auth(aliceToken))
          .send(validAddress)
          .expect(201);

        const bobToken = await signIn(BOB);

        await api()
          .get(`/api/users/me/addresses/${jsonBody<AddressBody>(alices).id}`)
          .set(auth(bobToken))
          .expect(404);
        await api()
          .patch(`/api/users/me/addresses/${jsonBody<AddressBody>(alices).id}`)
          .set(auth(bobToken))
          .send({ city: 'Delhi' })
          .expect(404);
        await api()
          .delete(`/api/users/me/addresses/${jsonBody<AddressBody>(alices).id}`)
          .set(auth(bobToken))
          .expect(404);
        await api()
          .post(`/api/users/me/addresses/${jsonBody<AddressBody>(alices).id}/default`)
          .set(auth(bobToken))
          .expect(404);
      });

      it('leaves the other user’s data untouched after a failed attempt', async () => {
        const aliceToken = await signIn(ALICE);
        const alices = await api()
          .post('/api/users/me/addresses')
          .set(auth(aliceToken))
          .send(validAddress)
          .expect(201);

        const bobToken = await signIn(BOB);
        await api()
          .delete(`/api/users/me/addresses/${jsonBody<AddressBody>(alices).id}`)
          .set(auth(bobToken))
          .expect(404);

        await api()
          .get(`/api/users/me/addresses/${jsonBody<AddressBody>(alices).id}`)
          .set(auth(aliceToken))
          .expect(200);
      });

      it('rejects a non-UUID id with 400', async () => {
        const token = await signIn(ALICE);

        await api().get('/api/users/me/addresses/not-a-uuid').set(auth(token)).expect(400);
      });
    });

    it('requires authentication on every route', async () => {
      await api().get('/api/users/me/addresses').expect(401);
      await api().post('/api/users/me/addresses').send(validAddress).expect(401);
    });
  });
});
