import { Column, Entity, Index, OneToMany } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { VideoProductTag } from './video-product-tag.entity';

/**
 * A reels-style clip on the discovery feed.
 *
 * MVP scope deliberately excludes likes and comments (see ADR-031): they are
 * social/vanity features with no conversion path and real moderation cost,
 * whereas "shop this look" tagging is what turns a watched video into a sale —
 * the actual bet this feature is making.
 *
 * No `displayOrder`: the feed is chronological (newest first), same as the
 * PDP reviews feed. A manual-curation override is easy to add later if the
 * catalogue of videos grows large enough to need it; nothing here forecloses
 * it, and building it now would be for a problem that does not exist yet.
 */
@Index('idx_videos_active_created', ['isActive', 'createdAt'])
@Entity('videos')
export class Video extends BaseEntity {
  /** R2 object key for the video file itself (MP4 only for MVP — see ADR-031). */
  @Column({ type: 'varchar', length: 512 })
  objectKey: string;

  /** Poster frame shown before playback starts. Null while a video has none yet. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnailKey: string | null;

  @Column({ type: 'text', nullable: true })
  caption: string | null;

  /** Soft toggle: pulling a video from the feed does not delete its R2 object or its tags. */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany('VideoProductTag', 'video')
  productTags: VideoProductTag[];
}
