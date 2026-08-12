import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { HealthModule } from './common/health/health.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';

import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PdpModule } from './modules/pdp/pdp.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

import { RedisModule } from './providers/redis/redis.module';

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

    // RedisModule is @Global, but a global module still has to be imported
    // exactly once for Nest to instantiate it.
    RedisModule,

    // Identity first — everything below scopes its data to the calling user.
    AuthModule,
    UsersModule,
    HealthModule,

    // Discovery: public browsing.
    CatalogModule,
    PdpModule,

    // The purchase journey.
    CartModule,
    CheckoutModule,
    OrdersModule,
    WalletModule,
    ReturnsModule,

    // Inbound provider callbacks, and staff tools.
    WebhooksModule,
    AdminModule,
  ],

  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    /**
     * Authentication is fail-closed: registered globally, so every route is
     * protected unless it carries @Public(). A forgotten @Public() shows up
     * immediately as a 401; the opt-in alternative fails by silently exposing
     * an endpoint, which nobody notices.
     *
     * Ordering note: this runs after ThrottlerGuard, so an unauthenticated
     * flood is rate-limited before it reaches token verification.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
