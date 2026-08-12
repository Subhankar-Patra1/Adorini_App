import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminCouponsController } from './controllers/coupons.controller';
import { CouponsService } from './services/coupons.service';
import { Coupon } from '../../database/entities/coupon.entity';
import { CouponRedemption } from '../../database/entities/coupon-redemption.entity';
import { User } from '../../database/entities/user.entity';

/**
 * Exports `CouponsService` for `cart` (quote preview) and `checkout`
 * (redemption at placement) — the one-directional dependency those two
 * modules already have on `PricingService` for the same reason.
 *
 * `User` is registered here too, for the same reason every other module with
 * an `AdminGuard`-protected controller registers it: the guard reads
 * `is_admin` from it on every request rather than trusting a token claim.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Coupon, CouponRedemption, User])],
  controllers: [AdminCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
