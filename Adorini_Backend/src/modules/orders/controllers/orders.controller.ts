import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CancelOrderDto,
  ListOrdersQueryDto,
  OrderDetailDto,
  OrderSummaryDto,
  UpdateOrderAddressDto,
} from '../dto/orders.dto';
import { OrdersService, type OrderDetail, type OrderSummary } from '../services/orders.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';
import type { AuthUser } from '../../../common/types/auth-user';

/**
 * A buyer's own orders.
 *
 * Every route is scoped to the authenticated user in the query itself, and
 * another buyer's order is a 404 rather than a 403 — a 403 would confirm the id
 * exists, which is enough to enumerate order volume.
 *
 * `no-store` throughout (ADR-003): these responses carry delivery addresses and
 * amounts, and Cloudflare must never hold one.
 */
@ApiTags('orders')
@ApiBearerAuth()
@UseInterceptors(NoStoreInterceptor)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List the buyer’s orders, newest first' })
  @ApiResponse({ status: 200, type: [OrderSummaryDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQueryDto): Promise<OrderSummary[]> {
    return this.orders.list(user.id, query.limit, query.offset);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full order detail, including lines and tracking' })
  @ApiResponse({ status: 200, type: OrderDetailDto })
  @ApiResponse({ status: 404, description: 'No such order for this buyer' })
  getDetail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetail> {
    return this.orders.getDetail(user.id, id);
  }

  @Patch(':id/address')
  @ApiOperation({
    summary: 'Change the delivery address before dispatch',
    description: [
      'Allowed while the order is ORDERED, PENDING_VERIFICATION or CONFIRMED.',
      '',
      'The status is re-checked under a row lock at the moment of writing, so an edit racing a dispatch webhook is refused rather than silently applied to a parcel already in transit (@GUARD Risk #2).',
    ].join('\n'),
  })
  @ApiResponse({ status: 200, type: OrderDetailDto })
  @ApiResponse({ status: 404, description: 'No such order for this buyer' })
  @ApiResponse({ status: 409, description: 'Already dispatched — address is locked' })
  updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderAddressDto,
  ): Promise<OrderDetail> {
    return this.orders.updateShippingAddress(user.id, id, {
      ...dto,
      line2: dto.line2 ?? null,
    });
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an order before dispatch',
    description:
      'Returns the reserved stock and refunds any store credit spent, in the same transaction as the cancellation.',
  })
  @ApiResponse({ status: 201, type: OrderDetailDto })
  @ApiResponse({ status: 409, description: 'Already dispatched or in a terminal state' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderDetail> {
    return this.orders.cancel(user.id, id, dto.reason);
  }
}
