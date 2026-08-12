import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AddCartItemDto, CartQueryDto, CartViewDto, UpdateCartItemDto } from '../dto/cart.dto';
import { CartService, type CartView } from '../services/cart.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';
import type { AuthUser } from '../../../common/types/auth-user';

/**
 * The buyer's cart.
 *
 * Authenticated throughout — a cart belongs to an account, not a device, so it
 * survives reinstalling the app and follows the buyer to a new phone.
 *
 * Every response is the **whole cart**, not just the line that changed. One
 * round trip keeps the screen consistent: prices, stock and the free-delivery
 * progress bar all move when a line does, and returning only the edited row
 * would leave the rest of the screen stale.
 */
@ApiTags('cart')
@ApiBearerAuth()
@UseInterceptors(NoStoreInterceptor)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the cart, priced live from the catalogue',
    description:
      'Prices and stock are read at request time, so a price change since an item was added is reflected here rather than discovered at checkout.',
  })
  @ApiResponse({ status: 200, type: CartViewDto })
  getCart(@CurrentUser() user: AuthUser, @Query() query: CartQueryDto): Promise<CartView> {
    return this.cart.getCart(user.id, query.walletCreditPaise);
  }

  @Post('items')
  @ApiOperation({
    summary: 'Add a size to the cart',
    description:
      'Adding a variant already present increases its quantity instead of duplicating the line.',
  })
  @ApiResponse({ status: 201, type: CartViewDto })
  @ApiResponse({ status: 400, description: 'Not enough stock' })
  @ApiResponse({ status: 404, description: 'That size is no longer available' })
  addItem(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto): Promise<CartView> {
    return this.cart.addItem(user.id, dto.variantId, dto.quantity);
  }

  @Patch('items/:id')
  @ApiOperation({
    summary: 'Change a line’s quantity, size or colour',
    description:
      'Pass a different variantId to switch size/colour. Switching onto a variant already in the cart merges the two lines.',
  })
  @ApiResponse({ status: 200, type: CartViewDto })
  @ApiResponse({ status: 404, description: 'No such line in this cart' })
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartView> {
    return this.cart.updateItem(user.id, id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Remove a line from the cart' })
  @ApiResponse({ status: 200, type: CartViewDto })
  @ApiResponse({ status: 404, description: 'No such line in this cart' })
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CartView> {
    return this.cart.removeItem(user.id, id);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the cart' })
  @ApiResponse({ status: 200, type: CartViewDto })
  clear(@CurrentUser() user: AuthUser): Promise<CartView> {
    return this.cart.clear(user.id);
  }
}
