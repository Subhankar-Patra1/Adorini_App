import type { DataSource } from 'typeorm';

import {
  Category,
  MediaAsset,
  Order,
  OrderItem,
  Product,
  ProductVariant,
  User,
  Wallet,
} from './entities';
import { initTestDataSource, truncateAll } from './testing/test-data-source';
import {
  FabricType,
  MediaProvenance,
  MediaType,
  OrderStatus,
  PaymentMethod,
} from '../common/enums/domain.enums';
import { Brand } from './entities/brand.entity';

/**
 * Proves the schema's own integrity rules — the ones that back business
 * guarantees the service layer will later depend on.
 *
 * The money constraints in particular are a backstop for @GUARD Risk #3
 * (server-authoritative pricing): even if a pricing bug reaches the insert, an
 * order whose total does not equal its own components cannot be stored.
 */
describe('schema invariants', () => {
  let ds: DataSource;
  let userId: string;
  let variantId: string;

  beforeAll(async () => {
    ds = await initTestDataSource();
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    await truncateAll(ds);

    const user = await ds
      .getRepository(User)
      .save({ phone: '919000000001', isPhoneVerified: true });
    userId = user.id;

    const category = await ds.getRepository(Category).save({ slug: 'kurtis', name: 'Kurtis' });
    const brand = await ds.getRepository(Brand).save({ slug: 'sana', name: 'sana' });
    const product = await ds.getRepository(Product).save({
      slug: 'test-kurti',
      name: 'Test Kurti',
      categoryId: category.id,
      brandId: brand.id,
      pricePaise: 50_000,
      fabricType: FabricType.RIGID,
    });
    const variant = await ds.getRepository(ProductVariant).save({
      productId: product.id,
      sku: 'TEST-KURTI-42',
      nominalSize: 42,
      colour: 'Indigo',
      stockQuantity: 10,
    });
    variantId = variant.id;
  });

  const address = {
    recipientName: 'Test Buyer',
    recipientPhone: '919000000001',
    line1: '1 Test Road',
    line2: null,
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700001',
  };

  function orderPayload(overrides: Partial<Order> = {}): Partial<Order> {
    return {
      orderNumber: `ADR-TEST-${Math.random().toString(36).slice(2, 10)}`,
      userId,
      status: OrderStatus.ORDERED,
      paymentMethod: PaymentMethod.COD,
      shippingAddress: address,
      subtotalPaise: 100_000,
      discountPaise: 10_000,
      deliveryFeePaise: 5_000,
      walletCreditPaise: 0,
      totalPaise: 95_000,
      ...overrides,
    };
  }

  describe('order money integrity', () => {
    it('accepts an order whose total matches its components', async () => {
      await expect(ds.getRepository(Order).insert(orderPayload())).resolves.toBeDefined();
    });

    it('rejects an order whose total does not match its components', async () => {
      // A tampered or mis-summed total — the shape @GUARD Risk #3 warns about.
      await expect(ds.getRepository(Order).insert(orderPayload({ totalPaise: 1 }))).rejects.toThrow(
        /chk_order_totals_consistent/i,
      );
    });

    it('rejects negative money amounts', async () => {
      await expect(
        ds.getRepository(Order).insert(
          orderPayload({
            discountPaise: -5_000,
            totalPaise: 110_000,
          }),
        ),
      ).rejects.toThrow(/chk_order_amounts_non_negative/i);
    });

    it('rejects a line whose total is not unit price x quantity', async () => {
      const order = await ds.getRepository(Order).save(orderPayload());

      await expect(
        ds.getRepository(OrderItem).insert({
          orderId: order.id,
          variantId,
          productName: 'Test Kurti',
          sku: 'TEST-KURTI-42',
          nominalSize: 42,
          colour: 'Indigo',
          unitPricePaise: 50_000,
          quantity: 2,
          lineTotalPaise: 50_000, // should be 100_000
        }),
      ).rejects.toThrow(/chk_order_item_line_total/i);
    });
  });

  describe('wallet and stock cannot go negative', () => {
    it('rejects a negative wallet balance', async () => {
      // The failure mode this prevents is a concurrent double-spend of store
      // credit turning into free money.
      await expect(ds.getRepository(Wallet).insert({ userId, balancePaise: -1 })).rejects.toThrow(
        /chk_wallet_balance_non_negative/i,
      );
    });

    it('rejects negative stock', async () => {
      await expect(
        ds.getRepository(ProductVariant).update({ id: variantId }, { stockQuantity: -1 }),
      ).rejects.toThrow(/chk_variant_stock_non_negative/i);
    });

    it('rejects a nominal size outside the stocked 40-48 band', async () => {
      await expect(
        ds.getRepository(ProductVariant).update({ id: variantId }, { nominalSize: 52 }),
      ).rejects.toThrow(/chk_variant_nominal_size_range/i);
    });
  });

  describe('media provenance', () => {
    it('rejects buyer media with no uploader attached', async () => {
      // Buyer media with no author cannot be moderated or attributed, and is
      // one bad join away from being rendered with the Official Media badge.
      const product = await ds.getRepository(Product).findOneByOrFail({
        slug: 'test-kurti',
      });

      await expect(
        ds.getRepository(MediaAsset).insert({
          productId: product.id,
          objectKey: 'buyer/photo.jpg',
          type: MediaType.IMAGE,
          provenance: MediaProvenance.BUYER,
          uploadedByUserId: null,
        }),
      ).rejects.toThrow(/chk_media_buyer_has_uploader/i);
    });

    it('accepts admin media with no uploader', async () => {
      const product = await ds.getRepository(Product).findOneByOrFail({
        slug: 'test-kurti',
      });

      await expect(
        ds.getRepository(MediaAsset).insert({
          productId: product.id,
          objectKey: 'official/hero.jpg',
          type: MediaType.IMAGE,
          provenance: MediaProvenance.ADMIN,
          uploadedByUserId: null,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('address validation', () => {
    it('rejects a malformed PIN code', async () => {
      await expect(
        ds.query(
          `INSERT INTO addresses (user_id, recipient_name, recipient_phone, line1, city, state, pincode)
           VALUES ($1, 'Test', '919000000001', '1 Test Road', 'Kolkata', 'West Bengal', '012345')`,
          [userId],
        ),
      ).rejects.toThrow(/chk_address_pincode_format/i);
    });
  });
});
