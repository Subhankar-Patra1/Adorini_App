import { Module } from '@nestjs/common';

import { WhatsappBotController } from './controllers/whatsapp-bot.controller';
import { WhatsappBotService } from './services/whatsapp-bot.service';
import { OrdersModule } from '../orders/orders.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

/**
 * Inbound WhatsApp handling.
 *
 * This directory was retained as empty boilerplate through the earlier
 * milestone by explicit decision. It came into scope only when in-WhatsApp
 * replies were chosen as the answer channel for the failed-delivery prompt —
 * see ADR-035 — and its scope remains exactly that one conversation, not a
 * general-purpose bot.
 */
@Module({
  imports: [OrdersModule, WebhooksModule],
  controllers: [WhatsappBotController],
  providers: [WhatsappBotService],
})
export class WhatsappBotModule {}
