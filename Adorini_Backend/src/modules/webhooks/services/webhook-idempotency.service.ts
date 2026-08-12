import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';

import type { WebhookProvider } from '../../../common/enums/domain.enums';
import { ProcessedWebhook } from '../../../database/entities/processed-webhook.entity';
import { RedisService } from '../../../providers/redis/redis.service';

/** PostgreSQL `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

/** How long the fast-path marker lives. Long enough to cover any sane retry window. */
const SEEN_MARKER_TTL_SECONDS = 24 * 60 * 60;

export interface WebhookEvent {
  provider: WebhookProvider;
  /** The provider's own event identifier — never one we generate. */
  eventId: string;
  eventType: string | null;
  payload: Record<string, unknown>;
}

export type IngestResult<T> = { status: 'processed'; result: T } | { status: 'duplicate' };

/**
 * Applies a webhook exactly once.
 *
 * @GUARD Risk #1 (CRITICAL): Cashfree, Delhivery and MSG91 all redeliver on
 * timeout or non-2xx, so the same event arriving twice is routine traffic, not
 * an edge case. A duplicate `Delivered` would pay a ₹100 referral twice.
 *
 * The guarantee is the `(webhook_provider, webhook_event_id)` UNIQUE constraint,
 * and it holds because the marker row is inserted **in the same transaction as
 * the side effects**. Either the whole event applies or none of it does; a
 * replay loses the race on the constraint and rolls back its own work.
 *
 * Redis is a fast-path pre-check only, exactly as the `ProcessedWebhook` entity
 * documents. It can expire, be evicted, or vanish with the container, so it may
 * never be what correctness rests on — it only saves a doomed transaction.
 */
@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  async ingest<T>(
    event: WebhookEvent,
    apply: (manager: EntityManager) => Promise<{ relatedEntityId: string | null; result: T }>,
  ): Promise<IngestResult<T>> {
    const key = this.seenKey(event);

    if (await this.isRecentlySeen(key)) {
      this.logger.log(`${event.provider} event ${event.eventId} already seen (cache); skipping`);
      return { status: 'duplicate' };
    }

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        /**
         * Inserted before the side effects run. Two concurrent deliveries of the
         * same event both reach this line; the second blocks on the unique index
         * and then fails, so it never gets as far as crediting anything.
         */
        const record = await manager.save(
          ProcessedWebhook,
          manager.create(ProcessedWebhook, {
            webhookProvider: event.provider,
            webhookEventId: event.eventId,
            eventType: event.eventType,
            payload: event.payload,
          }),
        );

        const applied = await apply(manager);

        if (applied.relatedEntityId) {
          record.relatedEntityId = applied.relatedEntityId;
          await manager.save(ProcessedWebhook, record);
        }

        return applied.result;
      });

      await this.markSeen(key);
      return { status: 'processed', result };
    } catch (error) {
      if (this.isDuplicateEvent(error)) {
        this.logger.log(`${event.provider} event ${event.eventId} already applied; no-op`);
        await this.markSeen(key);
        return { status: 'duplicate' };
      }
      throw error;
    }
  }

  private seenKey(event: WebhookEvent): string {
    return `webhook:seen:${event.provider}:${event.eventId}`;
  }

  /**
   * A Redis outage must not stop payment webhooks from being processed — the
   * database constraint still guarantees exactly-once, so failing open here
   * costs one wasted transaction rather than a stalled order.
   */
  private async isRecentlySeen(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch (error) {
      this.logger.warn(`Redis pre-check unavailable, falling through to the DB constraint`, error);
      return false;
    }
  }

  private async markSeen(key: string): Promise<void> {
    try {
      await this.redis.setex(key, SEEN_MARKER_TTL_SECONDS, '1');
    } catch (error) {
      this.logger.warn(`Could not cache webhook marker ${key}`, error);
    }
  }

  private isDuplicateEvent(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION
    );
  }
}
