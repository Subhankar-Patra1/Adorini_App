import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Product } from './product.entity';

/**
 * A specific size + colour of a product — the thing that actually has stock and
 * gets added to a cart.
 *
 * The `(product_id, nominal_size, colour)` uniqueness is what makes "decrement
 * stock for this variant" unambiguous; without it a duplicate row would split
 * one real SKU's inventory across two records.
 */
@Unique('uq_variant_product_size_colour', ['productId', 'nominalSize', 'colour'])
@Check('chk_variant_stock_non_negative', '"stock_quantity" >= 0')
@Check('chk_variant_nominal_size_range', '"nominal_size" BETWEEN 40 AND 48')
@Check('chk_variant_price_positive', '"price_paise" IS NULL OR "price_paise" > 0')
@Entity('product_variants')
export class ProductVariant extends BaseEntity {
  @Index()
  @ManyToOne('Product', 'variants', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  sku: string;

  /** Nominal size as printed on the label — Adorini's band is 40–48. */
  @Column({ type: 'smallint' })
  nominalSize: number;

  @Column({ type: 'varchar', length: 64 })
  colour: string;

  /**
   * Per-variant price override in paise. Null means "use the product's price",
   * which is the common case — a size 48 sometimes costs more, most do not.
   */
  @Column({ type: 'integer', nullable: true })
  pricePaise: number | null;

  /**
   * On-hand units. Non-negative is enforced at the DB level: overselling a COD
   * order means a cancellation call to the customer, so the constraint belongs
   * where no code path can skip it.
   */
  @Column({ type: 'integer', default: 0 })
  stockQuantity: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
