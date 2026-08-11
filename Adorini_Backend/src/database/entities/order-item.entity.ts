import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Order } from './order.entity';
import type { ProductVariant } from './product-variant.entity';

/**
 * One line on an order.
 *
 * The product name, size, colour and unit price are copied onto the row rather
 * than read through the variant relation. A product renamed or repriced next
 * season must not change what a past invoice says it was — and the variant may
 * be deactivated entirely, which is why the FK is `SET NULL` and the snapshot
 * columns are the authoritative record.
 */
@Index('idx_order_items_order', ['orderId'])
@Check('chk_order_item_quantity_positive', '"quantity" > 0')
@Check('chk_order_item_line_total', '"line_total_paise" = "unit_price_paise" * "quantity"')
@Entity('order_items')
export class OrderItem extends BaseEntity {
  @ManyToOne('Order', 'items', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  order: Order;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne('ProductVariant', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  variant: ProductVariant | null;

  @Column({ type: 'uuid', nullable: true })
  variantId: string | null;

  /** Kept for "buy it again" and review eligibility after a variant is retired. */
  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  // ---- Snapshot at placement ----

  @Column({ type: 'varchar', length: 200 })
  productName: string;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'smallint' })
  nominalSize: number;

  @Column({ type: 'varchar', length: 64 })
  colour: string;

  @Column({ type: 'integer' })
  unitPricePaise: number;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ type: 'integer' })
  lineTotalPaise: number;
}
