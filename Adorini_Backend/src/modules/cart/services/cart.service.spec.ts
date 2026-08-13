import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CartService } from './cart.service';
import { PricingService } from './pricing.service';
import { DiscountType } from '../../../common/enums/domain.enums';
import { CartItem } from '../../../database/entities/cart-item.entity';
import { Order } from '../../../database/entities/order.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { CouponsService } from '../../coupons/services/coupons.service';

/**
 * Scoped to the coupon addition to `getCart` — the rest of `CartService`
 * (add/update/remove item) is untouched by this change and has no existing
 * coverage of its own to extend.
 */
describe('CartService — coupon preview', () => {
  let service: CartService;
  let cartItemsRepo: { find: jest.Mock };
  let variantsRepo: { find: jest.Mock };
  let ordersRepo: { countBy: jest.Mock };
  let coupons: { preview: jest.Mock };

  const cartItem = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'item-1',
    userId: 'user-1',
    variantId: 'variant-1',
    quantity: 1,
    ...overrides,
  });

  const variant = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'variant-1',
    isActive: true,
    pricePaise: null,
    stockQuantity: 10,
    product: { id: 'prod-1', slug: 'kurti', name: 'Kurti', pricePaise: 100_000, isActive: true },
    ...overrides,
  });

  beforeEach(async () => {
    cartItemsRepo = { find: jest.fn().mockResolvedValue([cartItem()]) };
    variantsRepo = { find: jest.fn().mockResolvedValue([variant()]) };
    ordersRepo = { countBy: jest.fn().mockResolvedValue(1) }; // not a first order, keeps cases simple
    coupons = { preview: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        PricingService,
        { provide: getRepositoryToken(CartItem), useValue: cartItemsRepo },
        { provide: getRepositoryToken(ProductVariant), useValue: variantsRepo },
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: CouponsService, useValue: coupons },
        { provide: DataSource, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string) =>
                ({
                  FREE_DELIVERY_THRESHOLD_PAISE: 300_000,
                  DELIVERY_FEE_PAISE: 4_900,
                  FIRST_ORDER_DISCOUNT_PERCENT: 10,
                })[key],
            ),
          },
        },
      ],
    }).compile();

    service = module.get(CartService);
  });

  it('does not call the coupon service when no code is given', async () => {
    await service.getCart('user-1', 0);

    expect(coupons.preview).not.toHaveBeenCalled();
  });

  it('previews the coupon against the in-stock subtotal', async () => {
    coupons.preview.mockResolvedValue({ applied: false, reason: 'NOT_FOUND', message: 'nope' });

    await service.getCart('user-1', 0, 'SAVE10');

    expect(coupons.preview).toHaveBeenCalledWith('SAVE10', 'user-1', 100_000);
  });

  it('surfaces the rejection message without applying a discount', async () => {
    coupons.preview.mockResolvedValue({
      applied: false,
      reason: 'EXPIRED',
      message: 'That coupon has expired.',
    });

    const result = await service.getCart('user-1', 0, 'SAVE10');

    expect(result.couponMessage).toBe('That coupon has expired.');
    expect(result.totals.discountSource).toBe('NONE');
  });

  it('applies the coupon discount and reports no message when it validates', async () => {
    coupons.preview.mockResolvedValue({
      applied: true,
      coupon: { discountType: DiscountType.PERCENT, discountValue: 20, maxDiscountPaise: null },
    });

    const result = await service.getCart('user-1', 0, 'SAVE20');

    expect(result.couponMessage).toBeNull();
    expect(result.totals.discountSource).toBe('COUPON');
    expect(result.totals.discountPaise).toBe(20_000);
  });

  it('reports no coupon message for an empty cart, regardless of the code', async () => {
    cartItemsRepo.find.mockResolvedValue([]);

    const result = await service.getCart('user-1', 0, 'SAVE20');

    expect(result.couponMessage).toBeNull();
    expect(coupons.preview).not.toHaveBeenCalled();
  });
});
