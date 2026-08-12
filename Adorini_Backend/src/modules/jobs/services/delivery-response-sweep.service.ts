import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { DeliveryFailureService } from '../../orders/services/delivery-failure.service';

/**
 * Closes out failed deliveries nobody answered for.
 *
 * The other half of the promise made when a delivery fails: the buyer gets a
 * genuine window to say "yes, try again", and if that window passes in silence
 * the order stops occupying a decision nobody is going to make. Without this,
 * an unanswered prompt would leave the order in `DELIVERY_FAILED` forever and
 * the parcel's return would never be reconciled.
 *
 * Hourly, matching the COD sweep beside it: the window is measured in hours, so
 * polling more often would add load without changing when anything is actually
 * swept.
 */
@Injectable()
export class DeliveryResponseSweepService {
  private readonly logger = new Logger(DeliveryResponseSweepService.name);

  constructor(private readonly deliveryFailures: DeliveryFailureService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    try {
      await this.deliveryFailures.cancelUnanswered();
    } catch (error) {
      // A scheduled job that throws produces an unhandled rejection and no
      // record of why; the next tick should still run.
      this.logger.error('Delivery-response sweep failed', error);
    }
  }
}
