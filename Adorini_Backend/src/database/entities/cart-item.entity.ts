import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { ProductVariant } from './product-variant.entity';
import type { User } from './user.entity';

/**
 * One line in a buyer's cart.
 *
 * There is deliberately no `carts` table. A cart *is* the set of these rows for
 * a user — a parent row would only ever hold a foreign key and a timestamp, and
 * would need creating before the first item could be added, which is a race and
 * an extra round trip for nothing.
 *
 * **No price is stored here.** Prices are read live from the product/variant on
 * every cart read and recomputed again at placement (@GUARD Risk #3). Storing
 * one would mean a price change never reaches a cart that was filled before it,
 * and the buyer would be quoted a number the checkout then refuses to honour.
 * The cost of that choice is that a cart's total can move between visits, which
 * is correct: the shop's price is the price.
 */
@Unique('uq_cart_item_user_variant', ['userId', 'variantId'])
@Check('chk_cart_item_quantity_positive', '"quantity" > 0')
@Index('idx_cart_items_user', ['userId'])
@Entity('cart_items')
export class CartItem extends BaseEntity {
  @ManyToOne('User', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  /**
   * The exact size/colour chosen. Changing size or colour rewrites this
   * pointer rather than creating a new line — that is what the PDP's inline
   * editor does.
   */
  @ManyToOne('ProductVariant', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  variant: ProductVariant;

  @Column({ type: 'uuid' })
  variantId: string;

  /**
   * Never zero: removing the last one deletes the row. A zero-quantity line
   * would render as an empty row the buyer cannot get rid of.
   */
  @Column({ type: 'integer' })
  quantity: number;
}
