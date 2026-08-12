import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CodVerificationSweepService } from './services/cod-verification-sweep.service';
import { DeliveryResponseSweepService } from './services/delivery-response-sweep.service';
import { Order } from '../../database/entities/order.entity';
import { OrdersModule } from '../orders/orders.module';

/**
 * Background sweeps. `ScheduleModule.forRoot()` is registered here rather than
 * in `AppModule` — a module that needs no cron jobs should not carry the
 * scheduler's global setup, and this is the only place that does.
 */
@Module({
  imports: [ScheduleModule.forRoot(), TypeOrmModule.forFeature([Order]), OrdersModule],
  providers: [CodVerificationSweepService, DeliveryResponseSweepService],
})
export class JobsModule {}
