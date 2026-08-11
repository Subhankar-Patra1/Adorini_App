import { Column, Entity, Index, OneToMany } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Product } from './product.entity';

/** A label sold on Adorini — powers the "Shop by brand" rail and filter chip. */
@Entity('brands')
export class Brand extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  /** Display name, case-preserved (e.g. `NAVRANGA` is styled in caps). */
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** R2 object key for the brand rail tile. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  logoKey: string | null;

  @Column({ type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany('Product', 'brand')
  products: Product[];
}
