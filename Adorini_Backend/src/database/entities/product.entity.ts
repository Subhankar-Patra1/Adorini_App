import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Brand } from './brand.entity';
import type { Category } from './category.entity';
import type { MediaAsset } from './media-asset.entity';
import type { ProductVariant } from './product-variant.entity';
import type { Review } from './review.entity';
import type { SizeEnquiry } from './size-enquiry.entity';
import { FabricType, PrintTechnique } from '../../common/enums/domain.enums';
import type { SizeRules } from '../../common/schemas/size-rules.schema';

/**
 * A sellable garment. Colour/size combinations live in `ProductVariant`.
 *
 * @GUARD Risk #4 (MEDIUM): the catalog filter rail queries this table by
 * category + price range, by brand, and by fabric type. Without these indexes
 * every filter interaction is a sequential scan, and the PRD's infinite scroll
 * turns that into one scan per page.
 */
@Index('idx_products_category_price', ['categoryId', 'pricePaise'])
@Index('idx_products_brand', ['brandId'])
@Index('idx_products_fabric_type', ['fabricType'])
@Check('chk_product_price_positive', '"price_paise" > 0')
@Check(
  'chk_product_compare_at_price',
  '"compare_at_price_paise" IS NULL OR "compare_at_price_paise" >= "price_paise"',
)
@Entity('products')
export class Product extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160 })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne('Category', 'products', { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn()
  category: Category;

  @Column({ type: 'uuid' })
  categoryId: string;

  @ManyToOne('Brand', 'products', { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn()
  brand: Brand;

  @Column({ type: 'uuid' })
  brandId: string;

  /**
   * Listed price in paise. Integer, never float — ₹1,299.50 is 129950, and no
   * amount of arithmetic on it can drift the way `1299.50` does.
   *
   * This is the display/filter price. It is also the price the checkout
   * recomputes against; a client-supplied total is ignored entirely
   * (@GUARD Risk #3).
   */
  @Column({ type: 'integer' })
  pricePaise: number;

  /** Struck-through MRP shown beside the price. Null when not discounted. */
  @Column({ type: 'integer', nullable: true })
  compareAtPricePaise: number | null;

  /**
   * Selects which size chart the PDP renders — the whole returns-reduction
   * mechanism. Indexed because it is a filter chip.
   */
  @Column({ type: 'enum', enum: FabricType, enumName: 'fabric_type' })
  fabricType: FabricType;

  @Column({
    type: 'enum',
    enum: PrintTechnique,
    enumName: 'print_technique',
    nullable: true,
  })
  printTechnique: PrintTechnique | null;

  /**
   * Fabric-specific measurement chart. Shape is owned by `sizeRulesSchema`;
   * the admin module parses every write through it so malformed rules are
   * rejected rather than persisted (@GUARD Risk #5).
   *
   * `jsonb` not `json`: it is queried, and only jsonb supports the containment
   * operators and GIN indexing a future "fits my measurements" filter needs.
   */
  @Column({ type: 'jsonb', nullable: true })
  sizeRules: SizeRules | null;

  /**
   * Full-text search document, maintained entirely by a database trigger
   * (migration `AddProductSearchVector`) and queried as raw SQL by the catalog.
   *
   * Mapped here purely so TypeORM knows the column exists. While it was
   * unmapped, `migration:generate` treated it as drift and emitted
   * `DROP COLUMN "search_vector"` — so the next unrelated migration anyone
   * generated would have silently deleted search, and the schema-drift check
   * we rely on as a correctness signal was permanently red.
   *
   * `insert`/`update` are false because the trigger owns the value: writing it
   * from the application would fight the trigger and could persist a stale
   * document. `select: false` keeps a large tsvector out of every product read.
   * The GIN index is `synchronize: false` because TypeORM would otherwise try
   * to recreate it as a btree.
   */
  @Index('idx_products_search_vector', { synchronize: false })
  @Column({
    type: 'tsvector',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  searchVector: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany('ProductVariant', 'product')
  variants: ProductVariant[];

  @OneToMany('MediaAsset', 'product')
  media: MediaAsset[];

  @OneToMany('Review', 'product')
  reviews: Review[];

  @OneToMany('SizeEnquiry', 'product')
  sizeEnquiries: SizeEnquiry[];
}
