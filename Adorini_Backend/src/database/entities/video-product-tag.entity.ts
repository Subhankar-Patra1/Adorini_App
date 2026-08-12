import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Product } from './product.entity';
import type { Video } from './video.entity';

/**
 * A "shop this look" link from a video to one product.
 *
 * A join table modelled as a full entity, not a bare pivot — `displayOrder`
 * gives admins control over the order product chips appear under the player,
 * and a bare `@ManyToMany` has nowhere to hang that.
 */
@Unique('uq_video_product_tag', ['videoId', 'productId'])
@Index('idx_video_product_tags_video', ['videoId'])
@Entity('video_product_tags')
export class VideoProductTag extends BaseEntity {
  @ManyToOne('Video', 'productTags', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  video: Video;

  @Column({ type: 'uuid' })
  videoId: string;

  @ManyToOne('Product', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  product: Product;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'smallint', default: 0 })
  displayOrder: number;
}
