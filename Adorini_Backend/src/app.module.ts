import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { HealthModule } from './common/health/health.module';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PdpModule } from './modules/pdp/pdp.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),

    // Application-level rate limiting. Cloudflare handles edge rate limiting
    // (see ADR-003), but the origin must not depend on the edge being in front
    // of it — direct-to-Railway requests bypass Cloudflare entirely.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),

    DatabaseModule,
    HealthModule,
    CatalogModule,
    PdpModule,
    WebhooksModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
