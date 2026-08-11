import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { MediaAsset } from './media-asset.entity';
import type { Product } from './product.entity';
import type { User } from './user.entity';
import { FitTag } from '../../common/enums/domain.enums';

/**
 * A buyer's review of a product.
 *
 * `fitTag` is the structured half and matters more than the prose: aggregated
 * across reviews it tells a shopper "most buyers say this runs small" and feeds
 * size-chart corrections. Nullable because a buyer may rate quality without
 * commenting on fit.
 */
@Unique('uq_review_user_product', ['userId', 'productId'])
@Index('idx_reviews_product_fit_tag', ['productId', 'fitTag'])
@Check('chk_review_rating_range', '"rating" BETWEEN 1 AND 5')
@Entity('reviews')
export class Review extends BaseEntity {
  @ManyToOne('Product', 'reviews', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne('User', 'reviews', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'enum', enum: FitTag, enumName: 'fit_tag', nullable: true })
  fitTag: FitTag | null;

  /** The size actually bought — a fit tag is meaningless without it. */
  @Column({ type: 'smallint', nullable: true })
  purchasedNominalSize: number | null;

  /**
   * True when the reviewer has a `DELIVERED` order containing this product.
   * Denormalised at write time: the PDP renders a "Verified Purchase" badge on
   * every review card, and recomputing it per card is an order-history join per
   * review.
   */
  @Column({ type: 'boolean', default: false })
  isVerifiedPurchase: boolean;

  @OneToMany('MediaAsset', 'review')
  media: MediaAsset[];
}
