import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';

import { CouponsService } from './coupons.service';
import { DiscountType } from '../../../common/enums/domain.enums';
import { anyString } from '../../../common/testing/matchers';
import { Coupon } from '../../../database/entities/coupon.entity';
import { CouponRedemption } from '../../../database/entities/coupon-redemption.entity';
import type { CreateCouponDto, UpdateCouponDto } from '../dto/coupons.dto';

function uniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  (error as QueryFailedError & { code?: string }).code = '23505';
  return error;
}

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    code: 'WELCOME10',
    discountType: DiscountType.PERCENT,
    discountValue: 10,
    minOrderPaise: null,
    maxDiscountPaise: null,
    maxRedemptions: null,
    validFrom: null,
    validUntil: null,
    isActive: true,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    ...overrides,
  } as Coupon;
}

describe('CouponsService', () => {
  let service: CouponsService;
  let coupons: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let redemptions: { count: jest.Mock; createQueryBuilder: jest.Mock };
  let manager: { findOne: jest.Mock; count: jest.Mock; save: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    coupons = {
      findOne: jest.fn(),
      save: jest.fn((v: unknown) =>
        Promise.resolve({ createdAt: new Date('2026-08-12T00:00:00.000Z'), ...(v as object) }),
      ),
      create: jest.fn((v: unknown) => v),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };
    redemptions = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    };
    manager = {
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn((_e: unknown, v: unknown) => Promise.resolve(v)),
      create: jest.fn((_e: unknown, v: unknown) => v),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: getRepositoryToken(Coupon), useValue: coupons },
        { provide: getRepositoryToken(CouponRedemption), useValue: redemptions },
      ],
    }).compile();

    service = module.get(CouponsService);
  });

  describe('preview', () => {
    it('rejects an unknown code', async () => {
      coupons.findOne.mockResolvedValue(null);

      const result = await service.preview('NOPE', 'user-1', 100_000);

      expect(result).toEqual({ applied: false, reason: 'NOT_FOUND', message: anyString() });
    });

    it('normalises the code to uppercase before lookup', async () => {
      coupons.findOne.mockResolvedValue(null);

      await service.preview('welcome10', 'user-1', 100_000);

      expect(coupons.findOne).toHaveBeenCalledWith({ where: { code: 'WELCOME10' } });
    });

    it('rejects an inactive coupon', async () => {
      coupons.findOne.mockResolvedValue(coupon({ isActive: false }));

      const result = await service.preview('WELCOME10', 'user-1', 100_000);

      expect(result).toEqual({ applied: false, reason: 'INACTIVE', message: anyString() });
    });

    it('rejects a coupon that has not started yet', async () => {
      coupons.findOne.mockResolvedValue(
        coupon({ validFrom: new Date('2099-01-01T00:00:00.000Z') }),
      );

      const result = await service.preview('WELCOME10', 'user-1', 100_000);

      expect(result).toEqual({
        applied: false,
        reason: 'NOT_STARTED',
        message: anyString(),
      });
    });

    it('rejects an expired coupon', async () => {
      coupons.findOne.mockResolvedValue(
        coupon({ validUntil: new Date('2020-01-01T00:00:00.000Z') }),
      );

      const result = await service.preview('WELCOME10', 'user-1', 100_000);

      expect(result).toEqual({ applied: false, reason: 'EXPIRED', message: anyString() });
    });

    it('rejects an order below the coupon minimum', async () => {
      coupons.findOne.mockResolvedValue(coupon({ minOrderPaise: 500_000 }));

      const result = await service.preview('WELCOME10', 'user-1', 100_000);

      expect(result).toEqual({
        applied: false,
        reason: 'BELOW_MINIMUM',
        message: anyString(),
      });
    });

    it('rejects a user who already redeemed this coupon', async () => {
      coupons.findOne.mockResolvedValue(coupon());
      redemptions.count.mockResolvedValueOnce(1);

      const result = await service.preview('WELCOME10', 'user-1', 100_000);

      expect(result).toEqual({
        applied: false,
        reason: 'ALREADY_REDEEMED',
        message: anyString(),
      });
    });

    it('rejects once the global redemption cap is reached', async () => {
      coupons.findOne.mockResolvedValue(coupon({ maxRedemptions: 5 }));
      redemptions.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5);

      const result = await service.preview('WELCOME10', 'user-1', 100_000);

      expect(result).toEqual({
        applied: false,
        reason: 'REDEMPTION_LIMIT_REACHED',
        message: anyString(),
      });
    });

    it('applies a coupon that passes every check', async () => {
      const valid = coupon();
      coupons.findOne.mockResolvedValue(valid);

      const result = await service.preview('WELCOME10', 'user-1', 100_000);

      expect(result).toEqual({ applied: true, coupon: valid });
    });

    it('never persists anything — it is read-only', async () => {
      coupons.findOne.mockResolvedValue(coupon());

      await service.preview('WELCOME10', 'user-1', 100_000);

      expect(coupons.save).not.toHaveBeenCalled();
    });
  });

  describe('lockAndValidate', () => {
    it('locks the coupon row for update', async () => {
      manager.findOne.mockResolvedValue(coupon());

      await service.lockAndValidate(manager as never, 'WELCOME10', 'user-1', 100_000);

      expect(manager.findOne).toHaveBeenCalledWith(Coupon, {
        where: { code: 'WELCOME10' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('runs the same eligibility checks as preview', async () => {
      manager.findOne.mockResolvedValue(coupon({ isActive: false }));

      const result = await service.lockAndValidate(
        manager as never,
        'WELCOME10',
        'user-1',
        100_000,
      );

      expect(result).toEqual({ applied: false, reason: 'INACTIVE', message: anyString() });
    });
  });

  describe('recordRedemption', () => {
    it('saves a redemption row for the given order and amount', async () => {
      await service.recordRedemption(manager as never, 'coupon-1', 'user-1', 'order-1', 15_000);

      expect(manager.save).toHaveBeenCalledWith(
        CouponRedemption,
        expect.objectContaining({
          couponId: 'coupon-1',
          userId: 'user-1',
          orderId: 'order-1',
          discountAppliedPaise: 15_000,
        }),
      );
    });
  });

  describe('createCoupon', () => {
    const dto: CreateCouponDto = {
      code: 'WELCOME10',
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      isActive: true,
    };

    it('creates a coupon with zero redemptions', async () => {
      const result = await service.createCoupon(dto);

      expect(result.code).toBe('WELCOME10');
      expect(result.redemptionCount).toBe(0);
    });

    it('maps a duplicate code to a clear 409', async () => {
      coupons.save.mockRejectedValue(uniqueViolation());

      await expect(service.createCoupon(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('updateCoupon', () => {
    it('404s for an unknown coupon', async () => {
      coupons.findOne.mockResolvedValue(null);

      await expect(service.updateCoupon('nope', {})).rejects.toThrow(NotFoundException);
    });

    it('updates only the guardrail fields provided', async () => {
      const existing = coupon({ isActive: true, maxRedemptions: null });
      coupons.findOne.mockResolvedValue(existing);

      await service.updateCoupon('coupon-1', { isActive: false });

      expect(existing.isActive).toBe(false);
      expect(existing.maxRedemptions).toBeNull();
    });

    it('does not let discountType or discountValue be edited', async () => {
      const existing = coupon({ discountType: DiscountType.PERCENT, discountValue: 10 });
      coupons.findOne.mockResolvedValue(existing);

      await service.updateCoupon('coupon-1', {
        discountType: DiscountType.FLAT,
        discountValue: 99999,
      } as unknown as UpdateCouponDto);

      expect(existing.discountType).toBe(DiscountType.PERCENT);
      expect(existing.discountValue).toBe(10);
    });
  });

  describe('listCoupons', () => {
    it('attaches a redemption count per coupon', async () => {
      coupons.find.mockResolvedValue([coupon({ id: 'c1' }), coupon({ id: 'c2' })]);
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ couponId: 'c1', count: '3' }]),
      };
      redemptions.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listCoupons();

      expect(result.find((c) => c.id === 'c1')?.redemptionCount).toBe(3);
      expect(result.find((c) => c.id === 'c2')?.redemptionCount).toBe(0);
    });
  });
});
