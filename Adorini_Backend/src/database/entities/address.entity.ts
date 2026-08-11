import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { User } from './user.entity';

/**
 * A buyer's saved address.
 *
 * Orders do NOT reference this row — they snapshot the address at placement
 * (see `Order.shippingAddress`). Editing a saved address must never silently
 * rewrite where a past order was shipped.
 */
@Check('chk_address_pincode_format', `"pincode" ~ '^[1-9][0-9]{5}$'`)
@Entity('addresses')
export class Address extends BaseEntity {
  @Index()
  @ManyToOne('User', 'addresses', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 120 })
  recipientName: string;

  @Column({ type: 'varchar', length: 15 })
  recipientPhone: string;

  @Column({ type: 'varchar', length: 255 })
  line1: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  line2: string | null;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ type: 'varchar', length: 100 })
  state: string;

  /** Indian PIN code: exactly 6 digits, never starting with 0. */
  @Column({ type: 'char', length: 6 })
  pincode: string;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;
}
