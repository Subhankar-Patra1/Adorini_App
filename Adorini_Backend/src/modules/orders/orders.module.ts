import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrdersController } from './controllers/orders.controller';
import { OrderTransitionService } from './services/order-transition.service';
import { OrdersService } from './services/orders.service';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { Wallet } from '../../database/entities/wallet.entity';
import { WalletTransaction } from '../../database/entities/wallet-transaction.entity';

/**
 * Orders: the domain core plus the buyer-facing routes.
 *
 * The transition service and state machine are the write path every other
 * module drives — webhooks advance an order through them, never by assigning a
 * status directly. `OrdersService` adds the buyer's own view: history, detail,
 * the pre-dispatch address edit (@GUARD Risk #2) and cancellation.
 *
 * The controller was held back until the auth module existed, because every one
 * of its routes is scoped to "the calling user" and building against a guessed
 * identity contract would have meant rewriting it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, ProductVariant, Wallet, WalletTransaction]),
  ],
  controllers: [OrdersController],
  providers: [OrderTransitionService, OrdersService],
  exports: [OrderTransitionService, OrdersService],
})
export class OrdersModule {}
