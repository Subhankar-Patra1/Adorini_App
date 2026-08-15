import { Column, Entity, Index, OneToMany } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Product } from './product.entity';

/**
 * A garment type — the top-level tabs on the catalog screen (kurtis, two-piece
 * suit sets, three-piece suit sets, blouses, petticoats).
 *
 * Flat, not a tree: the PRD's navigation is a single row of tabs, and a
 * self-referencing hierarchy would be scaffolding for a screen that does not
 * exist.
 */
@Entity('categories')
export class Category extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * The nominal sizes this category is stocked in.
   *
   * Per-category rather than one global band, because the bands genuinely
   * differ: blouses run 32–36 while kurtis run 40–48, and a single band wide
   * enough for both would permit a size-32 kaftaan.
   *
   * A CHECK constraint cannot enforce this — it may not reference another
   * table — so a variant's size is validated against its product's category in
   * application code. The database only keeps a coarse 32–48 backstop.
   */
  @Column({ type: 'smallint', array: true, default: () => `'{40,42,44,46,48}'` })
  sizes: number[];

  /** Left-to-right tab order on the catalog screen. */
  @Column({ type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany('Product', 'category')
  products: Product[];
}
