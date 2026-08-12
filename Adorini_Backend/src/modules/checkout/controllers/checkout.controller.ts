import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CodResentDto,
  CodVerifiedDto,
  PlaceOrderDto,
  PlacedOrderDto,
  VerifyCodDto,
} from '../dto/checkout.dto';
import { CheckoutService, type PlacedOrder } from '../services/checkout.service';
import { CartQueryDto, CartViewDto } from '../../cart/dto/cart.dto';
import { CartService, type CartView } from '../../cart/services/cart.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/types/auth-user';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';
import type { OrderStatus } from '../../../common/enums/domain.enums';

/**
 * Placing an order.
 *
 * Every route sets `Cache-Control: no-store` (ADR-003). Cloudflare sits in
 * front of the origin, and a cached checkout response is another buyer's order
 * total — or worse, their address — served to someone else.
 */
@ApiTags('checkout')
@ApiBearerAuth()
@UseInterceptors(NoStoreInterceptor)
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly cart: CartService,
  ) {}

  @Get('quote')
  @ApiOperation({
    summary: 'Preview the amount payable before committing',
    description:
      'Computed by the same code that runs at placement, so the figure shown is the figure charged. Prices are live, so a quote can change if the catalogue does.',
  })
  @ApiResponse({ status: 200, type: CartViewDto })
  quote(@CurrentUser() user: AuthUser, @Query() query: CartQueryDto): Promise<CartView> {
    return this.cart.getCart(user.id, query.walletCreditPaise);
  }

  @Post('place')
  @ApiOperation({
    summary: 'Turn the cart into an order',
    description: [
      'Stock is locked and decremented, totals are recomputed server-side, and the cart is emptied — all in one transaction.',
      '',
      'COD returns `requiresCodVerification: true` and sends an intent code; the order stays in PENDING_VERIFICATION until it is confirmed.',
      'Prepaid returns a `paymentSessionId` for the Cashfree SDK; the order confirms when the payment webhook arrives.',
    ].join('\n'),
  })
  @ApiResponse({ status: 201, type: PlacedOrderDto })
  @ApiResponse({ status: 400, description: 'Cart is empty' })
  @ApiResponse({ status: 404, description: 'Delivery address not found' })
  @ApiResponse({ status: 409, description: 'An item sold out or became unavailable' })
  place(@CurrentUser() user: AuthUser, @Body() dto: PlaceOrderDto): Promise<PlacedOrder> {
    return this.checkout.placeOrder({
      userId: user.id,
      addressId: dto.addressId,
      paymentMethod: dto.paymentMethod,
      walletCreditPaise: dto.walletCreditPaise,
    });
  }

  @Post('orders/:id/verify-cod')
  @ApiOperation({
    summary: 'Confirm a COD order with the intent code',
    description:
      'Idempotent — verifying an already-confirmed order returns its status rather than an error.',
  })
  @ApiResponse({ status: 201, type: CodVerifiedDto })
  @ApiResponse({ status: 400, description: 'Code incorrect or expired' })
  @ApiResponse({ status: 409, description: 'Order is not awaiting verification' })
  verifyCod(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: VerifyCodDto,
  ): Promise<{ status: OrderStatus }> {
    return this.checkout.verifyCodOtp(user.id, orderId, dto.otp);
  }

  @Post('orders/:id/resend-cod')
  @ApiOperation({ summary: 'Re-send the COD intent code' })
  @ApiResponse({ status: 201, type: CodResentDto })
  @ApiResponse({ status: 400, description: 'Still within the resend cooldown' })
  resendCod(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) orderId: string,
  ): Promise<{ expiresInSeconds: number }> {
    return this.checkout.resendCodOtp(user.id, orderId);
  }
}
