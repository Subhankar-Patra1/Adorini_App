import { Test, type TestingModule } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';

import { OrderStatus, PaymentMethod } from '../../common/enums/domain.enums';
import { CartItem } from '../../database/entities/cart-item.entity';
import { Order } from '../../database/entities/order.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { RedisService } from '../../providers/redis/redis.service';
import { WhatsAppService } from '../../providers/whatsapp/whatsapp.service';
import { OAuthService } from '../../providers/oauth/oauth.service';

loadDotenv();

/**
 * The purchase journey, end to end, against real PostgreSQL and Redis.
 *
 * Only Meta's WhatsApp Cloud API and Google are stubbed — we cannot receive a
 * WhatsApp message or mint a Google token. Everything else is the real stack:
 * the global guard, Zod validation, TypeORM transactions, row locks, and the
 * database's own check constraints.
 *
 * This is the test that would catch a break in the seam between cart, pricing,
 * stock and orders — none of which the per-service unit specs can see, because
 * each of them is individually correct.
 */
describe('commerce journey (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;

  const sentCodes = new Map<string, string>();
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const BUYER = '9876700001';
  const NORMALISED = '919876700001';

  const address = {
    recipientName: 'Test Buyer',
    recipientPhone: BUYER,
    line1: '1 Park Street',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700016',
  };

  beforeAll(async () => {
    const url = new URL(originalDatabaseUrl ?? '');
    url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
    process.env.DATABASE_URL = url.toString();

    const { AppModule } = await import('../../app.module');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WhatsAppService)
      .useValue({
        sendOtp: jest.fn((phone: string, code: string) => {
          sentCodes.set(phone, code);
          return Promise.resolve();
        }),
        notifyTemplate: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(OAuthService)
      .useValue({ verifyGoogleIdToken: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();

    ds = moduleRef.get(DataSource);
    await ds.runMigrations();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  let token: string;
  let addressId: string;
  let variantId: string;
  let productPricePaise: number;

  beforeEach(async () => {
    sentCodes.clear();
    // Catalogue tables are cleared too, so the fixture below is inserted fresh
    // with known ids. Upserting on a natural key instead would silently keep a
    // previous run's primary key and leave the fixture pointing at nothing.
    await ds.query(
      'TRUNCATE "return_requests", "cart_items", "order_items", "orders", "refresh_tokens", "referrals", "wallet_transactions", "wallets", "users", "product_variants", "products", "categories", "brands" CASCADE',
    );

    const redis = app.get(RedisService);
    const keys = await redis.getClient().keys('otp:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // A real product to buy, seeded fresh so stock is deterministic.
    await ds.query(`
      INSERT INTO categories (id, slug, name) VALUES
        ('11111111-1111-4111-8111-111111111111','kurtis','Kurtis')
`);
    await ds.query(`
      INSERT INTO brands (id, slug, name) VALUES
        ('22222222-2222-4222-8222-222222222222','sana','sana')
`);
    await ds.query(`
      INSERT INTO products (id, slug, name, category_id, brand_id, price_paise, fabric_type)
      VALUES ('33333333-3333-4333-8333-333333333333','journey-kurti','Journey Kurti',
              '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
              89900,'RIGID')
`);
    await ds.query(`
      INSERT INTO product_variants (id, product_id, sku, nominal_size, colour, stock_quantity)
      VALUES ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',
              'JOURNEY-42-INDIGO',42,'Indigo',5)
`);

    variantId = '44444444-4444-4444-8444-444444444444';
    productPricePaise = 89_900;

    token = await signIn(BUYER);
    addressId = await createAddress(token);
  });

  const api = () => request(app.getHttpServer() as Server);
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function signIn(phone: string): Promise<string> {
    await api().post('/api/auth/otp/request').send({ phone }).expect(202);
    const code = sentCodes.get(`91${phone}`);
    if (!code) throw new Error(`no OTP captured for ${phone}`);

    const res = await api().post('/api/auth/otp/verify').send({ phone, otp: code }).expect(200);

    return (res.body as { accessToken: string }).accessToken;
  }

  async function createAddress(t: string): Promise<string> {
    const res = await api().post('/api/users/me/addresses').set(auth(t)).send(address).expect(201);

    return (res.body as { id: string }).id;
  }

  async function addToCart(quantity = 1): Promise<void> {
    const res = await api().post('/api/cart/items').set(auth(token)).send({ variantId, quantity });

    if (res.status !== 201) {
      throw new Error(`addToCart failed ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  describe('cart', () => {
    it('prices a line from the live catalogue', async () => {
      await addToCart(2);

      const res = await api().get('/api/cart').set(auth(token)).expect(200);
      const body = res.body as {
        items: { unitPricePaise: number; lineTotalPaise: number }[];
        totals: { subtotalPaise: number; deliveryFeePaise: number };
      };

      expect(body.items[0].unitPricePaise).toBe(productPricePaise);
      expect(body.items[0].lineTotalPaise).toBe(productPricePaise * 2);
      expect(body.totals.subtotalPaise).toBe(productPricePaise * 2);
    });

    it('reflects a price change made after the item was added', async () => {
      // Nothing about money is stored on the cart row, so a repricing reaches
      // the buyer before checkout rather than surprising them at payment.
      await addToCart();
      await ds.query(`UPDATE products SET price_paise = 99900 WHERE slug = 'journey-kurti'`);

      const res = await api().get('/api/cart').set(auth(token)).expect(200);

      expect((res.body as { totals: { subtotalPaise: number } }).totals.subtotalPaise).toBe(99_900);
    });

    it('merges a repeat add instead of duplicating the line', async () => {
      await addToCart(1);
      await addToCart(2);

      const res = await api().get('/api/cart').set(auth(token)).expect(200);
      const body = res.body as { items: { quantity: number }[] };

      expect(body.items).toHaveLength(1);
      expect(body.items[0].quantity).toBe(3);
    });

    it('refuses more than the shelf holds', async () => {
      await api()
        .post('/api/cart/items')
        .set(auth(token))
        .send({ variantId, quantity: 6 })
        .expect(400);
    });

    it('sets no-store so an edge cache never holds a cart', async () => {
      const res = await api().get('/api/cart').set(auth(token)).expect(200);

      expect(res.headers['cache-control']).toContain('no-store');
    });
  });

  describe('checkout — @GUARD Risk #3, server-authoritative pricing', () => {
    it('ignores any price the client tries to supply', async () => {
      // The DTO has no price field at all; anything extra is dropped rather
      // than trusted. This is the whole mitigation in one assertion.
      await addToCart(2);

      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({
          addressId,
          paymentMethod: PaymentMethod.COD,
          totalPaise: 1,
          subtotalPaise: 1,
          discountPaise: 999_999,
        })
        .expect(201);

      const placed = res.body as { orderId: string; totalPaise: number };
      const order = await ds.getRepository(Order).findOneByOrFail({ id: placed.orderId });

      // First order → 10% off, under ₹3,000 → delivery charged.
      const subtotal = productPricePaise * 2;
      const discount = Math.floor(subtotal * 0.1);
      expect(order.subtotalPaise).toBe(subtotal);
      expect(order.discountPaise).toBe(discount);
      expect(order.totalPaise).toBe(subtotal - discount + order.deliveryFeePaise);
      expect(order.totalPaise).not.toBe(1);
    });

    it('satisfies the totals check constraint it is guarded by', async () => {
      await addToCart();

      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD })
        .expect(201);

      const order = await ds
        .getRepository(Order)
        .findOneByOrFail({ id: (res.body as { orderId: string }).orderId });

      expect(order.totalPaise).toBe(
        order.subtotalPaise -
          order.discountPaise +
          order.deliveryFeePaise -
          order.walletCreditPaise,
      );
    });

    it('decrements stock and empties the cart, atomically', async () => {
      await addToCart(2);

      await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD })
        .expect(201);

      const variant = await ds.getRepository(ProductVariant).findOneByOrFail({ id: variantId });
      const remaining = await ds.getRepository(CartItem).count();

      expect(variant.stockQuantity).toBe(3);
      expect(remaining).toBe(0);
    });

    it('takes no stock when the order cannot be placed', async () => {
      // Address belongs to nobody — the whole placement must roll back.
      await addToCart(2);

      await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({
          addressId: '55555555-5555-4555-8555-555555555555',
          paymentMethod: PaymentMethod.COD,
        })
        .expect(404);

      const variant = await ds.getRepository(ProductVariant).findOneByOrFail({ id: variantId });

      expect(variant.stockQuantity).toBe(5);
      expect(await ds.getRepository(CartItem).count()).toBe(1);
    });

    it('refuses an empty cart', async () => {
      await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD })
        .expect(400);
    });

    it('puts a COD order into PENDING_VERIFICATION and sends a code', async () => {
      await addToCart();

      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD })
        .expect(201);

      const placed = res.body as { status: string; requiresCodVerification: boolean };

      expect(placed.status).toBe(OrderStatus.PENDING_VERIFICATION);
      expect(placed.requiresCodVerification).toBe(true);
    });

    it('confirms a COD order once the code is entered', async () => {
      await addToCart();

      const placed = (
        await api()
          .post('/api/checkout/place')
          .set(auth(token))
          .send({ addressId, paymentMethod: PaymentMethod.COD })
          .expect(201)
      ).body as { orderId: string };

      const code = sentCodes.get(NORMALISED);
      expect(code).toBeDefined();

      const res = await api()
        .post(`/api/checkout/orders/${placed.orderId}/verify-cod`)
        .set(auth(token))
        .send({ otp: code })
        .expect(201);

      expect((res.body as { status: string }).status).toBe(OrderStatus.CONFIRMED);
    });

    it('rejects a wrong COD code', async () => {
      await addToCart();
      const placed = (
        await api()
          .post('/api/checkout/place')
          .set(auth(token))
          .send({ addressId, paymentMethod: PaymentMethod.COD })
          .expect(201)
      ).body as { orderId: string };

      await api()
        .post(`/api/checkout/orders/${placed.orderId}/verify-cod`)
        .set(auth(token))
        .send({ otp: '000000' })
        .expect(400);
    });
  });

  describe('orders — @GUARD Risk #2, the address-edit race', () => {
    async function placeOrder(): Promise<string> {
      await addToCart();
      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD })
        .expect(201);

      return (res.body as { orderId: string }).orderId;
    }

    it('allows an address change before dispatch', async () => {
      const orderId = await placeOrder();

      const res = await api()
        .patch(`/api/orders/${orderId}/address`)
        .set(auth(token))
        .send({ ...address, line1: '99 New Road' })
        .expect(200);

      expect((res.body as { shippingAddress: { line1: string } }).shippingAddress.line1).toBe(
        '99 New Road',
      );
    });

    it('refuses the edit once the order has shipped', async () => {
      // The precise failure this closes: an edit landing on a parcel already in
      // transit, leaving our record disagreeing with where the goods went.
      const orderId = await placeOrder();
      await ds.query(`UPDATE orders SET status = 'SHIPPED', shipped_at = now() WHERE id = $1`, [
        orderId,
      ]);

      const res = await api()
        .patch(`/api/orders/${orderId}/address`)
        .set(auth(token))
        .send({ ...address, line1: '99 New Road' })
        .expect(409);

      expect((res.body as { code: string }).code).toBe('ADDRESS_LOCKED');
    });

    it('leaves the stored address untouched when the edit is refused', async () => {
      const orderId = await placeOrder();
      await ds.query(`UPDATE orders SET status = 'SHIPPED' WHERE id = $1`, [orderId]);

      await api()
        .patch(`/api/orders/${orderId}/address`)
        .set(auth(token))
        .send({ ...address, line1: '99 New Road' })
        .expect(409);

      const order = await ds.getRepository(Order).findOneByOrFail({ id: orderId });
      expect(order.shippingAddress.line1).toBe('1 Park Street');
    });

    it('shows the buyer whether an edit is still possible', async () => {
      const orderId = await placeOrder();

      const before = await api().get(`/api/orders/${orderId}`).set(auth(token)).expect(200);
      expect((before.body as { canEditAddress: boolean }).canEditAddress).toBe(true);

      await ds.query(`UPDATE orders SET status = 'SHIPPED' WHERE id = $1`, [orderId]);

      const after = await api().get(`/api/orders/${orderId}`).set(auth(token)).expect(200);
      expect((after.body as { canEditAddress: boolean }).canEditAddress).toBe(false);
    });

    it('returns stock and refunds credit when an order is cancelled', async () => {
      const orderId = await placeOrder();

      await api().post(`/api/orders/${orderId}/cancel`).set(auth(token)).send({}).expect(201);

      const variant = await ds.getRepository(ProductVariant).findOneByOrFail({ id: variantId });
      const order = await ds.getRepository(Order).findOneByOrFail({ id: orderId });

      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(variant.stockQuantity).toBe(5); // back on the shelf
    });

    it('404s on another buyer’s order', async () => {
      const orderId = await placeOrder();
      const otherToken = await signIn('9876700002');

      await api().get(`/api/orders/${orderId}`).set(auth(otherToken)).expect(404);
      await api()
        .patch(`/api/orders/${orderId}/address`)
        .set(auth(otherToken))
        .send(address)
        .expect(404);
    });
  });

  describe('wallet', () => {
    it('starts every account at zero', async () => {
      const res = await api().get('/api/wallet').set(auth(token)).expect(200);

      expect((res.body as { balancePaise: number }).balancePaise).toBe(0);
    });

    it('spends credit at checkout and records the debit', async () => {
      await ds.query(
        `UPDATE wallets SET balance_paise = 20000 WHERE user_id = (SELECT id FROM users WHERE phone = $1)`,
        [NORMALISED],
      );

      await addToCart();

      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD, walletCreditPaise: 20_000 })
        .expect(201);

      const order = await ds
        .getRepository(Order)
        .findOneByOrFail({ id: (res.body as { orderId: string }).orderId });

      expect(order.walletCreditPaise).toBe(20_000);

      const balance = await api().get('/api/wallet').set(auth(token)).expect(200);
      expect((balance.body as { balancePaise: number }).balancePaise).toBe(0);

      const statement = await api().get('/api/wallet/transactions').set(auth(token)).expect(200);
      expect((statement.body as { amountPaise: number }[])[0].amountPaise).toBe(-20_000);
    });

    it('cannot spend more credit than the balance holds', async () => {
      await addToCart();

      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD, walletCreditPaise: 999_999 })
        .expect(201);

      const order = await ds
        .getRepository(Order)
        .findOneByOrFail({ id: (res.body as { orderId: string }).orderId });

      // Clamped to a zero balance, so the buyer still owes the full amount.
      expect(order.walletCreditPaise).toBe(0);
      expect(order.totalPaise).toBeGreaterThan(0);
    });
  });

  describe('returns', () => {
    async function deliveredOrder(): Promise<string> {
      await addToCart();
      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD })
        .expect(201);

      const orderId = (res.body as { orderId: string }).orderId;
      await ds.query(`UPDATE orders SET status = 'DELIVERED', delivered_at = now() WHERE id = $1`, [
        orderId,
      ]);

      return orderId;
    }

    it('lists what can be sent back from a delivered order', async () => {
      const orderId = await deliveredOrder();

      const res = await api()
        .get(`/api/returns/orders/${orderId}/eligible-items`)
        .set(auth(token))
        .expect(200);

      expect((res.body as { isEligible: boolean }[])[0].isEligible).toBe(true);
    });

    it('records a return and derives its fit tag from the reason', async () => {
      const orderId = await deliveredOrder();
      const items = (
        await api()
          .get(`/api/returns/orders/${orderId}/eligible-items`)
          .set(auth(token))
          .expect(200)
      ).body as { orderItemId: string }[];

      const res = await api()
        .post(`/api/returns/orders/${orderId}`)
        .set(auth(token))
        .send({ orderItemId: items[0].orderItemId, quantity: 1, reason: 'SIZE_TOO_SMALL' })
        .expect(201);

      // The signal that corrects the size chart, inferred rather than trusted.
      expect((res.body as { fitTag: string }).fitTag).toBe('RUNS_SMALL');
    });

    it('refuses a second return for the same line', async () => {
      const orderId = await deliveredOrder();
      const items = (
        await api()
          .get(`/api/returns/orders/${orderId}/eligible-items`)
          .set(auth(token))
          .expect(200)
      ).body as { orderItemId: string }[];

      const payload = {
        orderItemId: items[0].orderItemId,
        quantity: 1,
        reason: 'CHANGED_MY_MIND',
      };

      await api().post(`/api/returns/orders/${orderId}`).set(auth(token)).send(payload).expect(201);
      await api().post(`/api/returns/orders/${orderId}`).set(auth(token)).send(payload).expect(409);
    });

    it('refuses a return on an order that was never delivered', async () => {
      await addToCart();
      const res = await api()
        .post('/api/checkout/place')
        .set(auth(token))
        .send({ addressId, paymentMethod: PaymentMethod.COD })
        .expect(201);

      await api()
        .get(`/api/returns/orders/${(res.body as { orderId: string }).orderId}/eligible-items`)
        .set(auth(token))
        .expect(409);
    });
  });

  describe('admin', () => {
    it('refuses a non-staff buyer', async () => {
      await api().get('/api/admin/products').set(auth(token)).expect(403);
    });

    it('admits a staff account', async () => {
      await ds.query(`UPDATE users SET is_admin = true WHERE phone = $1`, [NORMALISED]);

      await api().get('/api/admin/products').set(auth(token)).expect(200);
    });

    it('rejects a size chart that contradicts the fabric (@GUARD Risk #5)', async () => {
      await ds.query(`UPDATE users SET is_admin = true WHERE phone = $1`, [NORMALISED]);

      await api()
        .post('/api/admin/products')
        .set(auth(token))
        .send({
          slug: 'mismatched-chart-kurti',
          name: 'Mismatched',
          categoryId: '11111111-1111-4111-8111-111111111111',
          brandId: '22222222-2222-4222-8222-222222222222',
          pricePaise: 50_000,
          fabricType: 'RIGID',
          sizeRules: {
            fabricType: 'STRETCH',
            entries: [
              {
                nominalSize: 42,
                bust: { minCm: 103, maxCm: 113 },
                waist: { minCm: 83, maxCm: 93 },
                hip: { minCm: 106, maxCm: 116 },
                garmentLengthCm: 110,
              },
            ],
          },
        })
        .expect(400);
    });
  });
});
