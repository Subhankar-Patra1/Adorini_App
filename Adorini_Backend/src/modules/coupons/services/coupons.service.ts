import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, type EntityManager } from 'typeorm';

import type { AdminCouponDto, CreateCouponDto, UpdateCouponDto } from '../dto/coupons.dto';
import { Coupon } from '../../../database/entities/coupon.entity';
import { CouponRedemption } from '../../../database/entities/coupon-redemption.entity';

const PG_UNIQUE_VIOLATION = '23505';

export type CouponRejectionReason =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'BELOW_MINIMUM'
  | 'ALREADY_REDEEMED'
  | 'REDEMPTION_LIMIT_REACHED';

export type CouponResolution =
  | { applied: true; coupon: Coupon }
  | { applied: false; reason: CouponRejectionReason; message: string };

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon) private readonly coupons: Repository<Coupon>,
    @InjectRepository(CouponRedemption) private readonly redemptions: Repository<CouponRedemption>,
  ) {}

  /**
   * Read-only eligibility check for a quote preview. No lock, nothing
   * persisted — a preview must never itself consume the redemption it is
   * only showing the buyer.
   */
  async preview(code: string, userId: string, subtotalPaise: number): Promise<CouponResolution> {
    const coupon = await this.coupons.findOne({ where: { code: code.trim().toUpperCase() } });

    return this.evaluate(
      coupon,
      subtotalPaise,
      () => this.redemptions.count({ where: { couponId: coupon?.id, userId } }),
      () => this.redemptions.count({ where: { couponId: coupon?.id } }),
    );
  }

  /**
   * Re-validates under a row lock — must run inside the caller's placement
   * transaction (see `CheckoutService`), never on its own. Locking the coupon
   * row serialises every concurrent redemption attempt against it, which is
   * what makes the `maxRedemptions` count trustworthy: a second checkout
   * cannot read "1 of 1 used" while the first is still mid-commit.
   *
   * Does not itself record the redemption — the discount this coupon is
   * actually worth is not known until `PricingService` has run and decided
   * whether the coupon or the first-order discount won (see ADR-032). Call
   * `recordRedemption` afterwards, and only when it did.
   */
  async lockAndValidate(
    manager: EntityManager,
    code: string,
    userId: string,
    subtotalPaise: number,
  ): Promise<CouponResolution> {
    const coupon = await manager.findOne(Coupon, {
      where: { code: code.trim().toUpperCase() },
      lock: { mode: 'pessimistic_write' },
    });

    return this.evaluate(
      coupon,
      subtotalPaise,
      () => manager.count(CouponRedemption, { where: { couponId: coupon?.id, userId } }),
      () => manager.count(CouponRedemption, { where: { couponId: coupon?.id } }),
    );
  }

  /**
   * Called once, after the order exists, only when the coupon actually won
   * over the first-order discount. `uq_coupon_redemption_coupon_user` is the
   * backstop if the row lock above was ever bypassed or raced regardless —
   * the constraint is the real guarantee, the lock is what makes it not need
   * to fire under normal operation.
   */
  async recordRedemption(
    manager: EntityManager,
    couponId: string,
    userId: string,
    orderId: string,
    discountAppliedPaise: number,
  ): Promise<void> {
    await manager.save(
      CouponRedemption,
      manager.create(CouponRedemption, { couponId, userId, orderId, discountAppliedPaise }),
    );
  }

  private async evaluate(
    coupon: Coupon | null,
    subtotalPaise: number,
    countUserRedemptions: () => Promise<number>,
    countTotalRedemptions: () => Promise<number>,
  ): Promise<CouponResolution> {
    if (!coupon) {
      return { applied: false, reason: 'NOT_FOUND', message: 'That coupon code was not found.' };
    }
    if (!coupon.isActive) {
      return { applied: false, reason: 'INACTIVE', message: 'That coupon is no longer active.' };
    }

    const now = new Date();
    if (coupon.validFrom && now < coupon.validFrom) {
      return { applied: false, reason: 'NOT_STARTED', message: 'That coupon is not active yet.' };
    }
    if (coupon.validUntil && now > coupon.validUntil) {
      return { applied: false, reason: 'EXPIRED', message: 'That coupon has expired.' };
    }
    if (coupon.minOrderPaise !== null && subtotalPaise < coupon.minOrderPaise) {
      return {
        applied: false,
        reason: 'BELOW_MINIMUM',
        message: `This coupon needs a minimum order of ₹${(coupon.minOrderPaise / 100).toFixed(2)}.`,
      };
    }
    if ((await countUserRedemptions()) > 0) {
      return {
        applied: false,
        reason: 'ALREADY_REDEEMED',
        message: 'You have already used this coupon.',
      };
    }
    if (
      coupon.maxRedemptions !== null &&
      (await countTotalRedemptions()) >= coupon.maxRedemptions
    ) {
      return {
        applied: false,
        reason: 'REDEMPTION_LIMIT_REACHED',
        message: 'This coupon has reached its redemption limit.',
      };
    }

    return { applied: true, coupon };
  }

  // ---- admin ----

  async createCoupon(dto: CreateCouponDto): Promise<AdminCouponDto> {
    try {
      const coupon = await this.coupons.save(
        this.coupons.create({
          code: dto.code,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          minOrderPaise: dto.minOrderPaise ?? null,
          maxDiscountPaise: dto.maxDiscountPaise ?? null,
          maxRedemptions: dto.maxRedemptions ?? null,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          isActive: dto.isActive,
        }),
      );

      return this.toAdminDto(coupon, 0);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'COUPON_CODE_IN_USE',
          message: `A coupon with code "${dto.code}" already exists.`,
        });
      }
      throw error;
    }
  }

  /**
   * `discountType` and `discountValue` are deliberately not editable here.
   * Flipping a live code between PERCENT and FLAT, or changing what it is
   * worth, would silently change what an already-shared promotion means —
   * only the guardrails (minimum, cap, redemption limit, validity window,
   * active flag) can be adjusted after creation. A coupon that needs a
   * different value is a new coupon.
   */
  async updateCoupon(id: string, dto: UpdateCouponDto): Promise<AdminCouponDto> {
    const coupon = await this.requireCoupon(id);

    if ('minOrderPaise' in dto) coupon.minOrderPaise = dto.minOrderPaise ?? null;
    if ('maxDiscountPaise' in dto) coupon.maxDiscountPaise = dto.maxDiscountPaise ?? null;
    if ('maxRedemptions' in dto) coupon.maxRedemptions = dto.maxRedemptions ?? null;
    if ('validFrom' in dto) coupon.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if ('validUntil' in dto) coupon.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if ('isActive' in dto && dto.isActive !== undefined) coupon.isActive = dto.isActive;

    await this.coupons.save(coupon);

    const redemptionCount = await this.redemptions.count({ where: { couponId: id } });
    return this.toAdminDto(coupon, redemptionCount);
  }

  async listCoupons(): Promise<AdminCouponDto[]> {
    const coupons = await this.coupons.find({ order: { createdAt: 'DESC' } });

    const counts = await this.redemptions
      .createQueryBuilder('r')
      .select('r.couponId', 'couponId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.couponId')
      .getRawMany<{ couponId: string; count: string }>();

    const countByCoupon = new Map(counts.map((c) => [c.couponId, Number(c.count)]));

    return coupons.map((c) => this.toAdminDto(c, countByCoupon.get(c.id) ?? 0));
  }

  private async requireCoupon(id: string): Promise<Coupon> {
    const coupon = await this.coupons.findOne({ where: { id } });

    if (!coupon) {
      throw new NotFoundException(`Coupon ${id} not found`);
    }

    return coupon;
  }

  private toAdminDto(coupon: Coupon, redemptionCount: number): AdminCouponDto {
    return {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minOrderPaise: coupon.minOrderPaise,
      maxDiscountPaise: coupon.maxDiscountPaise,
      maxRedemptions: coupon.maxRedemptions,
      redemptionCount,
      validFrom: coupon.validFrom?.toISOString() ?? null,
      validUntil: coupon.validUntil?.toISOString() ?? null,
      isActive: coupon.isActive,
      createdAt: coupon.createdAt.toISOString(),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
