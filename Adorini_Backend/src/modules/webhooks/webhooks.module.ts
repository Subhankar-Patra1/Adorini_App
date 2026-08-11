import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WebhooksController } from './controllers/webhooks.controller';
import { WebhookIdempotencyService } from './services/webhook-idempotency.service';
import { WebhooksService } from './services/webhooks.service';
import { ProcessedWebhook } from '../../database/entities/processed-webhook.entity';
import { PaymentsModule } from '../../providers/payments/payments.module';
import { RedisModule } from '../../providers/redis/redis.module';
import { OrdersModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProcessedWebhook]),
    RedisModule,
    PaymentsModule,
    OrdersModule,
    WalletModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookIdempotencyService],
})
export class WebhooksModule {}
