import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CreateReturnDto,
  EligibleItemDto,
  ListReturnsQueryDto,
  ReturnRequestDto,
  ReviewReturnDto,
} from '../dto/returns.dto';
import {
  ReturnsService,
  type EligibleItem,
  type ReturnRequestView,
} from '../services/returns.service';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';
import type { AuthUser } from '../../../common/types/auth-user';

@ApiTags('returns')
@ApiBearerAuth()
@UseInterceptors(NoStoreInterceptor)
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'The buyer’s own return requests' })
  @ApiResponse({ status: 200, type: [ReturnRequestDto] })
  listMine(@CurrentUser() user: AuthUser): Promise<ReturnRequestView[]> {
    return this.returns.listForUser(user.id);
  }

  @Get('orders/:orderId/eligible-items')
  @ApiOperation({
    summary: 'What can still be returned from an order',
    description:
      'Includes ineligible lines with the reason, so the app can explain why a return is unavailable rather than silently hiding the option.',
  })
  @ApiResponse({ status: 200, type: [EligibleItemDto] })
  @ApiResponse({ status: 409, description: 'Order has not been delivered' })
  listEligible(
    @CurrentUser() user: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<EligibleItem[]> {
    return this.returns.listEligibleItems(user.id, orderId);
  }

  @Post('orders/:orderId')
  @ApiOperation({
    summary: 'Request a return for one item',
    description: [
      'Allowed within 3 days of **delivery** — measured from when the buyer received the parcel, not when the order was placed.',
      '',
      'A sizing reason sets the fit tag automatically, which feeds size-chart correction alongside review fit tags.',
    ].join('\n'),
  })
  @ApiResponse({ status: 201, type: ReturnRequestDto })
  @ApiResponse({ status: 409, description: 'Window closed, or already requested' })
  request(
    @CurrentUser() user: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateReturnDto,
  ): Promise<ReturnRequestView> {
    return this.returns.requestReturn(user.id, orderId, dto);
  }
}

/**
 * Admin review queue, deliberately a separate controller.
 *
 * `AdminGuard` applies to the whole class, so a staff-only route cannot be
 * added to the buyer's controller by accident and inherit its permissions.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@UseInterceptors(NoStoreInterceptor)
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'Review queue for return requests' })
  @ApiResponse({ status: 200, type: [ReturnRequestDto] })
  @ApiResponse({ status: 403, description: 'Not an administrator' })
  list(@Query() query: ListReturnsQueryDto): Promise<ReturnRequestView[]> {
    return this.returns.listAll(query.status, query.limit, query.offset);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Approve, reject or complete a return',
    description:
      'No money moves here. Refunds need the Cashfree refund API for prepaid and a manual path for COD; issuing wallet credit instead would silently convert a cash refund into store credit.',
  })
  @ApiResponse({ status: 200, type: ReturnRequestDto })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReturnDto,
  ): Promise<ReturnRequestView> {
    return this.returns.review(id, dto.status, dto.adminNote);
  }
}
