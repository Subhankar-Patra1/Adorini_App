import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { Env } from '../../config/env.validation';

/**
 * Redis rejected a command, was unreachable, or timed out.
 *
 * ioredis throws plain `Error`s (and `ReplyError`s) that are indistinguishable
 * from any other failure at a call site. Wrapping them means the modules that
 * use Redis in Phase 4 — cart state, OTP rate limiting, the webhook fast-path
 * pre-check — can catch one specific type and decide whether to degrade or
 * fail, rather than swallowing every error alike.
 *
 * This matters most for the webhook fast path: a Redis failure there must
 * **not** abort processing, because the `processed_webhooks` UNIQUE constraint
 * is the real idempotency guarantee (@GUARD Risk #1). Redis is only an
 * optimisation, so its errors have to be recognisable in order to be ignored
 * safely.
 */
export class RedisProviderError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'RedisProviderError';
  }
}

/**
 * Thin wrapper around an ioredis client.
 *
 * Why a wrapper and not just `provide: 'REDIS_CLIENT'`?
 * 1. Lifecycle — `onModuleDestroy` cleanly quits the connection.
 * 2. Typed convenience methods that the rest of the codebase imports
 *    without depending on ioredis directly.
 * 3. Testability — the service is mockable via NestJS DI without
 *    replacing the entire ioredis module.
 * 4. Uniform failure — every command surfaces as `RedisProviderError`.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('REDIS_URL', { infer: true });
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      // Without this, a command issued while Redis is down queues in memory and
      // never settles — the caller hangs instead of failing.
      enableOfflineQueue: false,
      connectTimeout: 5_000,
    });

    this.client.on('connect', () => this.logger.log('Redis client connected'));
    this.client.on('error', (err) => this.logger.error('Redis client error', err));
  }

  /** Returns the raw ioredis client for advanced use cases. */
  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.run('get', () => this.client.get(key));
  }

  async set(key: string, value: string): Promise<void> {
    await this.run('set', () => this.client.set(key, value));
  }

  /** Sets a key with an expiry in seconds. */
  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.run('setex', () => this.client.setex(key, seconds, value));
  }

  async del(...keys: string[]): Promise<number> {
    return this.run('del', () => this.client.del(...keys));
  }

  async exists(...keys: string[]): Promise<number> {
    return this.run('exists', () => this.client.exists(...keys));
  }

  /**
   * Runs a command, converting any ioredis failure into `RedisProviderError`.
   * Logs before throwing so an outage is visible even if a caller chooses to
   * swallow the error and degrade.
   */
  private async run<T>(operation: string, command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      this.logger.error(`Redis ${operation} failed`, error);
      throw new RedisProviderError(
        `Redis ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        operation,
        error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
      this.logger.log('Redis client disconnected');
    } catch (error) {
      // Shutdown must not throw — a failed quit would mask the real reason the
      // process is stopping. Force the socket closed and move on.
      this.logger.warn('Redis quit failed during shutdown; forcing disconnect', error);
      this.client.disconnect();
    }
  }
}
