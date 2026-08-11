import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Shared identity and audit columns.
 *
 * UUID primary keys rather than sequential integers: order and user IDs travel
 * to Cashfree, Delhivery and MSG91, and appear in webhook payloads and support
 * conversations. A sequential ID would leak order volume to anyone who placed
 * two orders a week apart.
 *
 * Timestamps are `timestamptz`. Delhivery and Cashfree send timestamps in IST
 * while Railway runs UTC; storing without a zone would silently shift every
 * webhook-derived time by 5.5 hours.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
