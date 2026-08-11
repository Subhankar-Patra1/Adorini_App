import { Column, Entity, Index, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import { WebhookProvider } from '../../common/enums/domain.enums';

/**
 * Ledger of externally-delivered webhook events that have already been applied.
 *
 * @GUARD Risk #1 (CRITICAL): Cashfree, Delhivery and MSG91 all retry delivery
 * on timeout or non-2xx, so the same event arrives more than once as a matter
 * of routine — not as an edge case. Processing a duplicate `DELIVERED` event
 * would credit a ₹100 referral twice; a duplicate payment event would advance
 * the order state machine twice.
 *
 * The mitigation is this table's UNIQUE constraint on
 * `(webhook_provider, webhook_event_id)`. **The constraint is the guarantee.**
 * A Redis key is only a fast-path pre-check that avoids a doomed transaction —
 * it can expire, be evicted under memory pressure, or be lost when the Redis
 * container restarts, so it can never be the thing correctness rests on.
 *
 * The handler inserts this row inside the *same* database transaction as the
 * side effect it guards (the wallet credit, the status transition). Either both
 * land or neither does, which is what makes a replay a no-op rather than a
 * second payout. That transactional pairing is implemented in the webhooks and
 * wallet modules in Phase 4; Phase 2 provides the constraint it depends on.
 */
@Unique('uq_processed_webhook_provider_event', ['webhookProvider', 'webhookEventId'])
@Index('idx_processed_webhooks_received', ['receivedAt'])
@Entity('processed_webhooks')
export class ProcessedWebhook extends BaseEntity {
  @Column({
    type: 'enum',
    enum: WebhookProvider,
    enumName: 'webhook_provider',
  })
  webhookProvider: WebhookProvider;

  /**
   * The provider's own event identifier, taken from the payload — never one we
   * generate. A locally-generated ID would be unique per delivery and defeat
   * the entire mechanism.
   */
  @Column({ type: 'varchar', length: 255 })
  webhookEventId: string;

  /** Provider's event name, e.g. `PAYMENT_SUCCESS_WEBHOOK`. Diagnostics only. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  eventType: string | null;

  /**
   * The raw payload as received, retained for dispute resolution and replay
   * during incident response — when Cashfree and our ledger disagree, this is
   * the evidence.
   */
  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  /** The order or referral this event acted on, when resolvable. */
  @Column({ type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;
}
