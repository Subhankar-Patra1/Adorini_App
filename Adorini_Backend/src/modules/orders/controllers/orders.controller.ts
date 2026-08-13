import {
  Body,
  ConflictException,
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
import { DeliveryFailureService } from '../services/delivery-failure.service';
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
  constructor(
    private readonly orders: OrdersService,
    private readonly deliveryFailures: DeliveryFailureService,
  ) {}

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

  /**
   * "Yes, I still want it" for an order the courier could not hand over.
   *
   * The in-app equivalent of replying to the WhatsApp prompt — a buyer who
   * opens the app rather than answering the message must not be stuck. Ownership
   * is enforced by resolving the order through `getDetail` first, so another
   * buyer's order is a 404 rather than a reschedulable parcel.
   */
  @Post(':id/request-redelivery')
  @ApiOperation({
    summary: 'Ask for another delivery attempt after a failed one',
    description: [
      'Valid only while the order is DELIVERY_FAILED, within the response window, and with courier attempts still remaining — `canRequestReattempt` on the order detail says whether it will be accepted.',
      '',
      'The same parcel and waybill are reattempted; this is a redelivery, not a new order.',
    ].join('\n'),
  })
  @ApiResponse({ status: 201, type: OrderDetailDto })
  @ApiResponse({
    status: 409,
    description: 'Window expired, attempts exhausted, or not awaiting a decision',
  })
  async requestRedelivery(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetail> {
    // Scoped read first: this 404s on someone else's order before the
    // reattempt service, which works by order id alone, ever sees it.
    await this.orders.getDetail(user.id, id);

    const outcome = await this.deliveryFailures.requestReattempt(id);

    if (!outcome.requested) {
      throw new ConflictException({
        code: `REDELIVERY_${outcome.reason}`,
        message: REDELIVERY_REFUSAL_MESSAGES[outcome.reason],
      });
    }

    return this.orders.getDetail(user.id, id);
  }
}

const REDELIVERY_REFUSAL_MESSAGES: Record<string, string> = {
  NO_FAILED_ORDER: 'This order is not waiting on a delivery decision.',
  WINDOW_EXPIRED: 'The window to reschedule this delivery has closed.',
  ATTEMPTS_EXHAUSTED: 'The courier cannot attempt this delivery again.',
};
