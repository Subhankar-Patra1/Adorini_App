import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { OrderStatus } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import type { Env } from '../../../config/env.validation';
import { OrdersService } from '../../orders/services/orders.service';

/**
 * Auto-cancels COD orders that never cleared intent verification.
 *
 * Without this, a buyer who never answers the OTP (wrong number, changed
 * their mind, gave up) leaves an order sitting in `PENDING_VERIFICATION`
 * forever, holding the stock it reserved at placement indefinitely — reducing
 * real availability for every other shopper without anyone deciding that.
 *
 * Runs hourly rather than on a tighter schedule: the timeout itself is
 * measured in hours (`COD_VERIFICATION_TIMEOUT_HOURS`), so sub-hour polling
 * would only add load without changing when any order actually gets swept.
 */
@Injectable()
export class CodVerificationSweepService {
  private readonly logger = new Logger(CodVerificationSweepService.name);
  private readonly timeoutHours: number;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly ordersService: OrdersService,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutHours = config.get('COD_VERIFICATION_TIMEOUT_HOURS', { infer: true });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - this.timeoutHours * 60 * 60 * 1000);

    // Candidate ids only — each cancellation takes its own row lock inside its
    // own transaction via `OrdersService`, rather than holding one transaction
    // open across every expired order in the sweep.
    const expired = await this.orders.find({
      where: { status: OrderStatus.PENDING_VERIFICATION, createdAt: LessThan(cutoff) },
      select: { id: true, orderNumber: true },
    });

    if (expired.length === 0) {
      return;
    }

    this.logger.log(`COD verification sweep: ${expired.length} order(s) past ${this.timeoutHours}h`);

    let cancelled = 0;
    for (const order of expired) {
      try {
        const wasCancelled = await this.ordersService.autoCancelUnverifiedCod(order.id);
        if (wasCancelled) {
          cancelled++;
        }
      } catch (error) {
        // One bad row must not stop the sweep from reaching the rest — logged
        // for follow-up, not rethrown.
        this.logger.error(`Failed to auto-cancel order ${order.orderNumber}`, error);
      }
    }

    this.logger.log(`COD verification sweep: cancelled ${cancelled}/${expired.length}`);
  }
}
