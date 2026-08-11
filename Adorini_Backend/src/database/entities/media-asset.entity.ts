import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Product } from './product.entity';
import type { Review } from './review.entity';
import type { User } from './user.entity';
import { MediaProvenance, MediaType } from '../../common/enums/domain.enums';

/**
 * An image or video attached to a product, either admin-curated or submitted by
 * a buyer with a review.
 *
 * `provenance` is the trust boundary the product is built on: `ADMIN` assets
 * earn the "Official Media" badge, `BUYER` assets never do. It is a column
 * rather than an inference from `uploadedByUserId IS NULL` so that an admin
 * uploading while logged in cannot accidentally produce buyer-looking media,
 * and a check constraint keeps the two fields consistent.
 */
@Index('idx_media_product_provenance', ['productId', 'provenance'])
@Check(
  'chk_media_buyer_has_uploader',
  `("provenance" = 'ADMIN' AND "review_id" IS NULL) OR ("provenance" = 'BUYER' AND "uploaded_by_user_id" IS NOT NULL)`,
)
@Entity('media_assets')
export class MediaAsset extends BaseEntity {
  @ManyToOne('Product', 'media', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  /**
   * Cloudflare R2 object key. The public URL is composed at read time from
   * `R2_PUBLIC_BASE_URL`, so moving buckets or putting a new domain in front of
   * R2 does not require rewriting every row (ADR-003).
   */
  @Column({ type: 'varchar', length: 512 })
  objectKey: string;

  @Column({ type: 'enum', enum: MediaType, enumName: 'media_type' })
  type: MediaType;

  @Column({
    type: 'enum',
    enum: MediaProvenance,
    enumName: 'media_provenance',
  })
  provenance: MediaProvenance;

  /** Set for BUYER media; null for admin-curated gallery items. */
  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  uploadedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  /** The review this asset was submitted with, when provenance is BUYER. */
  @ManyToOne('Review', 'media', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn()
  review: Review | null;

  @Column({ type: 'uuid', nullable: true })
  reviewId: string | null;

  /** Gallery ordering. The PRD caps the official gallery at 5 items. */
  @Column({ type: 'smallint', default: 0 })
  displayOrder: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  altText: string | null;
}
