import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderTransitionService } from './services/order-transition.service';
import { Order } from '../../database/entities/order.entity';

/**
 * Currently the orders *domain core* only — the state machine and the guarded
 * transition service, which the webhooks module drives.
 *
 * The buyer-facing routes (order history, address edit, cancellation) are
 * deliberately absent: every one of them is scoped to "the calling user", and
 * that identity arrives with the auth module. Building them against a guessed
 * auth contract would mean rewriting them once the real one lands.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  providers: [OrderTransitionService],
  exports: [OrderTransitionService],
})
export class OrdersModule {}
