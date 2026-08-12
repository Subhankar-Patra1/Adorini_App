import { Test, type TestingModule } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';

loadDotenv();

/**
 * Guards the public surface of the API.
 *
 * Authentication is registered globally and fail-closed (ADR-013), which is the
 * right default — a forgotten `@Public()` is a visible 401, while the opt-in
 * alternative fails by silently exposing data. But it has a sharp edge, and the
 * project has already been cut by it: `catalog`, `pdp` and `webhooks` shipped
 * without `@Public()`, which meant the **entire storefront returned 401** and
 * every Cashfree, Delhivery and MSG91 callback was rejected before reaching its
 * own signature check. Providers would have retried, given up, and left
 * payments unconfirmed and referrals unpaid.
 *
 * Nothing in the unit suite could catch that: each controller was individually
 * correct, and the guard was individually correct. Only the composition was
 * wrong. So this asserts the composition, against the real `AppModule`.
 */
describe('public route surface', () => {
  let app: INestApplication;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    const url = new URL(originalDatabaseUrl ?? '');
    url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
    process.env.DATABASE_URL = url.toString();

    const { AppModule } = await import('../../app.module');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  const api = () => request(app.getHttpServer() as Server);

  /** The guard's own rejection, as distinct from an endpoint's own auth. */
  const BLOCKED_BY_GLOBAL_GUARD = 'Missing bearer token';

  describe('storefront browsing needs no account', () => {
    it.each(['/api/catalog/categories', '/api/catalog/brands', '/api/catalog/products'])(
      '%s is reachable anonymously',
      async (path) => {
        await api().get(path).expect(200);
      },
    );

    it('product pages are reachable anonymously', async () => {
      // 404 is a fine outcome for an unknown slug — 401 is not, because it
      // would mean nobody can view a product without signing up first.
      const res = await api().get('/api/pdp/some-product-slug');

      expect(res.status).not.toBe(401);
    });

    it('search is reachable anonymously', async () => {
      await api().get('/api/catalog/products?q=kurti').expect(200);
    });
  });

  describe('provider webhooks reach their own authentication', () => {
    /**
     * These endpoints are emphatically not unauthenticated — they authenticate
     * per provider. What must not happen is the *global* guard rejecting them
     * first, since Cashfree and Delhivery cannot present an Adorini token.
     */
    it.each(['cashfree', 'delhivery', 'msg91'])(
      '/api/webhooks/%s is not blocked by the global guard',
      async (provider) => {
        const res = await api().post(`/api/webhooks/${provider}`).send({});

        expect(res.body).not.toMatchObject({ message: BLOCKED_BY_GLOBAL_GUARD });
      },
    );

    it('still rejects a webhook with the wrong shared secret', async () => {
      const res = await api()
        .post('/api/webhooks/delhivery')
        .set('x-adorini-webhook-token', 'not-the-real-token')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ message: 'Invalid webhook token' });
    });

    it('answers a malformed but authenticated payload with 400, not 500', async () => {
      // A 5xx tells the provider to redeliver, so a permanently-unparseable
      // payload would be retried forever.
      const res = await api()
        .post('/api/webhooks/delhivery')
        .set('x-adorini-webhook-token', process.env.DELHIVERY_WEBHOOK_TOKEN ?? '')
        .send({ nonsense: true });

      expect(res.status).toBe(400);
    });
  });

  describe('auth and health stay open', () => {
    it('OTP request is reachable anonymously', async () => {
      const res = await api().post('/api/auth/otp/request').send({ phone: 'not-a-phone' });

      // 400 for the bad number is correct; 401 would mean you must already be
      // signed in to sign in.
      expect(res.status).toBe(400);
    });

    it.each(['/api/health', '/api/health/ready'])('%s is reachable anonymously', async (path) => {
      await api().get(path).expect(200);
    });
  });

  describe('everything else stays closed', () => {
    it.each([
      ['get', '/api/users/me'],
      ['get', '/api/users/me/addresses'],
      ['get', '/api/users/me/referral-code'],
      ['post', '/api/auth/logout-all'],
    ])('%s %s requires a token', async (method, path) => {
      const res = await (method === 'get' ? api().get(path) : api().post(path).send({}));

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ message: BLOCKED_BY_GLOBAL_GUARD });
    });
  });
});
