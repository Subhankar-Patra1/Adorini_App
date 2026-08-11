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

  /** Left-to-right tab order on the catalog screen. */
  @Column({ type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany('Product', 'category')
  products: Product[];
}
