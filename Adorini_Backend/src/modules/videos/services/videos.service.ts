import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { DataSource, Repository } from 'typeorm';

import type {
  AdminVideoDto,
  CreateVideoDto,
  ListVideosQueryDto,
  ReplaceVideoTagsDto,
  UpdateVideoDto,
  VideoFeedResponseDto,
} from '../dto/videos.dto';
import { MediaProvenance } from '../../../common/enums/domain.enums';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor.util';
import type { Env } from '../../../config/env.validation';
import { Video } from '../../../database/entities/video.entity';
import { VideoProductTag } from '../../../database/entities/video-product-tag.entity';
import { StorageService } from '../../../providers/storage/storage.service';

const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
};

const THUMBNAIL_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface TaggedProductRow {
  videoId: string;
  productId: string;
  slug: string;
  name: string;
  pricePaise: number;
  thumbnailKey: string | null;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @InjectRepository(VideoProductTag) private readonly tags: Repository<VideoProductTag>,
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The public feed. Chronological — see the `Video` entity for why there is
   * no manual ordering to consult — paginated the same way the PDP reviews
   * feed is: a cursor seeking off `(created_at, id)`.
   */
  async listFeed(query: ListVideosQueryDto): Promise<VideoFeedResponseDto> {
    const qb = this.videos.createQueryBuilder('video').where('video.isActive = true');

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      qb.andWhere(
        '(video.created_at < :cursorValue) OR (video.created_at = :cursorValue AND video.id < :cursorId)',
        { cursorValue: cursor.sortValue, cursorId: cursor.id },
      );
    }

    qb.orderBy('video.created_at', 'DESC').addOrderBy('video.id', 'DESC');
    qb.take(query.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    const taggedByVideo = await this.getTaggedProducts(page.map((v) => v.id));

    return {
      items: page.map((v) => ({
        id: v.id,
        url: this.toUrl(v.objectKey),
        thumbnailUrl: v.thumbnailKey ? this.toUrl(v.thumbnailKey) : null,
        caption: v.caption,
        taggedProducts: taggedByVideo.get(v.id) ?? [],
        createdAt: v.createdAt.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ sortValue: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  // ---- admin ----

  async listAdmin(): Promise<AdminVideoDto[]> {
    const rows = await this.videos.find({ order: { createdAt: 'DESC' } });
    const tagRows = await this.tags.find({ order: { displayOrder: 'ASC' } });

    const tagsByVideo = new Map<string, string[]>();
    for (const tag of tagRows) {
      const existing = tagsByVideo.get(tag.videoId);
      if (existing) {
        existing.push(tag.productId);
      } else {
        tagsByVideo.set(tag.videoId, [tag.productId]);
      }
    }

    return rows.map((v) => this.toAdminVideo(v, tagsByVideo.get(v.id) ?? []));
  }

  /**
   * Uploads happen before the transaction opens, not inside it. If a tagged
   * product id turns out to be invalid the DB write rolls back and the
   * uploaded file is orphaned in R2 — an orphaned blob is garbage-collectable
   * later; an orphaned DB row (the failure mode found and fixed in PDP review
   * submission) is not, so that is the side the risk belongs on.
   */
  async create(
    dto: CreateVideoDto,
    videoFile: Express.Multer.File,
    thumbnailFile?: Express.Multer.File,
  ): Promise<AdminVideoDto> {
    const videoExtension = VIDEO_MIME_EXTENSIONS[videoFile.mimetype] ?? 'mp4';
    const objectKey = `videos/${crypto.randomUUID()}.${videoExtension}`;
    await this.storage.uploadFile(objectKey, videoFile.buffer, videoFile.mimetype);

    let thumbnailKey: string | null = null;
    if (thumbnailFile) {
      const thumbExtension = THUMBNAIL_MIME_EXTENSIONS[thumbnailFile.mimetype] ?? 'jpg';
      thumbnailKey = `videos/thumbnails/${crypto.randomUUID()}.${thumbExtension}`;
      await this.storage.uploadFile(thumbnailKey, thumbnailFile.buffer, thumbnailFile.mimetype);
    }

    return this.dataSource.transaction(async (manager) => {
      const video = await manager.save(
        Video,
        manager.create(Video, {
          objectKey,
          thumbnailKey,
          caption: dto.caption ?? null,
          isActive: true,
        }),
      );

      if (dto.productIds.length > 0) {
        await manager.save(
          VideoProductTag,
          dto.productIds.map((productId, index) =>
            manager.create(VideoProductTag, { videoId: video.id, productId, displayOrder: index }),
          ),
        );
      }

      return this.toAdminVideo(video, dto.productIds);
    });
  }

  async update(id: string, dto: UpdateVideoDto): Promise<AdminVideoDto> {
    const video = await this.requireVideo(id);

    if ('caption' in dto) video.caption = dto.caption ?? null;
    if ('isActive' in dto && dto.isActive !== undefined) video.isActive = dto.isActive;

    await this.videos.save(video);

    const tagRows = await this.tags.find({ where: { videoId: id }, order: { displayOrder: 'ASC' } });
    return this.toAdminVideo(video, tagRows.map((t) => t.productId));
  }

  /** Full-replace semantics — simplest contract for a "curate the tag list" admin screen. */
  async replaceTags(id: string, dto: ReplaceVideoTagsDto): Promise<AdminVideoDto> {
    const video = await this.requireVideo(id);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(VideoProductTag, { videoId: id });

      if (dto.productIds.length > 0) {
        await manager.save(
          VideoProductTag,
          dto.productIds.map((productId, index) =>
            manager.create(VideoProductTag, { videoId: id, productId, displayOrder: index }),
          ),
        );
      }
    });

    return this.toAdminVideo(video, dto.productIds);
  }

  private async requireVideo(id: string): Promise<Video> {
    const video = await this.videos.findOne({ where: { id } });

    if (!video) {
      throw new NotFoundException(`Video ${id} not found`);
    }

    return video;
  }

  /**
   * Reuses the catalog module's thumbnail convention exactly: the admin-
   * curated primary image is the `displayOrder: 0` `ADMIN` asset on the
   * tagged product.
   */
  private async getTaggedProducts(
    videoIds: string[],
  ): Promise<Map<string, { id: string; slug: string; name: string; pricePaise: number; thumbnailUrl: string | null }[]>> {
    const grouped = new Map<
      string,
      { id: string; slug: string; name: string; pricePaise: number; thumbnailUrl: string | null }[]
    >();

    if (videoIds.length === 0) {
      return grouped;
    }

    const rows = await this.tags
      .createQueryBuilder('tag')
      .innerJoin('tag.product', 'product')
      .leftJoin(
        'product.media',
        'thumbnail',
        'thumbnail.provenance = :adminProvenance AND thumbnail.displayOrder = 0',
        { adminProvenance: MediaProvenance.ADMIN },
      )
      .select([
        'tag.videoId AS "videoId"',
        'product.id AS "productId"',
        'product.slug AS "slug"',
        'product.name AS "name"',
        'product.pricePaise AS "pricePaise"',
        'thumbnail.objectKey AS "thumbnailKey"',
      ])
      .where('tag.videoId IN (:...videoIds)', { videoIds })
      .andWhere('product.isActive = true')
      .orderBy('tag.displayOrder', 'ASC')
      .getRawMany<TaggedProductRow>();

    for (const row of rows) {
      const item = {
        id: row.productId,
        slug: row.slug,
        name: row.name,
        pricePaise: row.pricePaise,
        thumbnailUrl: row.thumbnailKey ? this.toUrl(row.thumbnailKey) : null,
      };

      const existing = grouped.get(row.videoId);
      if (existing) {
        existing.push(item);
      } else {
        grouped.set(row.videoId, [item]);
      }
    }

    return grouped;
  }

  private toAdminVideo(video: Video, taggedProductIds: string[]): AdminVideoDto {
    return {
      id: video.id,
      url: this.toUrl(video.objectKey),
      thumbnailUrl: video.thumbnailKey ? this.toUrl(video.thumbnailKey) : null,
      caption: video.caption,
      isActive: video.isActive,
      taggedProductIds,
      createdAt: video.createdAt.toISOString(),
    };
  }

  private toUrl(objectKey: string): string {
    const base = this.config.get('R2_PUBLIC_BASE_URL', { infer: true });
    return `${base.replace(/\/$/, '')}/${objectKey}`;
  }
}
