import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminReturnsController, ReturnsController } from './controllers/returns.controller';
import { ReturnsService } from './services/returns.service';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ReturnRequest } from '../../database/entities/return-request.entity';
import { User } from '../../database/entities/user.entity';

/** `User` is registered for `AdminGuard`, which reads `is_admin` per request. */
@Module({
  imports: [TypeOrmModule.forFeature([ReturnRequest, Order, OrderItem, User])],
  controllers: [ReturnsController, AdminReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
