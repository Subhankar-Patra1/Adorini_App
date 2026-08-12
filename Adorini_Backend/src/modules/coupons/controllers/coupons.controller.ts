import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AdminCouponDto, CreateCouponDto, UpdateCouponDto } from '../dto/coupons.dto';
import { CouponsService } from '../services/coupons.service';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';

/**
 * Coupon administration. No public controller exists alongside this one —
 * codes are distributed out of band (marketing, referral messaging) rather
 * than browsed, so there is nothing for an unauthenticated route to list.
 */
@ApiTags('coupons')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@UseInterceptors(NoStoreInterceptor)
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @ApiOperation({ summary: 'All coupons, with redemption counts' })
  @ApiResponse({ status: 200, type: [AdminCouponDto] })
  list(): Promise<AdminCouponDto[]> {
    return this.coupons.listCoupons();
  }

  @Post()
  @ApiOperation({ summary: 'Create a coupon' })
  @ApiResponse({ status: 201, type: AdminCouponDto })
  @ApiResponse({ status: 409, description: 'That code is already in use' })
  create(@Body() dto: CreateCouponDto): Promise<AdminCouponDto> {
    return this.coupons.createCoupon(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a coupon’s guardrails',
    description:
      'Discount type and value are immutable after creation — changing what a shared code is worth is a new coupon, not an edit.',
  })
  @ApiResponse({ status: 200, type: AdminCouponDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
  ): Promise<AdminCouponDto> {
    return this.coupons.updateCoupon(id, dto);
  }
}
