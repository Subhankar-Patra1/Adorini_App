import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CartController } from './controllers/cart.controller';
import { CartService } from './services/cart.service';
import { PricingService } from './services/pricing.service';
import { CartItem } from '../../database/entities/cart-item.entity';
import { Order } from '../../database/entities/order.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CartItem, ProductVariant, Order])],
  controllers: [CartController],
  providers: [CartService, PricingService],
  // Checkout reuses both: the same cart the buyer sees becomes the order, and
  // the same pricing code produces the number they are charged.
  exports: [CartService, PricingService],
})
export class CartModule {}
